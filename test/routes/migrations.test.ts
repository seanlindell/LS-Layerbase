import { $fetch } from "@nuxt/test-utils/e2e";
import { describe, expect, it } from "vitest";
import { SQLITE_MIGRATIONS, brokenCopyOf } from "../fixtures/migrations";
import { setupPlayground, startSecondServer, waitForServer } from "./setupPlayground";

describe("migrations on boot in the playground", async () => {
	await setupPlayground();

	it("has applied the migrations before the first request", async () => {
		expect(await $fetch("/api/migrations")).toEqual({ status: "done", migrated: true });
		expect(await $fetch("/api/notes/1")).toEqual({ id: 1, title: "First note" });
	});

	it("stops the server when a migration is broken", async () => {
		const server = startSecondServer({
			NUXT_LAYERBASE_MIGRATIONS_FOLDER: brokenCopyOf(SQLITE_MIGRATIONS, "0001_seed_first_note.sql"),
		});

		expect(await server.exited).toBe(1);
		expect(server.output()).toContain("Database migrations failed, so the server stops.");
	});

	it("applies nothing but reports ready when migrations on boot are off", async () => {
		const server = startSecondServer({ NUXT_LAYERBASE_MIGRATE_ON_BOOT: "false" });
		try {
			const answer = await waitForServer(`${server.url}/api/migrations`);
			expect(await answer.json()).toEqual({ status: "done", migrated: true });

			// The database is empty, because nothing was applied: the read fails.
			const response = await fetch(`${server.url}/api/notes/1`);
			expect(response.status).toBe(500);
		} finally {
			await server.stop();
		}
	});
});
