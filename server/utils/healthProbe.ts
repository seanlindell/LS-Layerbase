import { isMigrated } from "./migrationState";

/** A check passes when it returns or resolves. It fails when it throws, rejects or gives `false`. */
export type HealthCheck = () => unknown;

export interface HealthProbeOptions {
	/**
	 * A trivial query against the database, for example
	 * `() => db.run(sql\`select 1\`)`. It is the check with the name `database`.
	 */
	ping?: HealthCheck;
	/** More checks that are specific to the app, by name. The name is only used in the log. */
	checks?: Record<string, HealthCheck>;
	/** How long one check may take, in milliseconds. The default is 2000. */
	timeoutMs?: number;
	/**
	 * Report unhealthy until the migrations are done. The default is true. Set it
	 * to false in an app that does not use the layer's migration plugin.
	 */
	requireMigrations?: boolean;
	log?: Pick<Console, "info" | "warn">;
}

export const DEFAULT_HEALTH_TIMEOUT_MS = 2000;

const TIMED_OUT = Symbol("timed out");

/**
 * Builds the function behind the health route. It resolves to `true` only when
 * the migrations are done and each check passes within the timeout. It never rejects.
 *
 * Each check runs at most once at a time. Probes that arrive while a check is
 * still running wait for that same run and start no second one. A database that
 * has stalled thus holds one connection, however many probes arrive, and each
 * probe still gets its answer after the timeout.
 *
 * The reason for a failure goes to the log, when the result changes. The caller
 * of the route only learns healthy or not.
 */
export function createHealthProbe(options: HealthProbeOptions = {}): () => Promise<boolean> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
	const log = options.log ?? console;
	const checks: Record<string, HealthCheck> = { ...options.checks };
	if (options.ping) checks.database = options.ping;

	const running = new Map<string, Promise<string | null>>();
	let lastProblem: string | null = null;

	/** Runs one check, or joins the run in progress. Resolves to the problem, or null. */
	function run(name: string, check: HealthCheck): Promise<string | null> {
		let current = running.get(name);
		if (!current) {
			current = Promise.resolve()
				.then(check)
				.then(
					(result) => (result === false ? `${name}: the check gave false` : null),
					(error: unknown) => `${name}: ${error instanceof Error ? error.message : String(error)}`,
				)
				.finally(() => running.delete(name));
			running.set(name, current);
		}

		return current;
	}

	async function withTimeout(name: string, check: HealthCheck): Promise<string | null> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
			timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
		});

		try {
			const result = await Promise.race([run(name, check), timeout]);

			return result === TIMED_OUT ? `${name}: no answer within ${timeoutMs} ms` : result;
		} finally {
			clearTimeout(timer);
		}
	}

	async function findProblem(): Promise<string | null> {
		if (options.requireMigrations !== false && !isMigrated()) return "migrations: not done";

		const problems = await Promise.all(
			Object.entries(checks).map(([name, check]) => withTimeout(name, check)),
		);

		return problems.find((problem) => problem !== null) ?? null;
	}

	return async () => {
		const problem = await findProblem();
		if (problem !== lastProblem) {
			if (problem) log.warn(`[layerbase] Health check failed (${problem}).`);
			else log.info("[layerbase] Health check passes again.");
			lastProblem = problem;
		}

		return problem === null;
	};
}
