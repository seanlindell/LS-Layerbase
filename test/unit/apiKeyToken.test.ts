import { describe, expect, it } from "vitest";
import {
	describeApiKey,
	hashApiKeySecret,
	mintApiKey,
	parseApiKey,
	verifyApiKeySecret,
} from "~~/server/utils/apiKeyToken";

describe("mintApiKey", () => {
	it("makes prefix, 16 hex characters and a 43 character secret", () => {
		const key = mintApiKey("app");

		expect(key.plainText).toMatch(/^app_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/);
		expect(key.plainText).toBe(`app_${key.id}_${key.secret}`);
	});

	it("makes a different id and secret each time", () => {
		const keys = Array.from({ length: 50 }, () => mintApiKey());

		expect(new Set(keys.map((key) => key.id)).size).toBe(50);
		expect(new Set(keys.map((key) => key.secret)).size).toBe(50);
	});

	it("refuses a prefix that could be confused with the rest of the key", () => {
		for (const prefix of ["", "has_underscore", "UPPER", "with space", "x".repeat(17)]) {
			expect(() => mintApiKey(prefix)).toThrow(/prefix/);
		}
	});
});

describe("parseApiKey", () => {
	const id = "0123456789abcdef";
	const secret = "A".repeat(43);

	it("splits a key that was minted", () => {
		for (let round = 0; round < 50; round++) {
			const key = mintApiKey("app");
			expect(parseApiKey(key.plainText, "app")).toEqual({ id: key.id, secret: key.secret });
		}
	});

	it("keeps a secret that contains the separator", () => {
		const withSeparators = `a_b_c${"x".repeat(38)}`;

		expect(parseApiKey(`lsk_${id}_${withSeparators}`)).toEqual({ id, secret: withSeparators });
	});

	it("ignores space around the key", () => {
		expect(parseApiKey(`  lsk_${id}_${secret}\n`)).toEqual({ id, secret });
	});

	it.each([
		["another app's prefix", `fws_${id}_${secret}`],
		["no prefix", `${id}_${secret}`],
		["an id that is too short", `lsk_0123_${secret}`],
		["an id that is not hex", `lsk_0123456789abcdeg_${secret}`],
		["an upper-case id", `lsk_0123456789ABCDEF_${secret}`],
		["no secret", `lsk_${id}_`],
		["a secret that is too short", `lsk_${id}_${"A".repeat(42)}`],
		["a secret that is too long", `lsk_${id}_${"A".repeat(44)}`],
		["a secret with other characters", `lsk_${id}_${"A".repeat(42)}$`],
		["an empty string", ""],
		["some other text", "Bearer token"],
	])("gives null for %s", (_name, raw) => {
		expect(parseApiKey(raw)).toBeNull();
	});
});

describe("hashApiKeySecret and verifyApiKeySecret", () => {
	it("hashes to SHA-256 as hex", () => {
		// The known SHA-256 of "abc".
		expect(hashApiKeySecret("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
	});

	it("accepts the right secret and refuses a wrong one", () => {
		const { secret } = mintApiKey();
		const stored = hashApiKeySecret(secret);

		expect(verifyApiKeySecret(secret, stored)).toBe(true);
		expect(verifyApiKeySecret(`${secret.slice(0, -1)}${secret.endsWith("A") ? "B" : "A"}`, stored)).toBe(
			false,
		);
		expect(verifyApiKeySecret(mintApiKey().secret, stored)).toBe(false);
	});

	it("gives false, and does not throw, for a stored hash of the wrong length or form", () => {
		const { secret } = mintApiKey();

		expect(verifyApiKeySecret(secret, "")).toBe(false);
		expect(verifyApiKeySecret(secret, "abcd")).toBe(false);
		expect(verifyApiKeySecret(secret, "not hex at all")).toBe(false);
		expect(verifyApiKeySecret(secret, `${hashApiKeySecret(secret)}00`)).toBe(false);
	});
});

describe("describeApiKey", () => {
	it("shows the prefix and the id, and no secret", () => {
		expect(describeApiKey("0123456789abcdef", "app")).toBe("app_0123456789abcdef…");
	});
});
