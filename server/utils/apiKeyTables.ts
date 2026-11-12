import { jsonb, pgTable, text as pgText, timestamp } from "drizzle-orm/pg-core";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const DEFAULT_API_KEYS_TABLE = "api_keys";

/**
 * The API keys table for SQLite. Add it to the app's Drizzle schema, and let
 * `drizzle-kit generate` write the migration:
 *
 *     export const apiKeys = sqliteApiKeysTable();
 */
export function sqliteApiKeysTable(name: string = DEFAULT_API_KEYS_TABLE) {
	return sqliteTable(name, {
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		secretHash: text("secret_hash").notNull(),
		scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
		revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
	});
}

/** The API keys table for PostgreSQL. See `sqliteApiKeysTable`. */
export function postgresApiKeysTable(name: string = DEFAULT_API_KEYS_TABLE) {
	return pgTable(name, {
		id: pgText("id").primaryKey(),
		name: pgText("name").notNull(),
		secretHash: pgText("secret_hash").notNull(),
		scopes: jsonb("scopes").$type<string[]>().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
		lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
		expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
		revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
	});
}

export type SqliteApiKeysTable = ReturnType<typeof sqliteApiKeysTable>;
export type PostgresApiKeysTable = ReturnType<typeof postgresApiKeysTable>;
