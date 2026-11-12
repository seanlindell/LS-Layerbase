<p><img src="assets/icon.svg" alt="" width="72" height="72"></p>

# LS Layerbase

A [Nuxt layer](https://nuxt.com/docs/getting-started/layers) with the plumbing that small, self-hosted Nuxt apps tend to rewrite for each project: one API error contract, API-key authentication, database migrations on boot, a health check, a dependency-injection container and a typed fetch helper.

**Status: planning.** Nothing is built or published yet. The [issues](../../issues) describe the first version, and #1 comes first.

## Planned contents

| Piece | What it gives an app | Issue |
| --- | --- | --- |
| Layer setup | Package, playground app, tests, CI, license | #1 |
| API error contract | Typed errors, one mapping from error to HTTP status, handler wrappers that hide internal errors | #2 |
| Fetch helper | A `useApi` composable that reads that error contract on the client | #3 |
| API keys | Issuing, hashing, scoping, revoking and checking API keys, plus the auth middleware | #4 |
| Migrations on boot | Apply Drizzle migrations at startup and expose a readiness flag | #5 |
| Health check | A public `/api/health` route backed by readiness and a database ping | #6 |
| DI container | An awilix container plugin and typed `resolve` helper | #7 |
| Releases | Versioning, changelog and how apps stay up to date | #8 |

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
