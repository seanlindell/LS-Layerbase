import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Migrator } from "./bootMigrations";

/**
 * The parts of a `pg.Client` that the migrator uses. The layer does not import
 * `pg`, so an app that uses SQLite does not need it.
 */
export interface MigrationClient {
	connect(): Promise<unknown>;
	query(text: string, values?: unknown[]): Promise<unknown>;
	end(): Promise<unknown>;
	on?(event: "notice", listener: (notice: { message?: string }) => void): unknown;
}

export interface PostgresMigratorOptions {
	/**
	 * Makes a new, unconnected client: `() => new pg.Client(connectionString)`.
	 * It is called twice, because the lock and the migrations each need a
	 * connection of their own. Do not return a client from a pool.
	 */
	createClient: () => MigrationClient;
	/** The migrations folder, if it is not the configured one. */
	folder?: string;
	/**
	 * The id of the advisory lock. All instances of one app must use the same id.
	 * Change it only when two apps share one database.
	 */
	lockId?: number;
	log?: Pick<Console, "warn">;
}

/** An arbitrary number. It only has to be the same in each instance of the app. */
export const DEFAULT_MIGRATION_LOCK_ID = 5_297_302_711;

/**
 * Applies Drizzle migrations to a PostgreSQL database (`pg`), one instance at a time.
 *
 * Drizzle reads the list of applied migrations before it opens its transaction.
 * Two instances that start together would both decide to run the same migrations,
 * and the second would fail on the first statement that cannot run twice. A
 * session-level advisory lock around the whole run makes the second instance wait,
 * and it then finds nothing left to do.
 *
 * The lock is held on its own connection, because it must outlive the connection
 * that the migrations run on. Notices from a migration (`RAISE NOTICE`,
 * `RAISE WARNING`) go to the log.
 */
export function postgresMigrator(options: PostgresMigratorOptions): Migrator {
	const lockId = options.lockId ?? DEFAULT_MIGRATION_LOCK_ID;
	const log = options.log ?? console;

	return async (context) => {
		const folder = options.folder ?? context.folder;
		const lockClient = options.createClient();
		const migrationClient = options.createClient();
		migrationClient.on?.("notice", (notice) => {
			log.warn(`[layerbase] Migration notice: ${notice.message ?? "(no message)"}`);
		});

		try {
			await lockClient.connect();
			await migrationClient.connect();
			await lockClient.query("SELECT pg_advisory_lock($1)", [lockId]);
			await migrate(drizzle(migrationClient as never), { migrationsFolder: folder });
		} finally {
			// To close the session releases the lock, also when a migration threw.
			await Promise.allSettled([migrationClient.end(), lockClient.end()]);
		}
	};
}
