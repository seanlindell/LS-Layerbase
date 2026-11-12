import { fileURLToPath } from "node:url";

// The playground is a small app that extends the layer. It is the place to try each
// piece by hand (`pnpm dev`) and the app the route tests run against.
export default defineNuxtConfig({
	extends: [".."],
	modules: ["@nuxt/eslint"],
	compatibilityDate: "2026-09-01",
	devtools: { enabled: false },
	typescript: { strict: true },

	runtimeConfig: {
		/** The SQLite file. The route tests point `NUXT_DATABASE_PATH` at a temporary file. */
		databasePath: fileURLToPath(new URL("./.data/playground.sqlite", import.meta.url)),
		/**
		 * Optional. When set (`NUXT_POSTGRES_URL`), the health check also pings this
		 * PostgreSQL server, as an example of an app-specific check.
		 */
		postgresUrl: "",
		/** For the tests: wait this long before the migrations run (`NUXT_SLOW_MIGRATION_MS`). */
		slowMigrationMs: 0,
		layerbase: {
			// Absolute, because `pnpm dev` runs from the repository root.
			migrationsFolder: fileURLToPath(new URL("./drizzle", import.meta.url)),
		},
	},

	nitro: {
		// A native addon. Nitro must load it at run time and not bundle it.
		externals: { external: ["better-sqlite3"] },
	},
	eslint: {
		config: {
			// Lint the whole repository, not just the playground.
			rootDir: fileURLToPath(new URL("..", import.meta.url)),
		},
	},
});
