# Changelog

All notable changes to this layer are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

How to read a version `X.Y.Z`:

- **X (major):** a breaking change. The entry has a **Migration** section that says what to change in an app.
- **Y (minor):** new things that do not break an app. While the version is `0.Y.Z`, a minor version can also break; the entry then has a **Migration** section too.
- **Z (patch):** fixes only.

## [Unreleased]

## [0.1.0] - 2026-11-12

The first version.

### Added

- **API error contract:** typed errors (`ValidationError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `UpstreamError`, `UnavailableError` on `ApiError`), `defineApiHandler` for reads, `defineActionHandler` for writes, `httpError`, and the `ActionResult` type with `ActionResult.ok` and `ActionResult.fail`.
- **`useApi`:** a fetch helper whose `run` resolves to an `ActionResult` for a success and for a failure, with a `layerbase:notify` hook for the app's own toasts.
- **Migrations on boot:** `defineMigrationPlugin` with `sqliteMigrator` and `postgresMigrator`, and the readiness functions `isMigrated`, `migrationStatus`, `whenMigrated` and `markMigrated`.
- **Health check:** `defineHealthHandler`, which answers 200 only when the migrations are done and the database answers.
- **DI container:** `defineContainerPlugin`, `defineResolver`, `useContainer` and `createTestContainer` on awilix.
- **API keys:** `ApiKeyService`, repositories for SQLite, PostgreSQL and memory, the Drizzle tables, and `defineAuthMiddleware` with route rules, scopes and an `Origin` check for cookie writes.

[Unreleased]: https://github.com/seanlindell/LS-Layerbase/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/seanlindell/LS-Layerbase/releases/tag/v0.1.0
