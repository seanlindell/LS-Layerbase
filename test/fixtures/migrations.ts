import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The playground's SQLite migrations: a `notes` table and one seeded note. */
export const SQLITE_MIGRATIONS = fileURLToPath(new URL("../../playground/drizzle", import.meta.url));
/** PostgreSQL migrations: a `widgets` table (with a notice) and one seeded widget. */
export const POSTGRES_MIGRATIONS = fileURLToPath(new URL("./pg-migrations", import.meta.url));

export function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "layerbase-test-"));
}

/** A copy of a migrations folder whose last migration is not valid SQL. */
export function brokenCopyOf(folder: string, lastMigration: string): string {
	const copy = join(tempDir(), "migrations");
	cpSync(folder, copy, { recursive: true });
	writeFileSync(join(copy, lastMigration), "THIS IS NOT SQL;\n");

	return copy;
}
