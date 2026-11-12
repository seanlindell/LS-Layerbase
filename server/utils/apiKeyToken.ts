import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Making, parsing and checking of API keys. See docs/api-keys-design.md.
 *
 * Format: `<prefix>_<id>_<secret>`
 * - `id`: 16 hex characters. Not secret. It names the record, so a check is one
 *   lookup, and it can appear in a user interface or a log.
 * - `secret`: 32 random bytes as base64url. The only part that grants anything,
 *   and the only part that is never stored.
 */
export const DEFAULT_API_KEY_PREFIX = "lsk";

const SEPARATOR = "_";
const ID_BYTES = 8;
const SECRET_BYTES = 32;
const ID_PATTERN = /^[0-9a-f]{16}$/;
/** 32 bytes as base64url, without padding, are 43 characters. */
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PREFIX_PATTERN = /^[a-z0-9]{1,16}$/;

export interface MintedApiKey {
	id: string;
	secret: string;
	/** The full key. Show it to the user once; it cannot be made again. */
	plainText: string;
}

export interface ParsedApiKey {
	id: string;
	secret: string;
}

/** Throws when a prefix could not be told apart from the rest of a key. */
export function assertApiKeyPrefix(prefix: string): void {
	if (!PREFIX_PATTERN.test(prefix)) {
		throw new Error("[layerbase] An API key prefix must be 1 to 16 lower-case letters or digits.");
	}
}

export function mintApiKey(prefix: string = DEFAULT_API_KEY_PREFIX): MintedApiKey {
	assertApiKeyPrefix(prefix);
	const id = randomBytes(ID_BYTES).toString("hex");
	const secret = randomBytes(SECRET_BYTES).toString("base64url");

	return { id, secret, plainText: [prefix, id, secret].join(SEPARATOR) };
}

/** Splits a presented key. The result is null for anything that is not a key of this app. */
export function parseApiKey(raw: string, prefix: string = DEFAULT_API_KEY_PREFIX): ParsedApiKey | null {
	// Only the first two separators have a meaning: base64url can contain `_`.
	const [presentedPrefix, id, ...rest] = raw.trim().split(SEPARATOR);
	const secret = rest.join(SEPARATOR);

	if (presentedPrefix !== prefix || !id || !ID_PATTERN.test(id) || !SECRET_PATTERN.test(secret)) return null;

	return { id, secret };
}

/**
 * SHA-256, without salt and without stretching. That is correct here, although it
 * would be wrong for a password: the secret is 256 bits of random data, so there
 * is nothing to guess, and the check runs on each request.
 */
export function hashApiKeySecret(secret: string): string {
	return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Compares a presented secret with a stored hash in constant time. */
export function verifyApiKeySecret(secret: string, storedHash: string): boolean {
	const presented = Buffer.from(hashApiKeySecret(secret), "hex");
	const stored = Buffer.from(storedHash, "hex");

	// timingSafeEqual throws when the lengths differ.
	if (presented.length !== stored.length) return false;

	return timingSafeEqual(presented, stored);
}

/** How to show a key after its secret is gone, for example `lsk_4f2a91cc03b7d5e1…`. */
export function describeApiKey(id: string, prefix: string = DEFAULT_API_KEY_PREFIX): string {
	return `${prefix}${SEPARATOR}${id}…`;
}
