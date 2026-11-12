import { and, asc, eq, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { ApiKeyRecord, ApiKeyRepository } from "./apiKeyService";
import type { PostgresApiKeysTable, SqliteApiKeysTable } from "./apiKeyTables";

/** API keys in SQLite (`better-sqlite3`), in the table from `sqliteApiKeysTable()`. */
export class SqliteApiKeyRepository implements ApiKeyRepository {
	constructor(
		// The app's schema type does not matter here, so each one is accepted.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		private readonly db: BetterSQLite3Database<any>,
		private readonly table: SqliteApiKeysTable,
	) {}

	async create(record: ApiKeyRecord): Promise<void> {
		this.db.insert(this.table).values(record).run();
	}

	async findById(id: string): Promise<ApiKeyRecord | null> {
		return this.db.select().from(this.table).where(eq(this.table.id, id)).get() ?? null;
	}

	async list(): Promise<ApiKeyRecord[]> {
		return this.db.select().from(this.table).orderBy(asc(this.table.createdAt), asc(this.table.id)).all();
	}

	async touchLastUsed(id: string, at: Date): Promise<void> {
		this.db.update(this.table).set({ lastUsedAt: at }).where(eq(this.table.id, id)).run();
	}

	async revoke(id: string, at: Date): Promise<boolean> {
		const result = this.db
			.update(this.table)
			.set({ revokedAt: at })
			.where(and(eq(this.table.id, id), isNull(this.table.revokedAt)))
			.run();

		return result.changes > 0;
	}
}

/** API keys in PostgreSQL (`pg`), in the table from `postgresApiKeysTable()`. */
export class PostgresApiKeyRepository implements ApiKeyRepository {
	constructor(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		private readonly db: NodePgDatabase<any>,
		private readonly table: PostgresApiKeysTable,
	) {}

	async create(record: ApiKeyRecord): Promise<void> {
		await this.db.insert(this.table).values(record);
	}

	async findById(id: string): Promise<ApiKeyRecord | null> {
		const rows = await this.db.select().from(this.table).where(eq(this.table.id, id)).limit(1);

		return rows[0] ?? null;
	}

	async list(): Promise<ApiKeyRecord[]> {
		return await this.db.select().from(this.table).orderBy(asc(this.table.createdAt), asc(this.table.id));
	}

	async touchLastUsed(id: string, at: Date): Promise<void> {
		await this.db.update(this.table).set({ lastUsedAt: at }).where(eq(this.table.id, id));
	}

	async revoke(id: string, at: Date): Promise<boolean> {
		const rows = await this.db
			.update(this.table)
			.set({ revokedAt: at })
			.where(and(eq(this.table.id, id), isNull(this.table.revokedAt)))
			.returning({ id: this.table.id });

		return rows.length > 0;
	}
}

/** API keys in memory. For tests, and for a first look without a database. */
export class MemoryApiKeyRepository implements ApiKeyRepository {
	private readonly records = new Map<string, ApiKeyRecord>();

	async create(record: ApiKeyRecord): Promise<void> {
		if (this.records.has(record.id)) throw new Error(`An API key with id ${record.id} exists already.`);
		this.records.set(record.id, { ...record, scopes: [...record.scopes] });
	}

	async findById(id: string): Promise<ApiKeyRecord | null> {
		const record = this.records.get(id);

		return record ? { ...record, scopes: [...record.scopes] } : null;
	}

	async list(): Promise<ApiKeyRecord[]> {
		return [...this.records.values()].map((record) => ({ ...record, scopes: [...record.scopes] }));
	}

	async touchLastUsed(id: string, at: Date): Promise<void> {
		const record = this.records.get(id);
		if (record) record.lastUsedAt = at;
	}

	async revoke(id: string, at: Date): Promise<boolean> {
		const record = this.records.get(id);
		if (!record || record.revokedAt !== null) return false;
		record.revokedAt = at;

		return true;
	}
}
