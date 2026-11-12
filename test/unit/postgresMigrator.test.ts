import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runBootMigrations } from "~~/server/utils/bootMigrations";
import { isMigrated, migrationStatus, setMigrationStatus } from "~~/server/utils/migrationState";
import { postgresMigrator } from "~~/server/utils/postgresMigrator";
import { POSTGRES_MIGRATIONS, brokenCopyOf } from "../fixtures/migrations";

/**
 * These tests need a PostgreSQL server. Give its address in `TEST_POSTGRES_URL`,
 * for example `postgres://postgres:postgres@localhost:5432/postgres`. Each test
 * makes its own database on that server and drops it afterwards.
 *
 * Without the variable the tests are skipped, except in CI, where a missing
 * variable is a failure.
 */
const serverUrl = process.env.TEST_POSTGRES_URL;
const quiet = { info: () => undefined, error: () => undefined };

if (!serverUrl && process.env.CI) {
	throw new Error("TEST_POSTGRES_URL is not set, so the PostgreSQL migration tests cannot run in CI.");
}

describe.skipIf(!serverUrl)("postgresMigrator", () => {
	const admin = new pg.Client(serverUrl);
	const databases: string[] = [];

	async function throwawayDatabase(): Promise<string> {
		const name = `layerbase_test_${randomBytes(6).toString("hex")}`;
		await admin.query(`CREATE DATABASE ${name}`);
		databases.push(name);
		const url = new URL(serverUrl!);
		url.pathname = `/${name}`;

		return url.toString();
	}

	async function query(url: string, sql: string): Promise<unknown[]> {
		const client = new pg.Client(url);
		await client.connect();
		try {
			return (await client.query(sql)).rows;
		} finally {
			await client.end();
		}
	}

	beforeAll(() => admin.connect());
	beforeEach(() => setMigrationStatus("pending"));
	afterAll(async () => {
		for (const name of databases) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
		await admin.end();
	});

	it("applies the migrations to a fresh database, sets the flag and logs notices", async () => {
		const url = await throwawayDatabase();
		const warn = vi.fn();
		const migrate = postgresMigrator({
			createClient: () => new pg.Client(url),
			folder: POSTGRES_MIGRATIONS,
			log: { warn },
		});

		const run = runBootMigrations({ log: quiet, migrate });
		expect(migrationStatus()).toBe("running");
		await run;

		expect(isMigrated()).toBe(true);
		expect(await query(url, "SELECT name FROM widgets")).toEqual([{ name: "first" }]);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("widgets table created"));
	});

	it("lets two instances that start together both finish", async () => {
		const url = await throwawayDatabase();
		const instance = () =>
			postgresMigrator({
				createClient: () => new pg.Client(url),
				folder: POSTGRES_MIGRATIONS,
				log: { warn: () => undefined },
			})({ folder: "not-used" });

		await Promise.all([instance(), instance()]);

		expect(await query(url, "SELECT count(*)::int AS count FROM widgets")).toEqual([{ count: 1 }]);
	});

	it("stops startup on a broken migration and closes its connections", async () => {
		const url = await throwawayDatabase();
		const onFailure = vi.fn();
		const clients: pg.Client[] = [];
		const migrate = postgresMigrator({
			createClient: () => {
				const client = new pg.Client(url);
				clients.push(client);

				return client;
			},
			folder: brokenCopyOf(POSTGRES_MIGRATIONS, "0001_seed_widget.sql"),
			log: { warn: () => undefined },
		});

		await runBootMigrations({ log: quiet, onFailure, migrate });

		expect(onFailure).toHaveBeenCalledOnce();
		expect(isMigrated()).toBe(false);
		expect(clients).toHaveLength(2);
		// The lock is gone with its session, so a new run can take it at once.
		expect(
			await query(url, "SELECT count(*)::int AS count FROM pg_locks WHERE locktype = 'advisory'"),
		).toEqual([{ count: 0 }]);
	});

	it("stops startup when the database cannot be reached", async () => {
		const onFailure = vi.fn();
		const unreachable = new URL(serverUrl!);
		unreachable.pathname = "/layerbase_test_does_not_exist";

		await runBootMigrations({
			log: quiet,
			onFailure,
			migrate: postgresMigrator({
				createClient: () => new pg.Client(unreachable.toString()),
				folder: POSTGRES_MIGRATIONS,
			}),
		});

		expect(onFailure).toHaveBeenCalledOnce();
		expect(isMigrated()).toBe(false);
	});
});
