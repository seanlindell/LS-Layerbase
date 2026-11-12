import type { ApiKeyAuditEntry, ApiKeyAuthResult, ApiKeyIdentity } from "./apiKeyService";

/** Who is making the request. Set by the auth middleware as `event.context.auth`. */
export type AuthIdentity<User = unknown> =
	({ kind: "key" } & ApiKeyIdentity) | { kind: "session"; user: User };

/**
 * One rule of the auth middleware. The first rule that matches the method and
 * the path decides. See docs/api-keys-design.md, section 7.
 */
export interface AuthRule {
	/** One method or several. Without it the rule is for each method. `HEAD` counts as `GET`. */
	method?: string | readonly string[];
	/** A string matches the whole path. A `RegExp` is tested against the path. */
	path: string | RegExp;
	/** No credential is needed. */
	public?: boolean;
	/** An API key needs this scope. A session is allowed too. */
	scope?: string;
	/** Only a session is allowed. This is also what happens when no rule matches. */
	session?: boolean;
}

/** Rules that apply after the app's own. An app overrides one with a rule for the same path. */
export const DEFAULT_AUTH_RULES: readonly AuthRule[] = [{ method: "GET", path: "/api/health", public: true }];

export const DEFAULT_PROTECTED_PREFIXES: readonly string[] = ["/api/"];

export const AUTH_MESSAGES = {
	unauthorized: "Send a valid API key, or sign in.",
	notForKeys: "This endpoint is not available to API keys.",
	crossSite: "Cross-site request refused.",
	missingScope: (scope: string) => `This API key does not have the scope \`${scope}\`.`,
	rateLimited: (seconds: number) => `Too many requests. Try again in ${seconds} seconds.`,
} as const;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function normalizeMethod(method: string): string {
	const upper = method.toUpperCase();

	return upper === "HEAD" ? "GET" : upper;
}

/**
 * The path as the rules see it: without the app's base path, with `%xx` decoded,
 * with repeated slashes made one, and without a slash at the end.
 *
 * The router can serve `/api//notes` and `/api/notes/` as `/api/notes`. The rules
 * must see the same path as the router, or such a request would count as outside
 * the guarded paths. The result is null for a path that cannot be decoded; the
 * middleware refuses it.
 */
export function normalizeAuthPath(pathname: string, baseUrl: string = "/"): string | null {
	let path: string;
	try {
		path = decodeURIComponent(pathname);
	} catch {
		return null;
	}
	if (path.includes("\0")) return null;

	path = `/${path}`.replace(/[/\\]+/g, "/");

	const base = baseUrl.replace(/\/+$/, "");
	if (base !== "" && (path === base || path.startsWith(`${base}/`))) path = path.slice(base.length) || "/";

	return path.length > 1 ? path.replace(/\/$/, "") : path;
}

/** True for a path that the middleware guards. The comparison ignores case, so `/API/x` is guarded too. */
export function isProtectedPath(
	path: string,
	prefixes: readonly string[] = DEFAULT_PROTECTED_PREFIXES,
): boolean {
	const lower = `${path.toLowerCase()}/`;

	return prefixes.some((prefix) => lower.startsWith(prefix.toLowerCase()));
}

/** The first rule that matches, or undefined. */
export function matchAuthRule(
	rules: readonly AuthRule[],
	method: string,
	path: string,
): AuthRule | undefined {
	const wanted = normalizeMethod(method);

	return rules.find((rule) => {
		if (rule.method !== undefined) {
			const methods = typeof rule.method === "string" ? [rule.method] : rule.method;
			if (!methods.some((candidate) => normalizeMethod(candidate) === wanted)) return false;
		}

		if (typeof rule.path === "string") return rule.path === path;

		// A RegExp with the `g` or `y` flag remembers where its last match ended.
		// Without this, the same request could match on one call and not on the next.
		rule.path.lastIndex = 0;

		return rule.path.test(path);
	});
}

/**
 * `Authorization: Bearer <key>`. The result is null when the header has no bearer
 * scheme. A bearer scheme with nothing after it gives an empty string, which is a
 * presented (and bad) key: the caller meant to use a key, for example with a
 * variable that was empty, and must not get a session's access.
 */
export function readBearerToken(authorization: string | undefined): string | null {
	if (!authorization) return null;

	const [scheme, ...rest] = authorization.trim().split(/\s+/);

	return scheme?.toLowerCase() === "bearer" ? rest.join(" ") : null;
}

/**
 * The CSRF check for requests whose only credential can be a cookie.
 *
 * A request that changes state must carry an `Origin` header that names this
 * host, or one of the extra allowed origins. A missing `Origin` is refused too:
 * each browser sends it on such a request, and callers that do not (curl, agents)
 * use an API key. `Origin: null` is refused.
 */
export function isAllowedOrigin(
	method: string,
	origin: string | undefined,
	host: string | undefined,
	allowedOrigins: readonly string[] = [],
): boolean {
	if (SAFE_METHODS.has(method.toUpperCase())) return true;
	if (!origin) return false;

	let originHost: string;
	try {
		originHost = new URL(origin).host.toLowerCase();
	} catch {
		return false;
	}
	if (!originHost) return false;
	if (host && originHost === host.toLowerCase()) return true;

	return allowedOrigins.some((allowed) => {
		try {
			return new URL(allowed).origin === new URL(origin).origin;
		} catch {
			return false;
		}
	});
}

export interface RateLimitDecision {
	allowed: boolean;
	retryAfterSeconds?: number;
}

/** What the middleware needs to know about one request. */
export interface AuthRequest {
	method: string;
	/** From `normalizeAuthPath`. */
	path: string | null;
	authorization?: string;
	origin?: string;
	host?: string;
}

/** The parts of `ApiKeyService` that the middleware uses. */
export interface ApiKeyAuthenticator {
	authenticate(presented: string): Promise<ApiKeyAuthResult>;
	audit(entry: ApiKeyAuditEntry): Promise<void>;
}

export interface AuthPolicy<User = unknown> {
	rules?: readonly AuthRule[];
	protect?: readonly string[];
	allowedOrigins?: readonly string[];
	apiKeys?: ApiKeyAuthenticator;
	/** The signed-in user of this request, or null. */
	session?: () => Promise<User | null | undefined> | User | null | undefined;
	/** Asked for each request with a valid key. */
	rateLimit?: (key: ApiKeyIdentity) => Promise<RateLimitDecision> | RateLimitDecision;
	now?: () => Date;
	log?: Pick<Console, "error">;
}

export type AuthDecision<User = unknown> =
	| { allowed: true; auth?: AuthIdentity<User> }
	| { allowed: false; status: 400 | 401 | 403 | 429; message: string; headers?: Record<string, string> };

const UNAUTHORIZED: AuthDecision<never> = {
	allowed: false,
	status: 401,
	message: AUTH_MESSAGES.unauthorized,
	headers: { "WWW-Authenticate": "Bearer" },
};

/**
 * Decides whether a request may pass, and as whom. This is the whole logic of
 * the auth middleware, without h3, so that each case has a unit test.
 */
export async function authorizeRequest<User = unknown>(
	request: AuthRequest,
	policy: AuthPolicy<User>,
): Promise<AuthDecision<User>> {
	if (request.path === null)
		return { allowed: false, status: 400, message: "The request path is not valid." };

	const { method, path } = request;
	if (!isProtectedPath(path, policy.protect)) return { allowed: true };

	const rule = matchAuthRule([...(policy.rules ?? []), ...DEFAULT_AUTH_RULES], method, path);
	const presented = readBearerToken(request.authorization);

	// A presented key is the credential, also when a session cookie comes with it.
	// Otherwise an agent that drives a signed-in browser would get the person's access.
	if (presented !== null) {
		if (!policy.apiKeys) return UNAUTHORIZED;

		const at = (policy.now ?? (() => new Date()))();
		const result = await policy.apiKeys.authenticate(presented);
		if (!result.ok) {
			await policy.apiKeys.audit({
				type: "key.refused",
				keyId: result.keyId,
				reason: result.reason,
				method,
				path,
				at,
			});

			return UNAUTHORIZED;
		}

		const { key } = result;
		const refuse = (reason: "missing-scope" | "not-a-key-route" | "rate-limited") =>
			policy.apiKeys!.audit({ type: "key.refused", keyId: key.keyId, reason, method, path, at });

		if (policy.rateLimit) {
			let limit: RateLimitDecision = { allowed: true };
			try {
				limit = await policy.rateLimit(key);
			} catch (error) {
				(policy.log ?? console).error("[layerbase] The API key rate-limit hook failed:", error);
			}
			if (!limit.allowed) {
				const seconds = Math.max(1, Math.ceil(limit.retryAfterSeconds ?? 1));
				await refuse("rate-limited");

				return {
					allowed: false,
					status: 429,
					message: AUTH_MESSAGES.rateLimited(seconds),
					headers: { "Retry-After": String(seconds) },
				};
			}
		}

		if (!rule?.public) {
			if (!rule?.scope) {
				await refuse("not-a-key-route");

				return { allowed: false, status: 403, message: AUTH_MESSAGES.notForKeys };
			}
			if (!key.scopes.includes(rule.scope)) {
				await refuse("missing-scope");

				return { allowed: false, status: 403, message: AUTH_MESSAGES.missingScope(rule.scope) };
			}
		}

		await policy.apiKeys.audit({ type: "key.used", keyId: key.keyId, method, path, at });

		return { allowed: true, auth: { kind: "key", ...key } };
	}

	// From here the only credential can be a cookie, which a browser sends by
	// itself. This check comes before the public rules, so it covers login too.
	if (!isAllowedOrigin(method, request.origin, request.host, policy.allowedOrigins)) {
		return { allowed: false, status: 403, message: AUTH_MESSAGES.crossSite };
	}

	// A public route needs no session, but a person who is signed in keeps their
	// identity there, as a caller with a key does.
	const user = policy.session ? await policy.session() : null;
	if (user === null || user === undefined) return rule?.public ? { allowed: true } : UNAUTHORIZED;

	return { allowed: true, auth: { kind: "session", user } };
}
