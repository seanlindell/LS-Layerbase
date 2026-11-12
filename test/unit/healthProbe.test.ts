import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHealthProbe } from "~~/server/utils/healthProbe";
import { markMigrated, setMigrationStatus } from "~~/server/utils/migrationState";

const quiet = { info: () => undefined, warn: () => undefined };

/** A promise that the test settles by hand, like a query on a stalled database. */
function deferred() {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});

	return { promise, resolve, reject };
}

beforeEach(() => {
	vi.useFakeTimers();
	markMigrated();
});
afterEach(() => vi.useRealTimers());

describe("createHealthProbe", () => {
	it("is healthy when migrations are done and the ping answers", async () => {
		const ping = vi.fn(async () => [{ 1: 1 }]);
		const probe = createHealthProbe({ ping, log: quiet });

		expect(await probe()).toBe(true);
		expect(ping).toHaveBeenCalledOnce();
	});

	it("is unhealthy before the migrations are done, and does not touch the database", async () => {
		setMigrationStatus("running");
		const ping = vi.fn();
		const probe = createHealthProbe({ ping, log: quiet });

		expect(await probe()).toBe(false);
		expect(ping).not.toHaveBeenCalled();

		markMigrated();
		expect(await probe()).toBe(true);
	});

	it("does not wait for migrations when told not to", async () => {
		setMigrationStatus("pending");

		expect(await createHealthProbe({ requireMigrations: false, log: quiet })()).toBe(true);
	});

	it("is unhealthy when the ping rejects or throws", async () => {
		const rejects = createHealthProbe({
			ping: () => Promise.reject(new Error("connection refused")),
			log: quiet,
		});
		const throws = createHealthProbe({
			ping: () => {
				throw new Error("database is closed");
			},
			log: quiet,
		});

		expect(await rejects()).toBe(false);
		expect(await throws()).toBe(false);
	});

	it("is unhealthy when the ping does not answer within the timeout", async () => {
		const stalled = deferred();
		const probe = createHealthProbe({ ping: () => stalled.promise, timeoutMs: 500, log: quiet });

		const result = probe();
		await vi.advanceTimersByTimeAsync(499);
		let settled = false;
		void result.then(() => (settled = true));
		await Promise.resolve();
		expect(settled).toBe(false);

		await vi.advanceTimersByTimeAsync(1);
		expect(await result).toBe(false);
	});

	it("shares one running query between concurrent probes", async () => {
		const query = deferred();
		const ping = vi.fn(() => query.promise);
		const probe = createHealthProbe({ ping, log: quiet });

		const probes = [probe(), probe(), probe()];
		await vi.advanceTimersByTimeAsync(0);
		expect(ping).toHaveBeenCalledOnce();

		query.resolve();
		expect(await Promise.all(probes)).toEqual([true, true, true]);
	});

	it("starts no new query while a stalled one is still running, also after a timeout", async () => {
		const stalled = deferred();
		const ping = vi.fn(() => stalled.promise);
		const probe = createHealthProbe({ ping, timeoutMs: 100, log: quiet });

		for (let round = 0; round < 5; round++) {
			const result = probe();
			await vi.advanceTimersByTimeAsync(100);
			expect(await result).toBe(false);
		}
		expect(ping).toHaveBeenCalledOnce();

		// The database comes back: the old query ends, and the next probe starts a new one.
		stalled.resolve();
		await vi.advanceTimersByTimeAsync(0);
		ping.mockImplementation(() => Promise.resolve());
		expect(await probe()).toBe(true);
		expect(ping).toHaveBeenCalledTimes(2);
	});

	it("runs app-specific checks, and fails on one that throws or gives false", async () => {
		const ping = async () => undefined;

		expect(await createHealthProbe({ ping, checks: { queue: () => true }, log: quiet })()).toBe(true);
		expect(await createHealthProbe({ ping, checks: { queue: () => false }, log: quiet })()).toBe(false);
		expect(
			await createHealthProbe({
				ping,
				checks: { queue: () => Promise.reject(new Error("queue is down")) },
				log: quiet,
			})(),
		).toBe(false);
	});

	it("logs the reason when the result changes, and not on each probe", async () => {
		const log = { info: vi.fn(), warn: vi.fn() };
		let up = false;
		const probe = createHealthProbe({
			ping: () => (up ? Promise.resolve() : Promise.reject(new Error("connection refused"))),
			log,
		});

		await probe();
		await probe();
		expect(log.warn).toHaveBeenCalledOnce();
		expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("database: connection refused"));

		up = true;
		await probe();
		await probe();
		expect(log.info).toHaveBeenCalledOnce();
	});
});
