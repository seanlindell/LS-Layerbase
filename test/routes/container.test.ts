import { $fetch } from "@nuxt/test-utils/e2e";
import { describe, expect, it } from "vitest";
import { setupPlayground } from "./setupPlayground";

interface RequestIdAnswer {
	requestId: string;
	sameAgain: string;
	sameService: boolean;
}

describe("container in the playground", async () => {
	await setupPlayground();

	it("resolves a service from a route", async () => {
		expect(await $fetch("/api/notes/1")).toEqual({ id: 1, title: "First note" });
	});

	it("gives each request its own scope, and shares singletons between them", async () => {
		const first = await $fetch<RequestIdAnswer>("/api/request-id");
		const second = await $fetch<RequestIdAnswer>("/api/request-id");

		expect(first.requestId).toMatch(/^[0-9a-f-]{36}$/);
		expect(first.sameAgain).toBe(first.requestId);
		expect(second.requestId).not.toBe(first.requestId);
		expect(first.sameService).toBe(true);
	});
});
