import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Migrator } from "./bootMigrations";

/**
 * Applies Drizzle migrations to a SQLite database (`better-sqlite3`). The call is
 * synchronous, so with this migrator the server never accepts a request before
 * the schema is ready.
 *
 * @param db The app's Drizzle database.
 * @param folder The migrations folder, if it is not the configured one.
 */
export function sqliteMigrator<Schema extends Record<string, unknown>>(
	db: BetterSQLite3Database<Schema>,
	folder?: string,
): Migrator {
	return (context) => migrate(db, { migrationsFolder: folder ?? context.folder });
}
