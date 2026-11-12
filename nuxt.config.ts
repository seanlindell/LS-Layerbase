// The layer's own configuration. An app that extends the layer gets everything in
// `app/`, `server/` and `shared/` through Nuxt's normal layer merging, so this file
// only holds what the layer needs to be set for it.
export default defineNuxtConfig({
	compatibilityDate: "2026-09-01",
	// Stated, not detected. Nuxt uses the layer's root folder as its source folder
	// when `app/` does not exist, and then type-checks the tests and the config
	// files as if they were app code.
	srcDir: "app/",

	runtimeConfig: {
		layerbase: {
			/**
			 * Apply database migrations when the server starts. Set
			 * `NUXT_LAYERBASE_MIGRATE_ON_BOOT=false` for an app that runs its
			 * migrations elsewhere, for example as a deploy step.
			 */
			migrateOnBoot: true,
			/**
			 * The folder with the Drizzle migrations, relative to the working
			 * directory of the server. `NUXT_LAYERBASE_MIGRATIONS_FOLDER` overrides it.
			 */
			migrationsFolder: "./drizzle",
		},
	},
});
