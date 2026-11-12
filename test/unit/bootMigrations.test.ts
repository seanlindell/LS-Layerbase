import { beforeEach, describe, expect, it, vi } from "vitest";
import { runBootMigrations } from "~~/server/utils/bootMigrations";
import {
	isMigrated,
	markMigrated,
	migrationStatus,
	setMigrationStatus,
	whenMigrated,
} from "~~/server/utils/migrationState";

const quiet = { info: () => undefined, error: () => undefined };

beforeEach(() => setMigrationStatus("pending"));

describe("migration state", () => {
	it("starts as pending and not migrated", () => {
		expect(migrationStatus()).toBe("pending");
		expect(isMigrated()).toBe(false);
	});

	it("is shared through globalThis, so a second copy of the module sees it", () => {
		markMigrated();
		const store = globalThis as Record<symbol, { status?: string } | undefined>;
		expect(store[Symbol.for("layerbase.migrations")]?.status).toBe("done");
	});

	it("resolves whenMigrated() once the schema is ready, and at once after that", async () => {
		let resolved = false;
		const waiting = whenMigrated().then(() => (resolved = true));
		await Promise.resolve();
		expect(resolved).toBe(false);

		markMigrated();
		await waiting;
		expect(resolved).toBe(true);
		await expect(whenMigrated()).resolves.toBeUndefined();
	});
});

describe("runBootMigrations", () => {
	it("is running while the migrations run, and done after", async () => {
		const seen: string[] = [];
		await runBootMigrations({
			log: quiet,
			migrate: async () => {
				seen.push(migrationStatus());
				expect(isMigrated()).toBe(false);
			},
		});

		expect(seen).toEqual(["running"]);
		expect(isMigrated()).toBe(true);
	});

	it("when off, applies nothing and reports the schema as ready", async () => {
		const migrate = vi.fn();
		await runBootMigrations({ log: quiet, migrate, enabled: false });

		expect(migrate).not.toHaveBeenCalled();
		expect(isMigrated()).toBe(true);
	});

	it("on failure logs the error, calls onFailure and is never ready", async () => {
		const error = new Error("relation already exists");
		const log = { info: vi.fn(), error: vi.fn() };
		const onFailure = vi.fn();

		await runBootMigrations({
			log,
			onFailure,
			migrate: () => {
				throw error;
			},
		});

		expect(migrationStatus()).toBe("failed");
		expect(isMigrated()).toBe(false);
		expect(log.error).toHaveBeenCalledWith(expect.stringContaining("migrations failed"), error);
		expect(onFailure).toHaveBeenCalledWith(error);
	});

	it("stops the process with exit code 1 by default", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
		try {
			await runBootMigrations({ log: quiet, migrate: () => Promise.reject(new Error("no")) });
			expect(exit).toHaveBeenCalledWith(1);
		} finally {
			exit.mockRestore();
		}
	});
});
