/**
 * Whether the database schema is ready. The migration plugin writes this state;
 * the health check and any other server code read it.
 *
 * - `pending`: nothing has run yet.
 * - `running`: migrations are being applied.
 * - `done`: the schema is ready.
 * - `failed`: a migration failed. The server is about to stop.
 */
export type MigrationStatus = "pending" | "running" | "done" | "failed";

interface MigrationState {
	status: MigrationStatus;
	waiters: Array<() => void>;
}

/**
 * The state lives on `globalThis`, under a registered symbol, and not in a module
 * variable. A bundler can put two copies of a module into the server output, and
 * the plugin and a route would then each have their own flag.
 */
const KEY = Symbol.for("layerbase.migrations");

function state(): MigrationState {
	const store = globalThis as { [KEY]?: MigrationState };
	store[KEY] ??= { status: "pending", waiters: [] };

	return store[KEY];
}

export function migrationStatus(): MigrationStatus {
	return state().status;
}

/** True when the database schema is ready to use. */
export function isMigrated(): boolean {
	return state().status === "done";
}

/**
 * Resolves when the schema is ready. It does not reject: when a migration fails,
 * the server stops.
 */
export function whenMigrated(): Promise<void> {
	const current = state();
	if (current.status === "done") return Promise.resolve();

	return new Promise((resolve) => current.waiters.push(resolve));
}

/** Sets the status. `markMigrated()` is the public way to say "done". */
export function setMigrationStatus(status: MigrationStatus): void {
	const current = state();
	current.status = status;
	if (status !== "done") return;

	for (const resolve of current.waiters.splice(0)) resolve();
}

/**
 * Says that the schema is ready. The migration plugin calls this. An app that
 * applies its migrations in some other way, inside the server process, calls it
 * when they are done.
 */
export function markMigrated(): void {
	setMigrationStatus("done");
}
