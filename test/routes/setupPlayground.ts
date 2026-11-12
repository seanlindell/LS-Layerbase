import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setup, useTestContext } from "@nuxt/test-utils/e2e";
import { tempDir } from "../fixtures/migrations";

export const PLAYGROUND = fileURLToPath(new URL("../../playground", import.meta.url));

/** The environment for a playground server with its own, empty SQLite file. */
export function playgroundEnv(extra: Record<string, string> = {}): Record<string, string> {
	return { NUXT_DATABASE_PATH: join(tempDir(), "playground.sqlite"), ...extra };
}

/**
 * Builds the playground and starts it on a temporary SQLite database, which the
 * server migrates when it starts. Call it at the top of a `describe`.
 */
export async function setupPlayground(extraEnv: Record<string, string> = {}): Promise<void> {
	await setup({ rootDir: PLAYGROUND, server: true, browser: false, env: playgroundEnv(extraEnv) });
}

/**
 * Starts one more server from the build that `setupPlayground` made, with its own
 * database and environment. For tests of what happens at startup.
 */
export function startSecondServer(env: Record<string, string> = {}) {
	const entry = join(useTestContext().nuxt!.options.nitro.output!.dir!, "server/index.mjs");
	const port = String(20_000 + Math.floor(Math.random() * 20_000));
	const child = spawn(process.execPath, [entry], {
		env: { ...process.env, NODE_ENV: "production", ...playgroundEnv(env), PORT: port, NITRO_PORT: port },
	});

	let output = "";
	child.stdout.on("data", (chunk) => (output += chunk));
	child.stderr.on("data", (chunk) => (output += chunk));
	const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));

	return {
		url: `http://127.0.0.1:${port}`,
		/** Resolves to the exit code when the server stops. */
		exited,
		/** Everything the server has written so far. */
		output: () => output,
		async stop() {
			child.kill();
			await exited;
		},
	};
}

/** Asks until the server answers, and gives the first response. */
export async function waitForServer(url: string): Promise<Response> {
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			return await fetch(url);
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	throw new Error(`No answer from ${url}`);
}
