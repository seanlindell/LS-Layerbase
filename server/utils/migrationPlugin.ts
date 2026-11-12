import { runBootMigrations } from "./bootMigrations";
import type { Migrator } from "./bootMigrations";

export interface MigrationPluginOptions {
	/** Applies the pending migrations: `sqliteMigrator(...)`, `postgresMigrator(...)` or your own function. */
	migrate: Migrator;
	/** Overrides the `layerbase.migrateOnBoot` runtime config value. */
	enabled?: boolean;
	/** Overrides the `layerbase.migrationsFolder` runtime config value. */
	folder?: string;
}

/**
 * A Nitro plugin that applies the database migrations when the server starts.
 *
 *     // server/plugins/00.migrate.ts
 *     export default defineMigrationPlugin(() => ({ migrate: sqliteMigrator(db) }));
 *
 * Name the file so that it sorts before the plugins that use the database.
 *
 * The options come from a function, so that nothing touches the database when the
 * module loads. Nitro does not wait for a plugin that is asynchronous: with
 * PostgreSQL the server can accept requests while migrations still run. Use
 * `isMigrated()` or `await whenMigrated()` in code that must not run before that.
 */
export function defineMigrationPlugin(options: () => MigrationPluginOptions) {
	return defineNitroPlugin(() => {
		const config = useRuntimeConfig().layerbase;
		const { migrate, enabled, folder } = options();

		// Nitro does not use the returned promise.
		void runBootMigrations({
			migrate,
			enabled: enabled ?? config.migrateOnBoot !== false,
			folder: folder || config.migrationsFolder,
		});
	});
}
