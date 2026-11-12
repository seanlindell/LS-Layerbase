import { defineConfig } from "drizzle-kit";

// Run from this folder: `pnpm exec drizzle-kit generate` after a change to the schema.
export default defineConfig({
	dialect: "sqlite",
	schema: "./server/db/schema.ts",
	out: "./drizzle",
});
