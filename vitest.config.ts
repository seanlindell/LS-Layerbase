import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = {
	"~~": fileURLToPath(new URL("./", import.meta.url)),
	"#shared": fileURLToPath(new URL("./shared", import.meta.url)),
};

export default defineConfig({
	test: {
		projects: [
			{
				// Plain functions, tested without Nuxt.
				resolve: { alias },
				test: {
					name: "unit",
					environment: "node",
					include: ["test/unit/**/*.test.ts"],
				},
			},
			{
				// Builds the playground once per file and sends real requests to it.
				resolve: { alias },
				test: {
					name: "routes",
					environment: "node",
					include: ["test/routes/**/*.test.ts"],
					testTimeout: 30_000,
					hookTimeout: 180_000,
				},
			},
		],
	},
});
