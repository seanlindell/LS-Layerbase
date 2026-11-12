import { fetch, url } from "@nuxt/test-utils/e2e";
import { describe, expect, it } from "vitest";
import { sessionHeaders, setupPlayground } from "./setupPlayground";

const UNAUTHORIZED = "Send a valid API key, or sign in.";

interface Issued {
	Key: { Id: string; Scopes: string[]; LastUsedAt: string | null; RevokedAt: string | null };
	PlainTextKey: string;
}

async function send(method: string, path: string, headers: Record<string, string> = {}, body?: unknown) {
	const response = await fetch(path, {
		method,
		headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();

	return { status: response.status, text, json: text ? JSON.parse(text) : null, headers: response.headers };
}

/** Issues a key as the signed-in person. */
async function issueKey(name: string, scopes: string[], expiresInSeconds?: number): Promise<Issued> {
	const result = await send("POST", "/api/keys", sessionHeaders(url("/")), {
		name,
		scopes,
		expiresInSeconds,
	});
	expect(result.status).toBe(200);

	return result.json.ResponseObject;
}

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

describe("API keys in the playground", async () => {
	await setupPlayground();

	describe("a request with a key", () => {
		it("is refused with 401 without a key or session", async () => {
			const result = await send("GET", "/api/notes/1");

			expect(result.status).toBe(401);
			expect(result.json).toMatchObject({ statusCode: 401, message: UNAUTHORIZED });
			expect(result.headers.get("www-authenticate")).toBe("Bearer");
		});

		it("passes with a valid key that has the scope", async () => {
			const key = await issueKey("Reader", ["notes:read"]);
			const result = await send("GET", "/api/notes/1", bearer(key.PlainTextKey));

			expect(result.status).toBe(200);
			expect(result.json).toEqual({ id: 1, title: "First note" });
		});

		it("can write without an Origin header", async () => {
			const key = await issueKey("Writer", ["notes:write"]);
			const result = await send("POST", "/api/notes", bearer(key.PlainTextKey), { title: "From a key" });

			expect(result.status).toBe(200);
			expect(result.json).toMatchObject({ Success: true, ResponseObject: { title: "From a key" } });
		});

		it("gives the same 401 for a wrong, unknown, malformed, revoked and expired key", async () => {
			const valid = await issueKey("Valid", ["notes:read"]);
			const revoked = await issueKey("Revoked", ["notes:read"]);
			expect((await send("DELETE", `/api/keys/${revoked.Key.Id}`, sessionHeaders(url("/")))).status).toBe(
				200,
			);
			const expired = await issueKey("Expires", ["notes:read"], 1);
			await new Promise((resolve) => setTimeout(resolve, 1100));

			const wrongSecret = `pgk_${valid.Key.Id}_${"A".repeat(43)}`;
			const unknownId = `pgk_0123456789abcdef_${"A".repeat(43)}`;
			const answers = [];
			for (const key of [wrongSecret, unknownId, "nonsense", revoked.PlainTextKey, expired.PlainTextKey]) {
				answers.push(await send("GET", "/api/notes/1", bearer(key)));
			}

			for (const answer of answers) {
				expect(answer.status).toBe(401);
				expect(answer.json.message).toBe(UNAUTHORIZED);
			}
			expect(new Set(answers.map((answer) => answer.text.replace(/"url":"[^"]*",?/, ""))).size).toBe(1);
		});

		it("is refused with 403 when the key does not have the scope", async () => {
			const key = await issueKey("Reader", ["notes:read"]);
			const result = await send("POST", "/api/notes", bearer(key.PlainTextKey), { title: "No" });

			expect(result.status).toBe(403);
			expect(result.json.message).toBe("This API key does not have the scope `notes:write`.");
		});

		it("is refused with 403 on a route that no rule opens to keys", async () => {
			const key = await issueKey("Both", ["notes:read", "notes:write"]);

			for (const [method, path] of [
				["GET", "/api/keys"],
				["POST", "/api/keys"],
				["DELETE", `/api/keys/${key.Key.Id}`],
				["DELETE", "/api/notes/1"],
			] as const) {
				const result = await send(method, path, bearer(key.PlainTextKey), method === "POST" ? {} : undefined);
				expect(result.status).toBe(403);
				expect(result.json.message).toBe("This endpoint is not available to API keys.");
			}
		});

		it("uses the key, not the session, when both are sent", async () => {
			const key = await issueKey("Reader", ["notes:read"]);
			const result = await send("GET", "/api/keys", { ...sessionHeaders(), ...bearer(key.PlainTextKey) });

			expect(result.status).toBe(403);
		});

		it("sets the identity of the request", async () => {
			const key = await issueKey("Reader", ["notes:read"]);
			const result = await send("GET", "/api/session", bearer(key.PlainTextKey));

			expect(result.json.auth).toEqual({
				kind: "key",
				keyId: key.Key.Id,
				name: "Reader",
				scopes: ["notes:read"],
			});
		});

		it("is refused with 429 and Retry-After when the rate-limit hook says no", async () => {
			const key = await issueKey("limited", ["notes:read"]);
			const result = await send("GET", "/api/notes/1", bearer(key.PlainTextKey));

			expect(result.status).toBe(429);
			expect(result.headers.get("retry-after")).toBe("30");
		});
	});

	describe("a request with a session cookie", () => {
		it("can read", async () => {
			expect((await send("GET", "/api/notes/1", sessionHeaders())).status).toBe(200);
		});

		it("cannot write without an Origin header", async () => {
			const result = await send("POST", "/api/notes", sessionHeaders(), { title: "No origin" });

			expect(result.status).toBe(403);
			expect(result.json.message).toBe("Cross-site request refused.");
		});

		it("cannot write from another site", async () => {
			const headers = { ...sessionHeaders(), origin: "https://evil.example" };

			expect((await send("POST", "/api/notes", headers, { title: "Cross-site" })).status).toBe(403);
			expect(
				(await send("POST", "/api/session", { origin: "https://evil.example" }, { name: "x" })).status,
			).toBe(403);
		});

		it("can write with the Origin of the app", async () => {
			const result = await send("POST", "/api/notes", sessionHeaders(url("/")), { title: "Same site" });

			expect(result.status).toBe(200);
		});
	});

	describe("key management", () => {
		it("shows the full key once, and lists keys without secrets or hashes", async () => {
			const key = await issueKey("Listed", ["notes:read"]);
			const secret = key.PlainTextKey.split("_").slice(2).join("_");
			const list = await send("GET", "/api/keys", sessionHeaders());

			expect(key.PlainTextKey).toMatch(/^pgk_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/);
			expect(list.status).toBe(200);
			expect(list.json.some((item: { Id: string }) => item.Id === key.Key.Id)).toBe(true);
			expect(list.text).not.toContain(secret);
			expect(list.text.toLowerCase()).not.toContain("hash");
		});

		it("refuses an unknown scope", async () => {
			const result = await send("POST", "/api/keys", sessionHeaders(url("/")), {
				name: "Bad",
				scopes: ["admin"],
			});

			expect(result.status).toBe(400);
			expect(result.json).toMatchObject({ Success: false, Message: "Unknown scope: admin." });
		});

		it("records the first use, and keeps a revoked key in the list", async () => {
			const key = await issueKey("Tracked", ["notes:read"]);
			await send("GET", "/api/notes/1", bearer(key.PlainTextKey));
			await send("DELETE", `/api/keys/${key.Key.Id}`, sessionHeaders(url("/")));

			const list = await send("GET", "/api/keys", sessionHeaders());
			const listed = list.json.find((item: { Id: string }) => item.Id === key.Key.Id);

			expect(listed.LastUsedAt).not.toBeNull();
			expect(listed.RevokedAt).not.toBeNull();
		});

		it("is closed to anonymous callers", async () => {
			expect((await send("GET", "/api/keys")).status).toBe(401);
		});
	});

	describe("paths that try to go around the rules", () => {
		it.each([
			"//api/notes/1",
			"/api//notes/1",
			"/api/notes/1/",
			"/API/notes/1",
			"/%61pi/notes/1",
			"/api%2Fnotes%2F1",
			"/api/./notes/1",
			"/x/../api/notes/1",
			"/api/notes/1?x=/api/health",
			"/api/health/../notes/1",
		])("never serves %s to an anonymous caller", async (path) => {
			// The request line is sent as written, without the client's own clean-up.
			const { request } = await import("node:http");
			const base = new URL(url("/"));
			const status = await new Promise<number>((resolve, reject) => {
				const outgoing = request(
					{ host: base.hostname, port: base.port, method: "GET", path },
					(response) => {
						response.resume();
						resolve(response.statusCode ?? 0);
					},
				);
				outgoing.on("error", reject);
				outgoing.end();
			});

			expect(status).not.toBe(200);
		});

		it("still serves public routes", async () => {
			expect((await send("GET", "/api/health")).status).toBe(200);
			expect((await send("GET", "/api/ping")).status).toBe(200);
		});
	});
});
