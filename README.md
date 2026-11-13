<p><img src="assets/icon.svg" alt="" width="72" height="72"></p>

# LS Layerbase

A [Nuxt layer](https://nuxt.com/docs/getting-started/layers) with the plumbing that small, self-hosted Nuxt apps tend to rewrite for each project: one API error contract, API-key authentication, database migrations on boot, a health check, a dependency-injection container and a typed fetch helper.

**Status: version 0.2.0.** All pieces below are built and tested. While the version is `0.x`, a minor version can still change an API; the [changelog](CHANGELOG.md) says how to migrate.

## Contents

| Piece              | What it gives an app                                                                            | Issue |
| ------------------ | ----------------------------------------------------------------------------------------------- | ----- |
| Layer setup        | Package, playground app, tests, CI, license                                                     | #1    |
| API error contract | Typed errors, one mapping from error to HTTP status, handler wrappers that hide internal errors | #2    |
| Fetch helper       | A `useApi` composable that reads that error contract on the client                              | #3    |
| API keys           | Issuing, hashing, scoping, revoking and checking API keys, plus the auth middleware             | #4    |
| Migrations on boot | Apply Drizzle migrations at startup and expose a readiness flag                                 | #5    |
| Health check       | A public `/api/health` route backed by readiness and a database ping                            | #6    |
| DI container       | An awilix container plugin and typed `resolve` helper                                           | #7    |
| Releases           | Versioning, changelog and how apps stay up to date                                              | #8    |

## Principles

- **Generic.** The layer holds no app-specific data and no secrets. Anything that differs between apps (database, key scopes, branding, routes) is configured or injected.
- **Opt-in pieces.** An app can use the error contract without API keys, or the health check without the container.
- **Pinned versions.** Apps pin a release tag. Breaking changes only come with a new major version.
- **Tested in isolation.** Every piece has unit tests, and the playground app exercises it end to end.

## Using it

The layer is a dependency of the app, pinned to a release tag.

**1. Add it to `package.json`**, with the packages it expects the app to have:

```jsonc
{
	"dependencies": {
		"ls-layerbase": "github:seanlindell/LS-Layerbase#v0.2.0",
		"awilix": "^13.0.0",
		"drizzle-orm": "^0.45.0",
		// and the app's own nuxt, vue and database driver
	},
}
```

**2. Extend it:**

```ts
// nuxt.config.ts
export default defineNuxtConfig({
	extends: ["ls-layerbase"],
});
```

Everything in the sections below is then auto-imported in the app and in its server code. Each piece is used only where the app calls it: the layer adds no routes, plugins or middleware by itself.

**3. Outside Nuxt, import by path.** A Drizzle schema file (read by `drizzle-kit`) and a unit test do not have Nuxt's auto-imports:

```ts
import { sqliteApiKeysTable } from "ls-layerbase/server/utils/apiKeyTables";
import { createTestContainer } from "ls-layerbase/server/utils/container";
```

The layer ships TypeScript source. Vitest must be told to transform it:

```ts
// vitest.config.ts
export default defineConfig({ test: { server: { deps: { inline: ["ls-layerbase"] } } } });
```

### Why a git dependency

| Way to consume                                             | Verdict                                                                                                                                                                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extends: ["github:seanlindell/LS-Layerbase#v0.2.0"]` only | Not enough. The layer is fetched at build time and is not in `node_modules` under a name, so a schema file or a test cannot import from it, and the version is not in the lockfile.                                       |
| **A git dependency pinned to a tag**                       | **Chosen.** It is in the lockfile, it can be imported by name, and it needs no registry account or token.                                                                                                                 |
| A package on npm                                           | The best tool support, and the natural next step. It needs an npm scope and a publish token. The import paths and `extends: ["ls-layerbase"]` stay the same, so an app only changes the version string in `package.json`. |

### Updates

- **Releases** are tags `vX.Y.Z` with a [GitHub release](../../releases). [CHANGELOG.md](CHANGELOG.md) lists each version, and each breaking change has a **Migration** section that says what to change in an app.
- **To update an app**, change the tag in `package.json`, run `pnpm install`, and read the changelog entries between the two versions.
- **To get update pull requests**, try [Renovate](https://docs.renovatebot.com). Its npm manager can look up the tags of a GitHub repository for a git dependency. This has not been tested with this layer yet, so check that the first pull request arrives after a release. Dependabot handles a git dependency that is pinned to a tag poorly, so do not rely on it for this.

```jsonc
// renovate.json in the app
{
	"$schema": "https://docs.renovatebot.com/renovate-schema.json",
	"extends": ["config:recommended"],
	"packageRules": [{ "matchPackageNames": ["ls-layerbase"], "commitMessageTopic": "Layerbase" }],
}
```

The way that always works: watch the repository's releases on GitHub (Watch, Custom, Releases) to get a notification for each one.

## API error contract

Every API route reports a failure in one way: **the HTTP status is the real one, and the body carries a message written for the caller.** A failure is never sent with status 200, and the message of an unexpected error never reaches the caller.

### Statuses

Services and handlers throw a typed error. The wrappers below turn it into the response.

| Throw                                 | Status     | Use it when                                                                                                   |
| ------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| `new ValidationError(message)`        | 400        | The content of the request is not acceptable.                                                                 |
| `new NotFoundError(message)`          | 404        | The thing that the request names does not exist.                                                              |
| `new ConflictError(message, options)` | 409        | The request conflicts with the current state, for example a duplicate.                                        |
| `new UpstreamError(message)`          | 502        | A service outside the app failed.                                                                             |
| `new UnavailableError(message)`       | 503        | Something the app depends on is down or busy.                                                                 |
| `new ApiError(status, message)`       | 400 to 599 | No class above fits.                                                                                          |
| `httpError(status, message)`          | 4xx        | A one-off refusal inside a handler or a middleware. It is an h3 error, so it also works outside the wrappers. |
| anything else                         | 500        | It is a bug. The caller gets a fixed message.                                                                 |

Each typed error takes an optional options object as its second argument (third for `ApiError`):

```ts
throw new ConflictError("A note with that title already exists.", { payload: existing });
throw new UpstreamError("The mail service did not answer.", { cause: error });
```

- `payload` is sent to the caller, so a 409 can carry the record that already exists.
- `cause` is the error that led to this one. It goes to the server log with a 5xx, and never to the caller.

The errors are in `shared/`, so code in the browser can throw them too, and `notifyError` shows their message.

An h3 error with a 4xx status passes through with its message. h3 throws these itself, for example for a request body that is not JSON. An h3 error with a 5xx status is treated as unexpected, so throw `UpstreamError` or `UnavailableError` for a 5xx that the caller should understand.

### Reads: `defineApiHandler`

```ts
// server/api/notes/[id].get.ts
export default defineApiHandler(async (event) => {
	const note = await findNote(getRouterParam(event, "id"));
	if (!note) throw new NotFoundError("There is no note with that id.");

	return note;
});
```

On success the body is the returned value. On failure the response is an h3 error:

```json
{ "statusCode": 404, "statusMessage": "Not Found", "message": "There is no note with that id." }
```

The body has a `data` field when the error carried a payload. h3 adds `error: true` and the request `url`, and in development also a `stack`.

### Writes: `defineActionHandler`

```ts
// server/api/notes/index.post.ts
export default defineActionHandler(async (event) => {
	const body = await readBody(event);

	return ActionResult.ok("Note created.", await createNote(body)); // throws ConflictError for a duplicate
});
```

The body is always an `ActionResult`, and the status says the same thing as `Success`:

```jsonc
// 200
{ "Success": true, "Message": "Note created.", "ResponseObject": { "id": 2, "title": "Second note" } }

// 409
{ "Success": false, "Message": "A note with that title already exists.", "ResponseObject": { "id": 1, "title": "First note" } }
```

On a failure, `ResponseObject` is the payload of the error, or `null`. A handler returns `ActionResult.ok(...)` only; to refuse a write it throws. If untyped code returns a failed result anyway, the wrapper sends it with status 400.

`ActionResult<T>` is exported from the layer's `shared/` folder as a type, together with `ActionSuccess<T>` and `ActionFailure`, so pages and server code use the same shape.

### What is logged

| Failure                                   | Logged                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Typed error or h3 error with a 4xx status | Nothing. It is the caller's to fix.                                                                               |
| Typed error with a 5xx status             | The error, with its stack and `cause`. The caller still gets the error's own message.                             |
| Anything else                             | The original error, with its stack. The caller gets `The server could not complete the request. Try again later.` |

Each log line starts with `[layerbase] <METHOD> <path> failed with <status>:` and goes to `console.error`. The path has no query string, because a query can hold secrets.

## Fetch helper: `useApi`

`useApi()` is the client side of the error contract. Its `run` sends a request to a route that answers with an `ActionResult`, and it does not throw: a failure comes back in the same shape as a success, so a page branches on `Success` only.

```ts
const { run, notifySuccess } = useApi();
const isSaving = ref(false);

const result = await run<Note>("/api/notes", {
	method: "POST",
	body: { title: title.value },
	pending: isSaving, // true while the request runs
	errorTitle: "Could not create the note",
});

if (result.Success) {
	notifySuccess(result.Message);
	notes.value.push(result.ResponseObject); // typed as Note
} else if (result.Status === 409) {
	existing.value = result.ResponseObject; // the payload of the refusal, typed as unknown
}
```

On failure `run` resolves to `{ Success: false, Message, ResponseObject, Status }`:

| The server sent                                                 | `Message`                                                              | `ResponseObject`                              | `Status`        |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------- | --------------- |
| An `ActionResult` body (a refused write)                        | its `Message`                                                          | its `ResponseObject` (the payload, or `null`) | the HTTP status |
| An h3 error body (a read error, or a refusal from a middleware) | its `message`                                                          | its `data`, or `null`                         | the HTTP status |
| An error without a usable body                                  | `The request failed with status 502.`                                  | `null`                                        | the HTTP status |
| Nothing (the network is down)                                   | `The server could not be reached. Check the connection and try again.` | `null`                                        | `null`          |

The other options of `run` are the options of `$fetch`. `useApi()` also returns:

- `errorMessage(error)` and `errorStatus(error)`: the message and the status for anything that a request threw, for code that calls `$fetch` or `useFetch` directly.
- `watchFetchError(error, title?)`: sends an error notification each time a `useFetch` read fails. Call it in `setup`:

  ```ts
  const { data, error } = await useFetch("/api/notes");
  watchFetchError(error, "Could not load the notes");
  ```

- `notifyError(failure, title?)`: an error notification. `failure` can be a message the app wrote (a string), an `ApiError`, or anything a request threw. Any other error shows `Something went wrong. Try again.`, because its text was not written for a person.
- `notifyWarning(title, message?)`, `notifyInfo(title, message?)` and `notifySuccess(title, message?)`.
- `notify(notification)`: sends any notification as it is.

### Showing notifications

The layer has no UI library. It calls the Nuxt hook `layerbase:notify` with `{ kind, title, message?, status? }`, and the app shows it.

- `kind` is `"error"`, `"warning"`, `"info"` or `"success"`.
- `status` is set on an error that has an HTTP status: a failed request (`null` when no response arrived) or an `ApiError`. This is the one place to handle, for example, a 401.

With Nuxt UI:

```ts
// app/plugins/notify.ts
export default defineNuxtPlugin((nuxtApp) => {
	const toast = useToast();
	nuxtApp.hook("layerbase:notify", ({ kind, title, message, status }) => {
		if (status === 401) return navigateTo("/login");
		toast.add({ title, description: message, color: kind });
	});
});
```

`run` sends an error notification on each failure. Pass `silent: true` when the page shows the failure itself. With no listener, nothing is shown.

## Migrations on boot

The layer applies an app's [Drizzle](https://orm.drizzle.team) migrations when the server starts, and keeps a readiness flag that other code can read. The app owns the database connection and passes it in.

### SQLite (`better-sqlite3`)

```ts
// server/plugins/00.migrate.ts
export default defineMigrationPlugin(() => ({ migrate: sqliteMigrator(db) }));
```

### PostgreSQL (`pg`)

```ts
// server/plugins/00.migrate.ts
import pg from "pg";

export default defineMigrationPlugin(() => ({
	migrate: postgresMigrator({ createClient: () => new pg.Client(process.env.DATABASE_URL) }),
}));
```

`createClient` is called twice. One connection holds a session-level advisory lock for the whole run, so that two instances which start together do not apply the same migrations; the other runs the migrations and sends their notices (`RAISE NOTICE`, `RAISE WARNING`) to the log. Do not return a client from a pool.

Name the plugin file so that it sorts before the plugins that use the database (`00.migrate.ts`).

### What happens at startup

- **Success:** `isMigrated()` becomes true and `[layerbase] Database migrations are applied.` is logged.
- **Failure:** the error is logged and the process stops with exit code 1. The server does not keep running on a schema that is half applied.

SQLite migrations run synchronously, so the server accepts no request before they finish. PostgreSQL migrations are asynchronous, and Nitro does not wait for a plugin, so a request can arrive while they run. Use the readiness functions for code that must wait:

| Function            | Result                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `isMigrated()`      | `true` when the schema is ready.                                                                            |
| `migrationStatus()` | `"pending"`, `"running"`, `"done"` or `"failed"`.                                                           |
| `whenMigrated()`    | A promise that resolves when the schema is ready.                                                           |
| `markMigrated()`    | Says that the schema is ready, for an app that applies migrations in its own way inside the server process. |

### Configuration

| Runtime config               | Environment variable               | Default     | Meaning                                                                                                                                                    |
| ---------------------------- | ---------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layerbase.migrationsFolder` | `NUXT_LAYERBASE_MIGRATIONS_FOLDER` | `./drizzle` | The folder with the migrations, relative to the working directory of the server.                                                                           |
| `layerbase.migrateOnBoot`    | `NUXT_LAYERBASE_MIGRATE_ON_BOOT`   | `true`      | Set to `false` for an app that runs its migrations elsewhere, for example as a deploy step. Nothing is applied, and `isMigrated()` is true from the start. |

Both can also be passed to `defineMigrationPlugin` as `folder` and `enabled`. `migrate` can be any function that applies the migrations and throws when one fails, so another driver or migration tool also works.

## Health check

A route for container platforms and Docker's `HEALTHCHECK`. It says whether the app can serve: the migrations are done and the database answers.

```ts
// server/api/health.get.ts
import { sql } from "drizzle-orm";

export default defineHealthHandler(() => ({
	ping: () => db.run(sql`select 1`), // PostgreSQL: () => pool.query("select 1")
}));
```

| State                                                     | Status | Body              |
| --------------------------------------------------------- | ------ | ----------------- |
| Migrations done, and each check passed within the timeout | 200    | `{ "ok": true }`  |
| Anything else                                             | 503    | `{ "ok": false }` |

- **The bodies are fixed.** They have no version, host name or error text, because the route is public. The reason for a failure goes to the server log, once when the result changes and not on each probe. An app that must keep a health body of its own uses the probe without the handler; see [Keep your own body](#keep-your-own-body).
- **Never cached:** each answer has `Cache-Control: no-store`.
- **One query at a time.** Probes that arrive while a check is still running wait for that run and start no second one. A stalled database thus holds one connection, however many probes arrive, and each probe still gets its 503 after the timeout.
- **Public.** Keep the route out of authentication and rate limits.

### Options

| Option              | Default | Meaning                                                                                                                                                     |
| ------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ping`              | none    | A trivial query against the database. It fails when it throws or rejects.                                                                                   |
| `checks`            | `{}`    | More checks by name, for example `{ queue: () => queue.ping() }`. A check fails when it throws, rejects or gives `false`. The name is used in the log only. |
| `timeoutMs`         | `2000`  | How long one check may take.                                                                                                                                |
| `requireMigrations` | `true`  | Answer 503 until `isMigrated()` is true. Set it to `false` in an app that does not use the migration plugin.                                                |

### Keep your own body

`defineHealthHandler` always answers `{ "ok": … }`. When callers already read another body, build the route on `createLazyHealthProbe`, which takes the same options and does the same checks:

```ts
// server/api/health.get.ts
const probe = createLazyHealthProbe(() => ({ ping: () => db.run(sql`select 1`) }));

export default defineEventHandler(async (event) => {
	const ok = await probe();
	setResponseStatus(event, ok ? 200 : 503);
	setResponseHeader(event, "Cache-Control", "no-store");

	return { Status: ok ? "ok" : "unavailable" };
});
```

### Docker `HEALTHCHECK`

For a Node Alpine image. It uses Node's own `fetch`, so the image needs no `curl`, and it reads the port from `$PORT`:

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
```

The route answers 503 while migrations run. Docker does not count a failure during the start period, so make `--start-period` longer than your slowest migration.

`playground/Dockerfile` uses this line. `./scripts/image-health.sh` builds that image and checks that `docker inspect` reports `healthy`, then `unhealthy` while the database is stopped, then `healthy` again. CI runs it.

## DI container

For apps with services and repositories, the layer builds one [awilix](https://github.com/jeffijoe/awilix) container when the server starts, and gives routes a typed way to resolve from it.

### Register

Keep the registrations in a file of their own, so that the plugin and the tests use the same ones:

```ts
// server/container.ts
export interface AppCradle {
	db: Database;
	noteRepository: INoteRepository;
	noteService: NoteService;
}

export const registerServices: ContainerSetup<AppCradle> = ({ container, service, factory, value }) => {
	container.register({
		db: value(db),
		noteRepository: service(NoteRepository),
		noteService: service(NoteService),
	});
};
```

```ts
// server/plugins/01.container.ts (after the migration plugin)
export default defineContainerPlugin(registerServices);
```

A class gets the other registrations as one object: `constructor({ noteRepository }: { noteRepository: INoteRepository })`.

| Helper                                  | Registers                        |
| --------------------------------------- | -------------------------------- |
| `service(Class, lifetime?)`             | A class.                         |
| `factory((cradle) => value, lifetime?)` | A function that makes the value. |
| `value(x)`                              | A value that exists already.     |

### Lifetimes

| Lifetime      | One instance per  | Notes                                        |
| ------------- | ----------------- | -------------------------------------------- |
| `"singleton"` | Server            | The default for `service` and `factory`.     |
| `"scoped"`    | Request           | Needs `scopePerRequest: true` on the plugin. |
| `"transient"` | Call of `resolve` |                                              |

The container is strict: a singleton that depends on a scoped or transient registration is an error when it is resolved, and so is a name that is not registered.

With `defineContainerPlugin(registerServices, { scopePerRequest: true, onRequestScope })`, each request gets a scope of the container, and `onRequestScope(scope, event)` can register values that belong to the request, such as the signed-in user. The scope is disposed after the response.

### Resolve

```ts
// server/utils/resolve.ts
export const resolve = defineResolver<AppCradle>();
```

```ts
// server/api/notes/[id].get.ts
export default defineApiHandler((event) => {
	return resolve(event, "noteService").find(getRouterParam(event, "id")); // typed as NoteService
});
```

`resolve(event, name)` uses the container of the request, which the plugin keeps in `event.context.layerbase.container`. The layer does not use `event.context.container`, so an app can still declare that field with its own type. `resolve(name)` uses the root container, for server plugins and tasks. `useContainer<AppCradle>(event?)` gives the container itself. Services throw the typed errors of the error contract, and the handler wrappers turn them into responses.

### Test with fakes

```ts
const container = createTestContainer(registerServices, { noteRepository: fakeRepository });
const service = container.resolve("noteService"); // built with the fake
```

`createTestContainer` runs the same registrations and then replaces the named ones with the given values. A registration that the test does not resolve is never built, so a test of one service needs no database.

## API keys and the auth middleware

API keys for agents and scripts, next to a cookie session for people. The full design, with the reasons, is in [docs/api-keys-design.md](docs/api-keys-design.md).

A key looks like `lsk_4f2a91cc03b7d5e1_<43 characters>`: a prefix that the app sets, an id that is not secret, and a 256-bit secret. Only a SHA-256 hash of the secret is stored, so the full key is shown once, when it is made.

### 1. Table

Add the table to the app's Drizzle schema, and let `drizzle-kit generate` write the migration:

```ts
export const apiKeys = sqliteApiKeysTable(); // or postgresApiKeysTable()
```

### 2. Service

Register the repository and the service in the container. The app gives the list of scopes that exist:

```ts
container.register({
	apiKeyRepository: value(new SqliteApiKeyRepository(db, apiKeys)), // or PostgresApiKeyRepository
	apiKeyService: factory(
		({ apiKeyRepository }) =>
			new ApiKeyService({
				repository: apiKeyRepository,
				scopes: ["notes:read", "notes:write"],
				prefix: "app",
			}),
	),
});
```

| Method                                | Does                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `issue({ name, scopes, expiresAt? })` | Makes a key. The result has the metadata and `PlainTextKey`, the only copy of the full key. An unknown scope is a 400. |
| `list()`                              | The metadata of all keys, without hashes.                                                                              |
| `revoke(id)`                          | Revokes a key. It stays in the list.                                                                                   |
| `authenticate(key)`                   | Used by the middleware.                                                                                                |

The layer has no routes to manage keys, because apps differ in who may do that. Write three short handlers that call the service; the playground has them in `playground/server/api/keys/`.

`apiKeyRepository` can be any object with the `ApiKeyRepository` interface. `MemoryApiKeyRepository` is there for tests.

### 3. Middleware

```ts
// server/middleware/01.auth.ts
export default defineAuthMiddleware({
	apiKeys: (event) => resolve(event, "apiKeyService"),
	session: async (event) => (await getUserSession(event)).user ?? null, // nuxt-auth-utils
	rules: [
		{ path: "/api/auth/login", public: true },
		{ method: "GET", path: /^\/api\/notes(\/\d+)?$/, scope: "notes:read" },
		{ method: "POST", path: "/api/notes", scope: "notes:write" },
	],
});
```

It guards the paths under `/api/` (set `protect` for others). The first rule that matches the method and path decides:

| Rule                        | Anonymous | Session | API key                          |
| --------------------------- | --------- | ------- | -------------------------------- |
| `public: true`              | allowed   | allowed | allowed                          |
| `scope: "x"`                | 401       | allowed | allowed with scope `x`, else 403 |
| `session: true`, or no rule | 401       | allowed | 403                              |

So a new route is closed to anonymous callers, and closed to keys, until a rule names it. `GET /api/health` is public unless a rule of the app says otherwise.

- A key is read from `Authorization: Bearer <key>` only. When a key is sent, it is the credential, also if a session cookie comes with it.
- `Authorization: Bearer` with nothing after it counts as a malformed key: the answer is 401, and the session cookie is not tried. A client that sends the header has chosen a key.
- **CSRF:** a request without a key that changes state (not `GET`, `HEAD` or `OPTIONS`) must have an `Origin` header that names the app's host, or one of `allowedOrigins`. A request with a key needs no `Origin`.
- The request's identity is `event.context.layerbase.auth` (the layer leaves `event.context.auth` to the app): `{ kind: "key", keyId, name, scopes }` or `{ kind: "session", user }`. In a handler, `requireAuth(event)`, `requireSession(event)` and `requireScope(event, scope)` give it or throw.

| Case                                                                          | Status | Message                                                 |
| ----------------------------------------------------------------------------- | ------ | ------------------------------------------------------- |
| No credential, or a key that is malformed, unknown, wrong, expired or revoked | 401    | `Send a valid API key, or sign in.`                     |
| The key does not have the scope                                               | 403    | ``This API key does not have the scope `notes:write`.`` |
| The route is not open to keys                                                 | 403    | `This endpoint is not available to API keys.`           |
| A cookie write without a matching `Origin`                                    | 403    | `Cross-site request refused.`                           |
| The rate-limit hook refused                                                   | 429    | `Too many requests. Try again in N seconds.`            |

Each bad key gets the same 401, so a caller cannot find out which keys exist. The bodies are h3 errors, which `useApi` reads.

### Hooks

- `onAudit(entry)` on the service: called when a key is used, refused, created or revoked, with the key's id, the method and the path. An entry never holds a key or a secret.
- `rateLimit(key, event)` on the middleware: return `{ allowed: false, retryAfterSeconds }` to answer 429. The layer has no limiter of its own.

## Development

You need Node 22 or later and pnpm (the version is pinned in `package.json`).

```bash
pnpm install
pnpm dev       # start the playground app, which extends the layer
```

| Command            | What it does                                                            |
| ------------------ | ----------------------------------------------------------------------- |
| `pnpm lint`        | ESLint over the layer, the playground and the tests. Warnings fail.     |
| `pnpm format`      | Prettier, writing changes. `pnpm format:check` only reports.            |
| `pnpm typecheck`   | `vue-tsc` over the layer and the playground, then `tsc` over the tests. |
| `pnpm test:unit`   | Vitest unit tests in `test/unit/`, without Nuxt.                        |
| `pnpm test:routes` | Builds the playground and sends real requests to it (`test/routes/`).   |
| `pnpm test`        | Both test sets.                                                         |

CI runs all of these on each pull request and on each push to `main`.

The PostgreSQL migration tests need a server. Each test makes its own database on it and drops it afterwards:

```bash
docker run -d --name layerbase-test-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17-alpine
TEST_POSTGRES_URL=postgres://postgres:postgres@localhost:55432/postgres pnpm test:unit
```

### Layout

| Path                                           | Contents                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `nuxt.config.ts`, `app/`, `server/`, `shared/` | The layer. Only these are part of the package.                                                   |
| `playground/`                                  | A small app that extends the layer. Try each piece here by hand; the route tests run against it. |
| `test/unit/`, `test/routes/`                   | Unit tests and route tests.                                                                      |

### Dependencies

The layer never brings a second copy of a package into an app:

- `nuxt`, `vue`, `drizzle-orm` and `awilix` are **peer dependencies** with an explicit range. `drizzle-orm` and `awilix` are required even by an app that does not use the migration helpers or the container, because Nuxt type-checks all files of a layer.
- `engines.node` is `>=22.22.3`, because Nuxt itself needs that version of Node 22. An app that pins `node: 22` gets the newest 22 release, which is newer.
- The database drivers (`better-sqlite3`, `pg`) are not dependencies of the layer at all. The app creates the connection and passes it in.
- The versions the layer is developed and tested with are in `devDependencies`.

### Releasing

1. Move the entries under `## [Unreleased]` in `CHANGELOG.md` to a new section `## [X.Y.Z] - YYYY-MM-DD`, add a **Migration** part for each breaking change, and update the links at the end of the file.
2. Set the same version in `package.json`.
3. Merge that to `main`, then tag it: `git tag vX.Y.Z && git push origin vX.Y.Z`.

The tag starts the release workflow. It runs the full CI, checks that the tag is the version in `package.json`, and makes the GitHub release with the changelog section as its notes. The package has no install scripts, because a package manager does not run them for a git dependency without asking.

## License

[MIT](LICENSE)
