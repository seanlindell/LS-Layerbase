import { spawn } from "node:child_process";
import { join } from "node:path";
import { $fetch, useTestContext } from "@nuxt/test-utils/e2e";
import { describe, expect, it } from "vitest";
import { SQLITE_MIGRATIONS, brokenCopyOf } from "../fixtures/migrations";
import { playgroundEnv, setupPlayground } from "./setupPlayground";

/** Starts a second server from the same build and waits until it stops or answers. */
function startServer(env: Record<string, string>) {
	const entry = join(useTestContext().nuxt!.options.nitro.output!.dir!, "server/index.mjs");
	const port = String(20_000 + Math.floor(Math.random() * 20_000));
	const child = spawn(process.execPath, [entry], {
		env: { ...process.env, NODE_ENV: "production", ...playgroundEnv(env), PORT: port, NITRO_PORT: port },
	});

	let output = "";
	child.stdout.on("data", (chunk) => (output += chunk));
	child.stderr.on("data", (chunk) => (output += chunk));
	const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));

	return { child, exited, port, output: () => output };
}

async function waitForAnswer(url: string): Promise<unknown> {
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			return await (await fetch(url)).json();
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	throw new Error(`No answer from ${url}`);
}

describe("migrations on boot in the playground", async () => {
	await setupPlayground();

	it("has applied the migrations before the first request", async () => {
		expect(await $fetch("/api/migrations")).toEqual({ status: "done", migrated: true });
		expect(await $fetch("/api/notes/1")).toEqual({ id: 1, title: "First note" });
	});

	it("stops the server when a migration is broken", async () => {
		const server = startServer({
			NUXT_LAYERBASE_MIGRATIONS_FOLDER: brokenCopyOf(SQLITE_MIGRATIONS, "0001_seed_first_note.sql"),
		});

		expect(await server.exited).toBe(1);
		expect(server.output()).toContain("Database migrations failed, so the server stops.");
	});

	it("applies nothing but reports ready when migrations on boot are off", async () => {
		const server = startServer({ NUXT_LAYERBASE_MIGRATE_ON_BOOT: "false" });
		try {
			const answer = await waitForAnswer(`http://127.0.0.1:${server.port}/api/migrations`);
			expect(answer).toEqual({ status: "done", migrated: true });

			// The database is empty, because nothing was applied: the read fails.
			const response = await fetch(`http://127.0.0.1:${server.port}/api/notes/1`);
			expect(response.status).toBe(500);
		} finally {
			server.child.kill();
			await server.exited;
		}
	});
});
