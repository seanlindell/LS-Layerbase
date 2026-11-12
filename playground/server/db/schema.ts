import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sqliteApiKeysTable } from "../../../server/utils/apiKeyTables";

export const notes = sqliteTable("notes", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	title: text("title").notNull().unique(),
});

// The layer's API keys table. `drizzle-kit generate` wrote its migration with the others.
export const apiKeys = sqliteApiKeysTable();
