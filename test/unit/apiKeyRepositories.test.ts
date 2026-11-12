import { randomBytes } from "node:crypto";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzlePostgres } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
	MemoryApiKeyRepository,
	PostgresApiKeyRepository,
	SqliteApiKeyRepository,
} from "~~/server/utils/apiKeyRepositories";
import type { ApiKeyRecord, ApiKeyRepository } from "~~/server/utils/apiKeyService";
import { postgresApiKeysTable, sqliteApiKeysTable } from "~~/server/utils/apiKeyTables";
import { tempDir } from "../fixtures/migrations";

const T0 = new Date("2026-11-12T10:00:00.000Z");
const T1 = new Date("2026-11-12T11:00:00.000Z");

function record(id: string, extra: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
	return {
		id,
		name: `Key ${id}`,
		secretHash: "ab".repeat(32),
		scopes: ["notes:read", "notes:write"],
		createdAt: T0,
		lastUsedAt: null,
		expiresAt: null,
		revokedAt: null,
		...extra,
	};
}

/** The same behaviour is expected of each implementation. */
function repositoryContract(make: () => Promise<ApiKeyRepository> | ApiKeyRepository) {
	it("stores a record and reads it back with the same values and types", async () => {
		const repository = await make();
		const full = record("aaaaaaaaaaaaaaaa", { expiresAt: T1 });
		await repository.create(full);

		expect(await repository.findById(full.id)).toEqual(full);
		expect(await repository.findById("0000000000000000")).toBeNull();
	});

	it("refuses a second record with the same id", async () => {
		const repository = await make();
		await repository.create(record("aaaaaaaaaaaaaaaa"));

		await expect(repository.create(record("aaaaaaaaaaaaaaaa"))).rejects.toThrow();
	});

	it("lists all records", async () => {
		const repository = await make();
		await repository.create(record("aaaaaaaaaaaaaaaa"));
		await repository.create(record("bbbbbbbbbbbbbbbb", { createdAt: T1 }));

		expect((await repository.list()).map((item) => item.id)).toEqual([
			"aaaaaaaaaaaaaaaa",
			"bbbbbbbbbbbbbbbb",
		]);
	});

	it("writes the time of the last use", async () => {
		const repository = await make();
		await repository.create(record("aaaaaaaaaaaaaaaa"));
		await repository.touchLastUsed("aaaaaaaaaaaaaaaa", T1);

		expect((await repository.findById("aaaaaaaaaaaaaaaa"))?.lastUsedAt).toEqual(T1);
	});

	it("revokes once, and keeps the first time", async () => {
		const repository = await make();
		await repository.create(record("aaaaaaaaaaaaaaaa"));

		expect(await repository.revoke("aaaaaaaaaaaaaaaa", T0)).toBe(true);
		expect(await repository.revoke("aaaaaaaaaaaaaaaa", T1)).toBe(false);
		expect(await repository.revoke("0000000000000000", T1)).toBe(false);
		expect((await repository.findById("aaaaaaaaaaaaaaaa"))?.revokedAt).toEqual(T0);
	});
}

describe("MemoryApiKeyRepository", () => {
	repositoryContract(() => new MemoryApiKeyRepository());

	it("gives copies, so a caller cannot change what is stored", async () => {
		const repository = new MemoryApiKeyRepository();
		await repository.create(record("aaaaaaaaaaaaaaaa"));
		(await repository.findById("aaaaaaaaaaaaaaaa"))!.scopes.push("admin");

		expect((await repository.findById("aaaaaaaaaaaaaaaa"))?.scopes).toEqual(["notes:read", "notes:write"]);
	});
});

describe("SqliteApiKeyRepository", () => {
	repositoryContract(() => {
		const sqlite = new Database(join(tempDir(), "keys.sqlite"));
		// The table as the playground's generated migration makes it.
		sqlite.exec(`CREATE TABLE api_keys (
			id text PRIMARY KEY NOT NULL, name text NOT NULL, secret_hash text NOT NULL, scopes text NOT NULL,
			created_at integer NOT NULL, last_used_at integer, expires_at integer, revoked_at integer
		)`);

		return new SqliteApiKeyRepository(drizzleSqlite(sqlite), sqliteApiKeysTable());
	});
});

const serverUrl = process.env.TEST_POSTGRES_URL;
if (!serverUrl && process.env.CI) {
	throw new Error("TEST_POSTGRES_URL is not set, so the PostgreSQL repository tests cannot run in CI.");
}

describe.skipIf(!serverUrl)("PostgresApiKeyRepository", () => {
	const pool = new pg.Pool({ connectionString: serverUrl, max: 2 });
	const tables: string[] = [];

	afterAll(async () => {
		for (const name of tables) await pool.query(`DROP TABLE IF EXISTS ${name}`);
		await pool.end();
	});

	repositoryContract(async () => {
		// One table per test, in the server's default database.
		const name = `api_keys_test_${randomBytes(6).toString("hex")}`;
		tables.push(name);
		await pool.query(`CREATE TABLE ${name} (
			id text PRIMARY KEY NOT NULL, name text NOT NULL, secret_hash text NOT NULL, scopes jsonb NOT NULL,
			created_at timestamptz NOT NULL, last_used_at timestamptz, expires_at timestamptz, revoked_at timestamptz
		)`);

		return new PostgresApiKeyRepository(drizzlePostgres(pool), postgresApiKeysTable(name));
	});
});
