import { describe, expect, it } from "vitest";
import { LAYERBASE_NAME } from "#shared/utils/layerbase";

describe("LAYERBASE_NAME", () => {
	it("matches the package name", async () => {
		const pkg = await import("~~/package.json");
		expect(LAYERBASE_NAME).toBe(pkg.default.name);
	});
});
