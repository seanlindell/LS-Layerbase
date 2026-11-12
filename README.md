<p><img src="assets/icon.svg" alt="" width="72" height="72"></p>

# LS Layerbase

A [Nuxt layer](https://nuxt.com/docs/getting-started/layers) with the plumbing that small, self-hosted Nuxt apps tend to rewrite for each project: one API error contract, API-key authentication, database migrations on boot, a health check, a dependency-injection container and a typed fetch helper.

**Status: in development.** The layer package, the playground app, the tests and CI are set up. The pieces below are not built yet, and nothing is published. The [issues](../../issues) describe the first version.

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
