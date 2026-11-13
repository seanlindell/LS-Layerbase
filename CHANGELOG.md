# Changelog

All notable changes to this layer are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

How to read a version `X.Y.Z`:

- **X (major):** a breaking change. The entry has a **Migration** section that says what to change in an app.
- **Y (minor):** new things that do not break an app. While the version is `0.Y.Z`, a minor version can also break; the entry then has a **Migration** section too.
- **Z (patch):** fixes only.

## [Unreleased]

## [0.2.0] - 2026-11-12

Changes asked for by the first five apps that moved to the layer.

### Changed

- **Typed errors take an options object:** `new ConflictError(message, { payload, cause })`, and `new ApiError(status, message, { payload, cause })`. Before, the second argument was the payload, so the common `new XError(message, { cause })` sent `{ cause }` to the caller as data. Now `cause` stays on the error for the server log and is never sent.
- **The layer's request context moved to `event.context.layerbase`:** the container is `event.context.layerbase.container` and the identity from the auth middleware is `event.context.layerbase.auth`. The layer no longer declares `event.context.container` or `event.context.auth`, so an app can type those fields itself without a type error.
- **`notifyError` shows a message the app wrote:** it takes a string, or an `ApiError`, and shows its message. Any other error that did not come from a request still shows the fixed message.

### Added

- **`watchFetchError(error, title?)`** in `useApi()`: an error notification each time a `useFetch` read fails.
- **Notification kinds `warning` and `info`**, with `notifyWarning` and `notifyInfo`, and **`notify(notification)`** to send any notification.
- **`status` on error notifications:** the HTTP status of the failure, or `null` when a request got no response, so an app can handle a 401 in its `layerbase:notify` listener.
- **README:** how to keep an existing health body with `createLazyHealthProbe`, that an empty `Authorization: Bearer` is answered with 401, and why `engines.node` is `>=22.22.3`.

### Migration

1. Typed errors: change `new XError(message, payload)` to `new XError(message, { payload })`, and `new ApiError(status, message, payload)` to `new ApiError(status, message, { payload })`. A call with `{ cause }` as the second argument is now right as it is. TypeScript flags most old calls, because a record has no property in common with the options; a payload typed `unknown` or `any` is not flagged, so search for these calls too.
2. Code that read `event.context.container` or `event.context.auth` set by the layer: use `resolve(event, name)`, `useContainer(event)` and `requireAuth(event)`, or read `event.context.layerbase?.container` and `event.context.layerbase?.auth`.
3. Optional: drop an app's own `watchFetchError`, warning toasts or string-message helpers in favour of the layer's. Map the new `warning` and `info` kinds in the `layerbase:notify` listener.

## [0.1.0] - 2026-11-12

The first version.

### Added

- **API error contract:** typed errors (`ValidationError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `UpstreamError`, `UnavailableError` on `ApiError`), `defineApiHandler` for reads, `defineActionHandler` for writes, `httpError`, and the `ActionResult` type with `ActionResult.ok` and `ActionResult.fail`.
- **`useApi`:** a fetch helper whose `run` resolves to an `ActionResult` for a success and for a failure, with a `layerbase:notify` hook for the app's own toasts.
- **Migrations on boot:** `defineMigrationPlugin` with `sqliteMigrator` and `postgresMigrator`, and the readiness functions `isMigrated`, `migrationStatus`, `whenMigrated` and `markMigrated`.
- **Health check:** `defineHealthHandler`, which answers 200 only when the migrations are done and the database answers.
- **DI container:** `defineContainerPlugin`, `defineResolver`, `useContainer` and `createTestContainer` on awilix.
- **API keys:** `ApiKeyService`, repositories for SQLite, PostgreSQL and memory, the Drizzle tables, and `defineAuthMiddleware` with route rules, scopes and an `Origin` check for cookie writes.

[Unreleased]: https://github.com/seanlindell/LS-Layerbase/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/seanlindell/LS-Layerbase/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/seanlindell/LS-Layerbase/releases/tag/v0.1.0
