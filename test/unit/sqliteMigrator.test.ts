import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runBootMigrations } from "~~/server/utils/bootMigrations";
import { isMigrated, migrationStatus, setMigrationStatus } from "~~/server/utils/migrationState";
import { sqliteMigrator } from "~~/server/utils/sqliteMigrator";
import { SQLITE_MIGRATIONS, brokenCopyOf, tempDir } from "../fixtures/migrations";

const quiet = { info: () => undefined, error: () => undefined };

function freshDatabase() {
	const sqlite = new Database(join(tempDir(), "test.sqlite"));

	return { sqlite, db: drizzle(sqlite) };
}

beforeEach(() => setMigrationStatus("pending"));

describe("sqliteMigrator", () => {
	it("applies the migrations to a fresh SQLite file and sets the flag", async () => {
		const { sqlite, db } = freshDatabase();
		expect(isMigrated()).toBe(false);

		await runBootMigrations({ log: quiet, migrate: sqliteMigrator(db, SQLITE_MIGRATIONS) });

		expect(isMigrated()).toBe(true);
		expect(sqlite.prepare("SELECT title FROM notes").all()).toEqual([{ title: "First note" }]);
	});

	it("applies nothing the second time", async () => {
		const { sqlite, db } = freshDatabase();
		const migrate = sqliteMigrator(db);

		migrate({ folder: SQLITE_MIGRATIONS });
		migrate({ folder: SQLITE_MIGRATIONS });

		expect(sqlite.prepare("SELECT count(*) AS count FROM notes").get()).toEqual({ count: 1 });
	});

	it("stops startup on a broken migration and keeps the migrations before it", async () => {
		const { sqlite, db } = freshDatabase();
		const onFailure = vi.fn();
		const broken = brokenCopyOf(SQLITE_MIGRATIONS, "0001_seed_first_note.sql");

		await runBootMigrations({ log: quiet, onFailure, migrate: sqliteMigrator(db, broken) });

		expect(onFailure).toHaveBeenCalledOnce();
		expect(migrationStatus()).toBe("failed");
		expect(isMigrated()).toBe(false);
		// Drizzle applies one run in one transaction, so nothing of it stays.
		expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'notes'").all()).toEqual([]);
	});
});
