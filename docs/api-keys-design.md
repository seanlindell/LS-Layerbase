# API keys and the auth middleware: design

Status: **proposed**, for review. Issue: #4. The code in the same pull request follows this document.

This document says what the layer will build for API-key authentication, and why. The code follows it. Section 11 lists the questions where a different answer would change the code.

## 1. Goals

- One implementation of API keys for all apps, so that a security fix reaches each app with a version bump.
- A leaked database gives no usable keys.
- Deny by default: a new route is closed to anonymous callers and to keys until a rule names it.
- The layer holds nothing that is specific to one app. The app supplies the scope list, the route rules, the storage and the session.

Not goals: user accounts, sessions and login (the app uses `nuxt-auth-utils` or similar), OAuth, and a user interface for key management.

## 2. Key format

```
<prefix>_<id>_<secret>        for example  lsk_4f2a91cc03b7d5e1_pX3…(43 characters)
```

| Part     | Content                                                                                                                                                    | Secret? |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `prefix` | Set by the app, lower-case letters and digits, default `lsk`. It lets a person and a secret scanner see what a string is.                                  | No      |
| `id`     | 8 random bytes as 16 hex characters. It is the primary key of the record, so a check is one indexed lookup. It can appear in a user interface and in logs. | No      |
| `secret` | 32 random bytes (256 bits) from `crypto.randomBytes`, as base64url (43 characters).                                                                        | Yes     |

The characters are `A-Z a-z 0-9 - _` only, so a key survives a shell variable and a Docker Compose value. Only the first two `_` are separators, because base64url can contain `_`.

The full key is returned once, by `issue()`. It cannot be shown again.

## 3. Storage

Only `SHA-256(secret)` is stored, as hex. SHA-256 without salt and without stretching is correct here, although it would be wrong for a password: the secret is 256 bits of random data, so there is nothing to guess, and the check runs on each request, where a slow hash would be a rate limit on ourselves.

The check compares hashes with `crypto.timingSafeEqual`. When the id is not known, the code still hashes the presented secret and compares it with a fixed value, so the two cases take the same time.

The layer never logs a key or a secret. Log lines and audit entries carry the id only. A string that does not parse as a key is not echoed.

### Record

| Field        | Type              | Meaning                                                                         |
| ------------ | ----------------- | ------------------------------------------------------------------------------- |
| `id`         | text, primary key | The lookup id from the key.                                                     |
| `name`       | text              | Given by the person who made the key, 1 to 80 characters.                       |
| `secretHash` | text              | SHA-256 of the secret, hex.                                                     |
| `scopes`     | list of text      | What the key may do.                                                            |
| `createdAt`  | time              |                                                                                 |
| `lastUsedAt` | time or null      | Written at most once a minute per key, so that a request is not always a write. |
| `expiresAt`  | time or null      | Optional. At or after this time the key is refused.                             |
| `revokedAt`  | time or null      | Set by `revoke()`. A revoked key stays in the list.                             |

## 4. Scopes

The app gives its scope list when it makes the service, for example `["notes:read", "notes:write"]`. The layer treats a scope as an opaque string.

- `issue()` refuses a scope that is not in the list (400), and refuses an empty scope list.
- A key passes a check for scope `x` only if `x` is in its scopes. There are no wildcards and no hierarchy: `notes:write` does not include `notes:read`.
- When an app removes a scope from its list, old keys keep the string, but no rule asks for it any more.

## 5. Storage interface

```ts
interface ApiKeyRepository {
	create(record: ApiKeyRecord): Promise<void>;
	findById(id: string): Promise<ApiKeyRecord | null>;
	list(): Promise<ApiKeyRecord[]>;
	touchLastUsed(id: string, at: Date): Promise<void>;
	/** False when there is no such key, or it is revoked already. */
	revoke(id: string, at: Date): Promise<boolean>;
}
```

The layer ships two implementations on Drizzle, and an app can write its own (another database, or an in-memory fake for tests):

- `sqliteApiKeysTable(name?)` and `SqliteApiKeyRepository` for `better-sqlite3`;
- `postgresApiKeysTable(name?)` and `PostgresApiKeyRepository` for `pg`.

### How the table gets into the app's migrations

The layer ships **no SQL migrations**. The app adds the table to its own Drizzle schema, and `drizzle-kit generate` writes the migration with the app's others:

```ts
// the app's schema file
export const apiKeys = sqliteApiKeysTable(); // default table name: api_keys
```

Reasons: one migration history per app, in one folder, applied by the plugin from #5; the app sees the SQL before it runs; and a later change to the table is an ordinary generated migration in the app after a layer upgrade, which the layer's changelog announces.

A consequence for #8: `drizzle-kit` runs outside Nitro, so the schema file must import the table function by a module path. That needs the layer to be a real dependency in `package.json` (git dependency or npm package), and not only a `github:` entry in `extends`.

## 6. Service

`ApiKeyService` holds the rules. It takes a repository, the scope list, the prefix and optional hooks.

| Method                                | Result                                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue({ name, scopes, expiresAt? })` | The stored metadata and the full key, once. Validation failures are `ValidationError` (400).                                                                     |
| `list()`                              | Metadata of all keys, without hashes.                                                                                                                            |
| `revoke(id)`                          | `NotFoundError` (404) when there is no such key or it is revoked already.                                                                                        |
| `authenticate(presented, now?)`       | The key's identity, or a refusal with an internal reason (`malformed`, `unknown`, `wrong-secret`, `expired`, `revoked`). The reason goes to the audit hook only. |

The app registers the repository and the service in the container (#7), so it can replace the repository.

The layer ships **no routes** for key management. Who may make and revoke keys is the app's decision, so the app writes these routes (three short handlers that call the service) and protects them. The playground has an example.

## 7. Middleware

The app adds one server middleware:

```ts
// server/middleware/01.auth.ts
export default defineAuthMiddleware({
	apiKeys: (event) => resolve(event, "apiKeyService"),
	session: async (event) => (await getUserSession(event)).user ?? null,
	rules: [
		{ path: "/api/health", public: true },
		{ path: "/api/auth/login", public: true },
		{ method: "GET", path: /^\/api\/notes(\/\d+)?$/, scope: "notes:read" },
		{ method: "POST", path: "/api/notes", scope: "notes:write" },
	],
});
```

### Which requests it guards

Paths that start with one of `protect` (default `["/api/"]`), after the app's base path is removed. Other paths pass untouched.

Before the comparison the path is made the same as the router sees it: `%xx` is decoded, repeated slashes become one, and a slash at the end is removed. The prefix comparison ignores case. Otherwise `/api//notes` or `/API/notes` could count as outside the guarded paths. A path that cannot be decoded is refused with 400.

### Rules

The first rule that matches the method and path decides. `HEAD` is treated as `GET`. A string path matches exactly; a `RegExp` is tested against the path.

| Rule                                | Anonymous | Session | API key                                            |
| ----------------------------------- | --------- | ------- | -------------------------------------------------- |
| `public: true`                      | allowed   | allowed | allowed (the key is still checked, if one is sent) |
| `scope: "x"`                        | 401       | allowed | allowed with scope `x`, else 403                   |
| `session: true`, or no rule matches | 401       | allowed | 403                                                |

So a route is closed to keys until a rule names it with a scope. `/api/health` is public by default, and the app can remove that.

A handler can ask for more with `requireAuth(event)`, `requireScope(event, scope)` and `requireSession(event)`.

### Steps for a guarded request

1. **Read `Authorization: Bearer <key>`.** A key is read from this header only, never from the query string. `Bearer` with nothing after it counts as a presented key that is not valid (401), and does not fall back to the session.
2. **If a key is presented, it is the credential**, also when a session cookie comes with it. Otherwise an agent that drives a signed-in browser would get the person's access.
   - Authenticate it. Any failure is 401 with one message.
   - Call the rate-limit hook, if there is one. A refusal is 429 with `Retry-After`.
   - Apply the rule. A missing scope, or a route without a scope rule, is 403.
   - Set `event.context.auth = { kind: "key", keyId, name, scopes }`.
3. **If no key is presented**, the only credential can be a cookie, which a browser sends by itself:
   - **Origin check (CSRF).** For a method other than `GET`, `HEAD` and `OPTIONS`, the `Origin` header must be present and its host must be the request's host (or one of `allowedOrigins`). Otherwise 403. This runs before the public rules, so it covers the login route too. `Origin: null` is refused.
   - Ask the app's `session` function. With a user, set `event.context.auth = { kind: "session", user }`.
   - Without a user, a public rule lets the request continue with no identity. Any other rule is 401.

A request with a key needs no `Origin` check: a browser does not add an `Authorization` header by itself, so another site cannot make the request.

### Responses

| Case                                                                       | Status                               | Message                                                 |
| -------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------- |
| No credential; or the key is malformed, unknown, wrong, expired or revoked | 401, with `WWW-Authenticate: Bearer` | `Send a valid API key, or sign in.`                     |
| The key does not have the scope                                            | 403                                  | ``This API key does not have the scope `notes:write`.`` |
| The route is not open to keys                                              | 403                                  | `This endpoint is not available to API keys.`           |
| Cookie write without a matching `Origin`                                   | 403                                  | `Cross-site request refused.`                           |
| Rate limit                                                                 | 429, with `Retry-After`              | `Too many requests. Try again in N seconds.`            |

All five key failures give the same status and message, so a caller cannot find out which ids exist or why a key stopped working. The person who owns the key sees the state in the key list.

The middleware throws h3 errors through `httpError` (#2), so the body is `{ statusCode, statusMessage, message }` and `useApi` (#3) reads it. #2 also gets `UnauthorizedError` (401) and `ForbiddenError` (403) for services.

## 8. Hooks

Both are optional. An error inside a hook is logged and does not change the response, except that a rate-limit hook that throws refuses nothing.

```ts
onAudit?: (entry: {
	type: "key.used" | "key.refused" | "key.created" | "key.revoked";
	keyId: string | null; // null when the presented string did not parse
	reason?: "malformed" | "unknown" | "wrong-secret" | "expired" | "revoked" | "missing-scope" | "not-a-key-route";
	method?: string;
	path?: string; // without the query string
	at: Date;
}) => void | Promise<void>;

rateLimit?: (key, event) => { allowed: boolean; retryAfterSeconds?: number } | Promise<...>;
```

The layer has no rate limiter of its own. There is no attempt limit on wrong keys: the secret has 256 bits, and a limit per address would let one misconfigured agent lock out the others behind the same address.

## 9. Sessions

The layer does not import a session library. The app passes `session(event)`, which returns the user or `null`. With `nuxt-auth-utils` that is one line (see section 7). An app with keys only leaves it out, and each guarded route that is not public then needs a key.

## 10. Tests

- Unit: mint and parse (also a secret that contains `_`, a wrong prefix, bad characters), hash, constant-time compare (also different lengths), expiry at the boundary, revocation, scopes (unknown at creation, missing at use), the `lastUsedAt` throttle, the rule matcher, the origin check, and both repositories (SQLite on a temporary file, PostgreSQL on a throwaway database).
- Routes, in the playground: no key, a wrong key, a revoked key, an expired key, a missing scope, a valid key, a route with no key rule, a cookie write without `Origin`, a cookie write with the right `Origin`, a key together with a cookie.

## 11. Questions for review

1. **Deny by default for keys.** A key can call a route only when a rule gives that route a scope. The alternative is "a key can call each guarded route, and handlers check scopes". I chose the rule table because a forgotten check then fails closed, and the table can be tested. Is that the behaviour you want in all apps?
2. **No management routes in the layer.** Each app writes its issue, list and revoke routes. The alternative is that the layer ships them behind `session: true`. I left them out because apps differ in who may manage keys.
3. **No migrations in the layer.** The app generates the migration for the table (section 5). This makes the layer a real package dependency, which narrows the choice in #8.
4. **One 401 message for all key failures**, including expired. An expired key is a common honest mistake, and a separate message would help the caller, at the cost of confirming that the id exists. I kept one message, as the issue asks.
5. **`lastUsedAt` at most once a minute.** Good enough for "is this key still in use?", and it keeps reads from being writes.
6. **Prefix default `lsk`.** Apps should set their own (Fini-Workspace uses `fws`), so that keys of different apps are not confused.
