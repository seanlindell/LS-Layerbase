import { createHealthProbe } from "./healthProbe";
import type { HealthProbeOptions } from "./healthProbe";

/**
 * The handler for the health route:
 *
 *     // server/api/health.get.ts
 *     export default defineHealthHandler(() => ({ ping: () => db.run(sql`select 1`) }));
 *
 * It answers 200 with `{ "ok": true }` when the migrations are done and each
 * check passes, and 503 with `{ "ok": false }` otherwise. The body is fixed: it
 * has no version, host name or error text, because the route is public.
 *
 * The options come from a function, which runs on the first request, so that
 * nothing touches the database when the module loads.
 */
export function defineHealthHandler(options: () => HealthProbeOptions = () => ({})) {
	let probe: (() => Promise<boolean>) | undefined;

	return defineEventHandler(async (event) => {
		probe ??= createHealthProbe(options());
		const ok = await probe();

		setResponseStatus(event, ok ? 200 : 503);
		// A cached answer would hide a change of state from the platform.
		setResponseHeader(event, "Cache-Control", "no-store");

		return { ok };
	});
}
