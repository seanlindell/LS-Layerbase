import type { H3Event } from "h3";
import type { ApiKeyIdentity } from "./apiKeyService";
import { AUTH_MESSAGES, authorizeRequest, normalizeAuthPath } from "./authRules";
import type { ApiKeyAuthenticator, AuthIdentity, AuthRule, RateLimitDecision } from "./authRules";
import { httpError } from "./handlers";

declare module "h3" {
	interface H3EventContext {
		/** Who is making the request. Not set on public routes without a credential. */
		auth?: AuthIdentity;
	}
}

export interface AuthMiddlewareOptions<User = unknown> {
	/**
	 * The rules, first match first. A path with no rule is open to sessions only.
	 * `GET /api/health` is public unless a rule here says otherwise.
	 */
	rules?: readonly AuthRule[];
	/** Path prefixes that the middleware guards. The default is `["/api/"]`. */
	protect?: readonly string[];
	/** The app's API key service for this request, usually from the container. Leave it out for an app without keys. */
	apiKeys?: (event: H3Event) => ApiKeyAuthenticator;
	/**
	 * The signed-in user of this request, or null. With `nuxt-auth-utils`:
	 * `async (event) => (await getUserSession(event)).user ?? null`.
	 * Leave it out for an app without sessions.
	 */
	session?: (event: H3Event) => Promise<User | null | undefined> | User | null | undefined;
	/** More origins that may send cookie-authenticated writes, for example `https://admin.example.com`. */
	allowedOrigins?: readonly string[];
	/** Asked for each request with a valid key. A refusal is a 429 with `Retry-After`. */
	rateLimit?: (key: ApiKeyIdentity, event: H3Event) => Promise<RateLimitDecision> | RateLimitDecision;
}

/**
 * The server middleware that checks API keys and sessions. See
 * docs/api-keys-design.md for the rules.
 *
 *     // server/middleware/01.auth.ts
 *     export default defineAuthMiddleware({
 *       apiKeys: (event) => resolve(event, "apiKeyService"),
 *       rules: [{ method: "GET", path: "/api/notes", scope: "notes:read" }],
 *     });
 */
export function defineAuthMiddleware<User = unknown>(options: AuthMiddlewareOptions<User>) {
	return defineEventHandler(async (event) => {
		const url = getRequestURL(event, { xForwardedHost: true });
		const decision = await authorizeRequest<User>(
			{
				method: event.method,
				path: normalizeAuthPath(url.pathname, useRuntimeConfig(event).app.baseURL),
				authorization: getRequestHeader(event, "authorization"),
				origin: getRequestHeader(event, "origin"),
				host: url.host,
			},
			{
				rules: options.rules,
				protect: options.protect,
				allowedOrigins: options.allowedOrigins,
				apiKeys: options.apiKeys?.(event),
				session: options.session ? () => options.session!(event) : undefined,
				rateLimit: options.rateLimit ? (key) => options.rateLimit!(key, event) : undefined,
			},
		);

		if (!decision.allowed) {
			for (const [name, value] of Object.entries(decision.headers ?? {}))
				setResponseHeader(event, name, value);
			throw httpError(decision.status, decision.message);
		}

		if (decision.auth) event.context.auth = decision.auth;
	});
}

/** The identity of the request, or a 401. For a handler on a route that the rules leave public. */
export function requireAuth(event: H3Event): AuthIdentity {
	const auth = event.context.auth;
	if (!auth) throw httpError(401, AUTH_MESSAGES.unauthorized);

	return auth;
}

/** A session identity, or a 403 for an API key. For handlers that only a person may call. */
export function requireSession<User = unknown>(event: H3Event): { kind: "session"; user: User } {
	const auth = requireAuth(event);
	if (auth.kind !== "session") throw httpError(403, AUTH_MESSAGES.notForKeys);

	return auth as { kind: "session"; user: User };
}

/** Passes for a session, and for an API key with the scope. Otherwise a 403. */
export function requireScope(event: H3Event, scope: string): AuthIdentity {
	const auth = requireAuth(event);
	if (auth.kind === "key" && !auth.scopes.includes(scope)) {
		throw httpError(403, AUTH_MESSAGES.missingScope(scope));
	}

	return auth;
}
