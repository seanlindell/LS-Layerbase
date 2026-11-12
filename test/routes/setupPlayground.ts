import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setup } from "@nuxt/test-utils/e2e";
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
