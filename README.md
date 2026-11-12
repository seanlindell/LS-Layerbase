<p><img src="assets/icon.svg" alt="" width="72" height="72"></p>

# LS Layerbase

A [Nuxt layer](https://nuxt.com/docs/getting-started/layers) with the plumbing that small, self-hosted Nuxt apps tend to rewrite for each project: one API error contract, API-key authentication, database migrations on boot, a health check, a dependency-injection container and a typed fetch helper.

**Status: in development.** The layer setup, the API error contract and the `useApi` fetch helper are built. The other pieces below are not built yet, and nothing is published. The [issues](../../issues) describe the first version.

## Planned contents

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

## Using it (planned)

```ts
// nuxt.config.ts
export default defineNuxtConfig({
	extends: ["github:seanlindell/LS-Layerbase#v0.1.0"],
});
```

How apps consume it (the `extends` form above, a git dependency, or a published package) is decided in #8.

## API error contract

Every API route reports a failure in one way: **the HTTP status is the real one, and the body carries a message written for the caller.** A failure is never sent with status 200, and the message of an unexpected error never reaches the caller.

### Statuses

Services and handlers throw a typed error. The wrappers below turn it into the response.

| Throw                                  | Status     | Use it when                                                                                                   |
| -------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| `new ValidationError(message)`         | 400        | The content of the request is not acceptable.                                                                 |
| `new NotFoundError(message)`           | 404        | The thing that the request names does not exist.                                                              |
| `new ConflictError(message, existing)` | 409        | The request conflicts with the current state, for example a duplicate.                                        |
| `new UpstreamError(message)`           | 502        | A service outside the app failed.                                                                             |
| `new UnavailableError(message)`        | 503        | Something the app depends on is down or busy.                                                                 |
| `new ApiError(status, message)`        | 400 to 599 | No class above fits.                                                                                          |
| `httpError(status, message)`           | 4xx        | A one-off refusal inside a handler or a middleware. It is an h3 error, so it also works outside the wrappers. |
| anything else                          | 500        | It is a bug. The caller gets a fixed message.                                                                 |

Each typed error takes an optional payload as its second argument (third for `ApiError`). The caller receives it, so a 409 can carry the record that already exists.

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
- `notifyError(error, title?)` and `notifySuccess(title, message?)`.

### Showing notifications

The layer has no UI library. It calls the Nuxt hook `layerbase:notify` with `{ kind: "error" | "success", title, message? }`, and the app shows it. With Nuxt UI:

```ts
// app/plugins/notify.ts
export default defineNuxtPlugin((nuxtApp) => {
	const toast = useToast();
	nuxtApp.hook("layerbase:notify", ({ kind, title, message }) => {
		toast.add({ title, description: message, color: kind === "error" ? "error" : "success" });
	});
});
```

`run` sends an error notification on each failure. Pass `silent: true` when the page shows the failure itself. With no listener, nothing is shown.

## Development

You need Node 22 or later and pnpm (the version is pinned in `package.json`).

```bash
pnpm install   # also runs `nuxt prepare playground`
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

### Layout

| Path                                           | Contents                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `nuxt.config.ts`, `app/`, `server/`, `shared/` | The layer. Only these are part of the package.                                                   |
| `playground/`                                  | A small app that extends the layer. Try each piece here by hand; the route tests run against it. |
| `test/unit/`, `test/routes/`                   | Unit tests and route tests.                                                                      |

### Dependencies

Packages that the app also uses (`nuxt`, `vue`, and later `drizzle-orm`, the database drivers and similar) are **peer dependencies** with an explicit range, so the layer never brings a second copy into an app. A peer that only one piece needs is marked optional. The versions the layer is developed and tested with are in `devDependencies`.

## License

[MIT](LICENSE)
