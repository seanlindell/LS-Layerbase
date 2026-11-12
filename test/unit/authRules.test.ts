import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryApiKeyRepository } from "~~/server/utils/apiKeyRepositories";
import { ApiKeyService } from "~~/server/utils/apiKeyService";
import type { ApiKeyAuditEntry } from "~~/server/utils/apiKeyService";
import {
	authorizeRequest,
	isAllowedOrigin,
	isProtectedPath,
	matchAuthRule,
	normalizeAuthPath,
	readBearerToken,
} from "~~/server/utils/authRules";
import type { AuthPolicy, AuthRequest, AuthRule } from "~~/server/utils/authRules";

describe("normalizeAuthPath", () => {
	it.each([
		["/api/notes", "/api/notes"],
		["/api/notes/", "/api/notes"],
		["//api//notes", "/api/notes"],
		["/api\\notes", "/api/notes"],
		["/%61pi/notes", "/api/notes"],
		["/api%2Fnotes", "/api/notes"],
		["/", "/"],
		["", "/"],
	])("turns %s into %s", (input, expected) => {
		expect(normalizeAuthPath(input)).toBe(expected);
	});

	it("removes the app's base path", () => {
		expect(normalizeAuthPath("/workspace/api/notes", "/workspace/")).toBe("/api/notes");
		expect(normalizeAuthPath("/workspace", "/workspace/")).toBe("/");
		expect(normalizeAuthPath("/workspaces/api", "/workspace/")).toBe("/workspaces/api");
	});

	it("gives null for a path that cannot be decoded", () => {
		expect(normalizeAuthPath("/api/%E0%A4%A")).toBeNull();
		expect(normalizeAuthPath("/api/%00")).toBeNull();
	});
});

describe("isProtectedPath", () => {
	it("guards the prefix, whatever the case, and nothing that only looks like it", () => {
		expect(isProtectedPath("/api/notes")).toBe(true);
		expect(isProtectedPath("/api")).toBe(true);
		expect(isProtectedPath("/API/notes")).toBe(true);
		expect(isProtectedPath("/apiary")).toBe(false);
		expect(isProtectedPath("/notes")).toBe(false);
		expect(isProtectedPath("/raw/1", ["/api/", "/raw/"])).toBe(true);
	});
});

describe("matchAuthRule", () => {
	const rules: AuthRule[] = [
		{ method: "GET", path: "/api/notes", scope: "notes:read" },
		{ method: ["POST", "PUT"], path: /^\/api\/notes(\/\d+)?$/, scope: "notes:write" },
		{ path: "/api/login", public: true },
	];

	it("takes the first rule that matches the method and the path", () => {
		expect(matchAuthRule(rules, "GET", "/api/notes")?.scope).toBe("notes:read");
		expect(matchAuthRule(rules, "put", "/api/notes/5")?.scope).toBe("notes:write");
		expect(matchAuthRule(rules, "DELETE", "/api/login")?.public).toBe(true);
	});

	it("treats HEAD as GET", () => {
		expect(matchAuthRule(rules, "HEAD", "/api/notes")?.scope).toBe("notes:read");
	});

	it("gives the same answer each time for a RegExp with the g or y flag", () => {
		const stateful: AuthRule[] = [
			{ path: /^\/api\/notes/g, scope: "notes:read" },
			{ path: /\/api\/sticky/y, scope: "notes:write" },
		];

		for (let call = 0; call < 4; call++) {
			expect(matchAuthRule(stateful, "GET", "/api/notes")?.scope).toBe("notes:read");
			expect(matchAuthRule(stateful, "GET", "/api/sticky")?.scope).toBe("notes:write");
		}
	});

	it("matches a string path exactly", () => {
		expect(matchAuthRule(rules, "GET", "/api/notes/1")).toBeUndefined();
		expect(matchAuthRule(rules, "DELETE", "/api/notes")).toBeUndefined();
	});
});

describe("readBearerToken", () => {
	it("reads a bearer credential, whatever the case of the scheme", () => {
		expect(readBearerToken("Bearer abc")).toBe("abc");
		expect(readBearerToken("bearer   abc  ")).toBe("abc");
	});

	it("gives null without one", () => {
		expect(readBearerToken(undefined)).toBeNull();
		expect(readBearerToken("")).toBeNull();
		expect(readBearerToken("Basic abc")).toBeNull();
		expect(readBearerToken("Bearer")).toBeNull();
	});
});

describe("isAllowedOrigin", () => {
	it("lets safe methods through without an Origin", () => {
		for (const method of ["GET", "HEAD", "OPTIONS", "get"]) {
			expect(isAllowedOrigin(method, undefined, "app.example")).toBe(true);
		}
	});

	it("needs an Origin that names this host for other methods", () => {
		expect(isAllowedOrigin("POST", "https://app.example", "app.example")).toBe(true);
		expect(isAllowedOrigin("POST", "https://APP.example:8443", "app.example:8443")).toBe(true);
		expect(isAllowedOrigin("POST", "https://evil.example", "app.example")).toBe(false);
		expect(isAllowedOrigin("POST", "https://app.example.evil.example", "app.example")).toBe(false);
		expect(isAllowedOrigin("POST", "https://app.example:8443", "app.example")).toBe(false);
		expect(isAllowedOrigin("DELETE", undefined, "app.example")).toBe(false);
		expect(isAllowedOrigin("POST", "null", "app.example")).toBe(false);
		expect(isAllowedOrigin("POST", "not a url", "app.example")).toBe(false);
		expect(isAllowedOrigin("POST", "https://app.example", undefined)).toBe(false);
	});

	it("accepts the extra allowed origins, by scheme, host and port", () => {
		const allowed = ["https://admin.example"];

		expect(isAllowedOrigin("POST", "https://admin.example", "app.example", allowed)).toBe(true);
		expect(isAllowedOrigin("POST", "http://admin.example", "app.example", allowed)).toBe(false);
	});
});

describe("authorizeRequest", () => {
	const rules: AuthRule[] = [
		{ path: "/api/login", public: true },
		{ method: "GET", path: "/api/notes", scope: "notes:read" },
		{ method: "POST", path: "/api/notes", scope: "notes:write" },
		{ path: "/api/account", session: true },
	];
	const user = { name: "Ada" };

	let service: ApiKeyService;
	let audit: ApiKeyAuditEntry[];
	let readKey: string;
	let readKeyId: string;

	function policy(extra: Partial<AuthPolicy<typeof user>> = {}): AuthPolicy<typeof user> {
		return { rules, apiKeys: service, session: () => null, ...extra };
	}
	function request(method: string, path: string, extra: Partial<AuthRequest> = {}): AuthRequest {
		return { method, path, host: "app.example", ...extra };
	}
	const bearer = (key: string) => ({ authorization: `Bearer ${key}` });
	const signedIn = { session: () => user };

	beforeEach(async () => {
		audit = [];
		service = new ApiKeyService({
			repository: new MemoryApiKeyRepository(),
			scopes: ["notes:read", "notes:write"],
			onAudit: (entry) => void audit.push(entry),
		});
		const issued = await service.issue({ name: "Reader", scopes: ["notes:read"] });
		readKey = issued.PlainTextKey;
		readKeyId = issued.Key.Id;
		audit = [];
	});

	it("does not touch a path outside the guarded prefixes", async () => {
		expect(await authorizeRequest(request("POST", "/login"), policy())).toEqual({ allowed: true });
	});

	it("refuses a path that could not be decoded", async () => {
		expect(await authorizeRequest({ method: "GET", path: null }, policy())).toMatchObject({
			allowed: false,
			status: 400,
		});
	});

	describe("with an API key", () => {
		it("allows a valid key with the scope, and gives its identity", async () => {
			const decision = await authorizeRequest(request("GET", "/api/notes", bearer(readKey)), policy());

			expect(decision).toEqual({
				allowed: true,
				auth: { kind: "key", keyId: readKeyId, name: "Reader", scopes: ["notes:read"] },
			});
			expect(audit).toMatchObject([
				{ type: "key.used", keyId: readKeyId, method: "GET", path: "/api/notes" },
			]);
		});

		it("needs no Origin for a write with a key", async () => {
			const issued = await service.issue({ name: "Writer", scopes: ["notes:write"] });
			const decision = await authorizeRequest(
				request("POST", "/api/notes", bearer(issued.PlainTextKey)),
				policy(),
			);

			expect(decision.allowed).toBe(true);
		});

		it("answers 403 when the key does not have the scope", async () => {
			const decision = await authorizeRequest(request("POST", "/api/notes", bearer(readKey)), policy());

			expect(decision).toEqual({
				allowed: false,
				status: 403,
				message: "This API key does not have the scope `notes:write`.",
			});
			expect(audit).toMatchObject([{ type: "key.refused", reason: "missing-scope", keyId: readKeyId }]);
		});

		it("answers 403 on a route with no rule, and on a session-only route", async () => {
			for (const path of ["/api/keys", "/api/account"]) {
				expect(await authorizeRequest(request("GET", path, bearer(readKey)), policy())).toEqual({
					allowed: false,
					status: 403,
					message: "This endpoint is not available to API keys.",
				});
			}
			expect(audit.map((entry) => entry.reason)).toEqual(["not-a-key-route", "not-a-key-route"]);
		});

		it("gives the same 401 for each kind of bad key", async () => {
			const revoked = await service.issue({ name: "Old", scopes: ["notes:read"] });
			await service.revoke(revoked.Key.Id);
			audit = [];
			const bad = [
				"nonsense",
				`lsk_0123456789abcdef_${"A".repeat(43)}`,
				`lsk_${readKeyId}_${"A".repeat(43)}`,
				revoked.PlainTextKey,
			];

			const decisions = await Promise.all(
				bad.map((key) => authorizeRequest(request("GET", "/api/notes", bearer(key)), policy())),
			);

			for (const decision of decisions) {
				expect(decision).toEqual({
					allowed: false,
					status: 401,
					message: "Send a valid API key, or sign in.",
					headers: { "WWW-Authenticate": "Bearer" },
				});
			}
			expect(audit.map((entry) => entry.reason)).toEqual(["malformed", "unknown", "wrong-secret", "revoked"]);
			expect(JSON.stringify(audit)).not.toContain("AAAA");
		});

		it("uses the key and not the session when both are sent", async () => {
			const decision = await authorizeRequest(
				request("GET", "/api/account", bearer(readKey)),
				policy(signedIn),
			);

			expect(decision).toMatchObject({ allowed: false, status: 403 });
		});

		it("does not fall back to the session when the key is bad", async () => {
			const decision = await authorizeRequest(
				request("GET", "/api/notes", bearer("nonsense")),
				policy(signedIn),
			);

			expect(decision).toMatchObject({ allowed: false, status: 401 });
		});

		it("checks a key on a public route too", async () => {
			expect(await authorizeRequest(request("GET", "/api/login", bearer(readKey)), policy())).toMatchObject({
				allowed: true,
				auth: { kind: "key" },
			});
			expect(
				await authorizeRequest(request("GET", "/api/login", bearer("nonsense")), policy()),
			).toMatchObject({
				allowed: false,
				status: 401,
			});
		});

		it("answers 401 for any key in an app without keys", async () => {
			const decision = await authorizeRequest(
				request("GET", "/api/notes", bearer(readKey)),
				policy({ apiKeys: undefined }),
			);

			expect(decision).toMatchObject({ allowed: false, status: 401 });
		});

		it("answers 429 with Retry-After when the rate-limit hook refuses", async () => {
			const decision = await authorizeRequest(
				request("GET", "/api/notes", bearer(readKey)),
				policy({ rateLimit: () => ({ allowed: false, retryAfterSeconds: 12.2 }) }),
			);

			expect(decision).toEqual({
				allowed: false,
				status: 429,
				message: "Too many requests. Try again in 13 seconds.",
				headers: { "Retry-After": "13" },
			});
			expect(audit).toMatchObject([{ type: "key.refused", reason: "rate-limited" }]);
		});

		it("lets the request pass when the rate-limit hook throws", async () => {
			const log = { error: vi.fn() };
			const decision = await authorizeRequest(
				request("GET", "/api/notes", bearer(readKey)),
				policy({
					log,
					rateLimit: () => {
						throw new Error("limiter is down");
					},
				}),
			);

			expect(decision.allowed).toBe(true);
			expect(log.error).toHaveBeenCalledOnce();
		});
	});

	describe("without an API key", () => {
		it("answers 401 with no session", async () => {
			expect(await authorizeRequest(request("GET", "/api/notes"), policy())).toMatchObject({
				allowed: false,
				status: 401,
			});
		});

		it("allows a session on a scope route, a session route and a route with no rule", async () => {
			for (const path of ["/api/notes", "/api/account", "/api/keys"]) {
				expect(await authorizeRequest(request("GET", path), policy(signedIn))).toEqual({
					allowed: true,
					auth: { kind: "session", user },
				});
			}
		});

		it("refuses a cookie write without an Origin, or from another site", async () => {
			for (const origin of [undefined, "https://evil.example", "null"]) {
				expect(await authorizeRequest(request("POST", "/api/notes", { origin }), policy(signedIn))).toEqual({
					allowed: false,
					status: 403,
					message: "Cross-site request refused.",
				});
			}
		});

		it("allows a cookie write from this site", async () => {
			const decision = await authorizeRequest(
				request("POST", "/api/notes", { origin: "https://app.example" }),
				policy(signedIn),
			);

			expect(decision).toMatchObject({ allowed: true, auth: { kind: "session" } });
		});

		it("applies the Origin check to public routes too, such as login", async () => {
			expect(await authorizeRequest(request("POST", "/api/login"), policy())).toMatchObject({
				allowed: false,
				status: 403,
			});
			expect(
				await authorizeRequest(request("POST", "/api/login", { origin: "https://app.example" }), policy()),
			).toEqual({ allowed: true });
		});

		it("gives a signed-in person their identity on a public route", async () => {
			expect(await authorizeRequest(request("GET", "/api/login"), policy(signedIn))).toEqual({
				allowed: true,
				auth: { kind: "session", user },
			});
			expect(await authorizeRequest(request("GET", "/api/login"), policy())).toEqual({ allowed: true });
		});

		it("keeps GET /api/health public by default, and lets a rule close it", async () => {
			expect(await authorizeRequest(request("GET", "/api/health"), policy())).toEqual({ allowed: true });

			const closed = policy({ rules: [{ path: "/api/health", session: true }] });
			expect(await authorizeRequest(request("GET", "/api/health"), closed)).toMatchObject({
				allowed: false,
				status: 401,
			});
		});

		it("answers 401 on each guarded route in an app without sessions", async () => {
			const decision = await authorizeRequest(request("GET", "/api/notes"), policy({ session: undefined }));

			expect(decision).toMatchObject({ allowed: false, status: 401 });
		});
	});
});
