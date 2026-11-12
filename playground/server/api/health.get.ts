import { sql } from "drizzle-orm";
import pg from "pg";

// Healthy when the migrations are done and SQLite answers. When a PostgreSQL
// address is configured, that server must answer too: an app-specific check.
export default defineHealthHandler(() => {
	const postgresUrl = useRuntimeConfig().postgresUrl;
	const checks: Record<string, () => unknown> = {};

	if (postgresUrl) {
		const pool = new pg.Pool({ connectionString: postgresUrl, max: 2 });
		// Without a listener, an error on an idle connection would stop the process.
		pool.on("error", () => undefined);
		checks.postgres = () => pool.query("select 1");
	}

	return { ping: () => useDb().run(sql`select 1`), checks, timeoutMs: 1000 };
});
