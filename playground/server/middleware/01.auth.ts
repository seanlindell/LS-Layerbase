// Guards everything under /api/. A route that is not named here is open to a
// signed-in person only: the key management routes under /api/keys, for example.
export default defineAuthMiddleware<PlaygroundUser>({
	apiKeys: (event) => resolve(event, "apiKeyService"),
	session: (event) => readPlaygroundSession(event),
	rules: [
		{ path: "/api/ping", public: true },
		{ path: "/api/migrations", public: true },
		{ path: "/api/request-id", public: true },
		{ path: "/api/session", public: true },
		{ method: "GET", path: /^\/api\/notes\/[^/]+$/, scope: "notes:read" },
		{ method: "POST", path: "/api/notes", scope: "notes:write" },
	],
	// A stand-in for a real limiter: a key with this name is always over its limit.
	rateLimit: (key) =>
		key.name === "limited" ? { allowed: false, retryAfterSeconds: 30 } : { allowed: true },
});
