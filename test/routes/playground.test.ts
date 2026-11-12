import { fileURLToPath } from "node:url";
import { $fetch, setup } from "@nuxt/test-utils/e2e";
import { describe, expect, it } from "vitest";

describe("playground with the layer applied", async () => {
	await setup({
		rootDir: fileURLToPath(new URL("../../playground", import.meta.url)),
		server: true,
		browser: false,
	});

	it("resolves the layer's shared auto-imports in a server route", async () => {
		expect(await $fetch("/api/ping")).toEqual({ layer: "ls-layerbase" });
	});

	it("renders the layer's shared auto-imports in a page", async () => {
		const html = await $fetch<string>("/");
		expect(html).toContain('data-testid="layer-name">ls-layerbase<');
	});

	it("renders the notes page, which uses `useApi`", async () => {
		const html = await $fetch<string>("/notes");
		expect(html).toContain('data-testid="note-form"');
	});
});
