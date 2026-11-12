import { resolve } from "node:path";
import { markMigrated, setMigrationStatus } from "./migrationState";

/** What a migrator is told when it runs. */
export interface MigrationContext {
	/** The absolute path of the configured migrations folder. */
	folder: string;
}

/** Applies the pending migrations. It throws, or rejects, when one fails. */
export type Migrator = (context: MigrationContext) => void | Promise<void>;

export const DEFAULT_MIGRATIONS_FOLDER = "./drizzle";

export interface BootMigrationOptions {
	/**
	 * Applies the pending migrations. Use `sqliteMigrator(...)` or
	 * `postgresMigrator(...)`, or pass a function of your own.
	 */
	migrate: Migrator;
	/** The migrations folder, relative to the working directory. The default is `./drizzle`. */
	folder?: string;
	/**
	 * False for an app that runs its migrations elsewhere. Nothing is applied, and
	 * the schema is reported as ready at once.
	 */
	enabled?: boolean;
	/** Called after a failed migration has been logged. The default stops the process. */
	onFailure?: (error: unknown) => void;
	log?: Pick<Console, "info" | "error">;
}

/**
 * Applies the migrations once, at startup, and keeps the readiness state.
 *
 * If a migration fails, the error is logged and the process stops with exit code 1.
 * A server that keeps running with a schema that is half applied fails each
 * request at its first query, and the cause is far up in the log.
 */
export async function runBootMigrations(options: BootMigrationOptions): Promise<void> {
	const log = options.log ?? console;

	if (options.enabled === false) {
		log.info("[layerbase] Migrations on boot are off. The database schema is taken as ready.");
		markMigrated();

		return;
	}

	setMigrationStatus("running");
	try {
		await options.migrate({ folder: resolve(options.folder || DEFAULT_MIGRATIONS_FOLDER) });
	} catch (error) {
		setMigrationStatus("failed");
		log.error(
			"[layerbase] Database migrations failed, so the server stops. Check that the database can be reached and that the migrations folder is correct.",
			error,
		);
		(options.onFailure ?? (() => process.exit(1)))(error);

		return;
	}

	markMigrated();
	log.info("[layerbase] Database migrations are applied.");
}
