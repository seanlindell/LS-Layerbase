import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema";

let database: BetterSQLite3Database<typeof schema> | undefined;

/** The playground's database, opened on first use. */
export function useDb(): BetterSQLite3Database<typeof schema> {
	if (!database) {
		const path = useRuntimeConfig().databasePath;
		mkdirSync(dirname(path), { recursive: true });
		const sqlite = new Database(path);
		sqlite.pragma("journal_mode = WAL");
		database = drizzle(sqlite, { schema });
	}

	return database;
}
