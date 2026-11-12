import { fetch, url } from "@nuxt/test-utils/e2e";
import { describe, expect, it } from "vitest";
import { sessionHeaders, setupPlayground } from "./setupPlayground";

const SECRET = "SQLITE_ERROR";

async function post(body: string) {
	const response = await fetch("/api/notes", {
		method: "POST",
		headers: { "content-type": "application/json", ...sessionHeaders(url("/")) },
		body,
	});

	return { status: response.status, text: await response.text() };
}

async function get(path: string) {
	const response = await fetch(path, { headers: { accept: "application/json", ...sessionHeaders() } });

	return { status: response.status, text: await response.text() };
}

describe("error contract in the playground", async () => {
	await setupPlayground();

	describe("defineApiHandler (reads)", () => {
		it("returns the value on success", async () => {
			const { status, text } = await get("/api/notes/1");
			expect(status).toBe(200);
			expect(JSON.parse(text)).toEqual({ id: 1, title: "First note" });
		});

		it("sends a typed error as an h3 error with the real status", async () => {
			const { status, text } = await get("/api/notes/999");
			expect(status).toBe(404);
			expect(JSON.parse(text)).toMatchObject({
				statusCode: 404,
				statusMessage: "Not Found",
				message: "There is no note with id 999.",
			});
		});

		it("passes an h3 4xx through", async () => {
			const { status, text } = await get("/api/notes/abc");
			expect(status).toBe(400);
			expect(JSON.parse(text)).toMatchObject({ statusCode: 400, message: "The id must be a whole number." });
		});

		it("hides an unexpected error behind a generic 500", async () => {
			const { status, text } = await get("/api/notes/bug");
			expect(status).toBe(500);
			expect(JSON.parse(text)).toMatchObject({
				statusCode: 500,
				message: "The server could not complete the request. Try again later.",
			});
			expect(text).not.toContain(SECRET);
		});
	});

	describe("defineActionHandler (writes)", () => {
		it("returns a successful ActionResult", async () => {
			const { status, text } = await post(JSON.stringify({ title: "Second note" }));
			expect(status).toBe(200);
			expect(JSON.parse(text)).toEqual({
				Success: true,
				Message: "Note created.",
				ResponseObject: { id: 2, title: "Second note" },
			});
		});

		it("keeps the ActionResult body and sets the real status on a refusal", async () => {
			const { status, text } = await post(JSON.stringify({ title: "  " }));
			expect(status).toBe(400);
			expect(JSON.parse(text)).toEqual({
				Success: false,
				Message: "Send a `title` that is not empty.",
				ResponseObject: null,
			});
		});

		it("carries the existing record on a conflict", async () => {
			const { status, text } = await post(JSON.stringify({ title: "First note" }));
			expect(status).toBe(409);
			expect(JSON.parse(text)).toEqual({
				Success: false,
				Message: "A note with that title already exists.",
				ResponseObject: { id: 1, title: "First note" },
			});
		});

		it("keeps the ActionResult body for a body that is not JSON", async () => {
			const { status, text } = await post("{not json");
			expect(status).toBe(400);
			expect(JSON.parse(text)).toMatchObject({ Success: false, ResponseObject: null });
		});

		it("sends a typed 5xx with its own message", async () => {
			const { status, text } = await post(JSON.stringify({ title: "upstream" }));
			expect(status).toBe(502);
			expect(JSON.parse(text)).toEqual({
				Success: false,
				Message: "The title service did not answer.",
				ResponseObject: null,
			});
		});

		it("hides an unexpected error behind a generic 500", async () => {
			const { status, text } = await post(JSON.stringify({ title: "bug" }));
			expect(status).toBe(500);
			expect(JSON.parse(text)).toEqual({
				Success: false,
				Message: "The server could not complete the request. Try again later.",
				ResponseObject: null,
			});
			expect(text).not.toContain(SECRET);
		});
	});
});
