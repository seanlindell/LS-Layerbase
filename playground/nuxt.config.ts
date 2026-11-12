import { fileURLToPath } from "node:url";

// The playground is a small app that extends the layer. It is the place to try each
// piece by hand (`pnpm dev`) and the app the route tests run against.
export default defineNuxtConfig({
	extends: [".."],
	modules: ["@nuxt/eslint"],
	compatibilityDate: "2026-09-01",
	devtools: { enabled: false },
	typescript: { strict: true },
	eslint: {
		config: {
			// Lint the whole repository, not just the playground.
			rootDir: fileURLToPath(new URL("..", import.meta.url)),
		},
	},
});
