import { fetch } from "@nuxt/test-utils/e2e";
import { describe, expect, it } from "vitest";
import { setupPlayground, startSecondServer, waitForServer } from "./setupPlayground";

describe("GET /api/health in the playground", async () => {
	await setupPlayground();

	it("answers 200 with a fixed body, and is not cached", async () => {
		const response = await fetch("/api/health");

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('{"ok":true}');
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	it("answers 503 until the migrations are done", async () => {
		const server = startSecondServer({ NUXT_SLOW_MIGRATION_MS: "1500" });
		try {
			const early = await waitForServer(`${server.url}/api/health`);
			expect(early.status).toBe(503);
			expect(await early.text()).toBe('{"ok":false}');
			expect(early.headers.get("cache-control")).toBe("no-store");

			await expect
				.poll(async () => (await globalThis.fetch(`${server.url}/api/health`)).status, { timeout: 10_000 })
				.toBe(200);
		} finally {
			await server.stop();
		}
	});

	it("answers 503 with the same fixed body when a database is down", async () => {
		// Nothing listens on port 1, so the PostgreSQL check cannot connect.
		const server = startSecondServer({ NUXT_POSTGRES_URL: "postgres://user:secret@127.0.0.1:1/app" });
		try {
			const response = await waitForServer(`${server.url}/api/health`);

			expect(response.status).toBe(503);
			const body = await response.text();
			expect(body).toBe('{"ok":false}');
			expect(server.output()).toContain("Health check failed (postgres:");
			expect(server.output()).not.toContain("secret");
		} finally {
			await server.stop();
		}
	});
});
