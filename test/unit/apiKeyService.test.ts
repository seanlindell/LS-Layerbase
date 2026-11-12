import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryApiKeyRepository } from "~~/server/utils/apiKeyRepositories";
import { ApiKeyService, LAST_USED_WRITE_INTERVAL_MS } from "~~/server/utils/apiKeyService";
import type { ApiKeyAuditEntry } from "~~/server/utils/apiKeyService";
import { hashApiKeySecret, parseApiKey } from "~~/server/utils/apiKeyToken";
import { NotFoundError, ValidationError } from "#shared/utils/apiErrors";

const SCOPES = ["notes:read", "notes:write"] as const;
const START = new Date("2026-11-12T10:00:00.000Z");

let repository: MemoryApiKeyRepository;
let audit: ApiKeyAuditEntry[];
let clock: Date;
let service: ApiKeyService;

function advance(ms: number) {
	clock = new Date(clock.getTime() + ms);
}

beforeEach(() => {
	repository = new MemoryApiKeyRepository();
	audit = [];
	clock = START;
	service = new ApiKeyService({
		repository,
		scopes: SCOPES,
		prefix: "app",
		now: () => clock,
		onAudit: (entry) => void audit.push(entry),
	});
});

describe("issue", () => {
	it("returns the full key once and stores only a hash of the secret", async () => {
		const issued = await service.issue({ name: "  Agent  ", scopes: ["notes:read"] });
		const parsed = parseApiKey(issued.PlainTextKey, "app")!;
		const stored = (await repository.findById(parsed.id))!;

		expect(issued.Key).toEqual({
			Id: parsed.id,
			Name: "Agent",
			Preview: `app_${parsed.id}…`,
			Scopes: ["notes:read"],
			CreatedAt: START.toISOString(),
			LastUsedAt: null,
			ExpiresAt: null,
			RevokedAt: null,
		});
		expect(stored.secretHash).toBe(hashApiKeySecret(parsed.secret));
		expect(JSON.stringify(stored)).not.toContain(parsed.secret);
		expect(JSON.stringify(await service.list())).not.toContain(stored.secretHash);
	});

	it.each([
		["no name", { name: "  ", scopes: ["notes:read"] }, /name/],
		["a name that is not text", { name: 5, scopes: ["notes:read"] }, /name/],
		["a name that is too long", { name: "x".repeat(81), scopes: ["notes:read"] }, /80/],
		["no scopes", { name: "Agent", scopes: [] }, /scope/],
		["scopes that are not a list", { name: "Agent", scopes: "notes:read" }, /scope/],
		["an unknown scope", { name: "Agent", scopes: ["notes:read", "admin"] }, /Unknown scope: admin/],
		["a scope that is not text", { name: "Agent", scopes: [7] }, /Unknown scope/],
	])("refuses %s", async (_name, input, message) => {
		await expect(service.issue(input)).rejects.toThrow(ValidationError);
		await expect(service.issue(input)).rejects.toThrow(message);
		expect(await repository.list()).toEqual([]);
	});

	it("stores a scope once when it is given twice", async () => {
		const issued = await service.issue({ name: "Agent", scopes: ["notes:read", "notes:read"] });

		expect(issued.Key.Scopes).toEqual(["notes:read"]);
	});

	it("refuses an expiry that is now, in the past, or not a date", async () => {
		for (const expiresAt of [START, new Date(START.getTime() - 1), new Date("nonsense")]) {
			await expect(service.issue({ name: "Agent", scopes: ["notes:read"], expiresAt })).rejects.toThrow(
				/future/,
			);
		}
	});

	it("refuses a prefix that is not valid when the service is made", () => {
		expect(() => new ApiKeyService({ repository, scopes: SCOPES, prefix: "bad_prefix" })).toThrow(/prefix/);
	});
});

describe("authenticate", () => {
	it("accepts a valid key and gives its identity", async () => {
		const issued = await service.issue({ name: "Agent", scopes: ["notes:read"] });

		expect(await service.authenticate(issued.PlainTextKey)).toEqual({
			ok: true,
			key: { keyId: issued.Key.Id, name: "Agent", scopes: ["notes:read"] },
		});
	});

	it("refuses text that is not a key, and a key of another app", async () => {
		const other = new ApiKeyService({ repository, scopes: SCOPES, prefix: "other" });
		const foreign = await other.issue({ name: "Agent", scopes: ["notes:read"] });

		expect(await service.authenticate("hello")).toEqual({ ok: false, reason: "malformed", keyId: null });
		expect(await service.authenticate(foreign.PlainTextKey)).toMatchObject({
			ok: false,
			reason: "malformed",
		});
	});

	it("refuses an id that does not exist", async () => {
		const result = await service.authenticate(`app_0123456789abcdef_${"A".repeat(43)}`);

		expect(result).toEqual({ ok: false, reason: "unknown", keyId: "0123456789abcdef" });
	});

	it("refuses the right id with a wrong secret", async () => {
		const issued = await service.issue({ name: "Agent", scopes: ["notes:read"] });
		const wrong = `app_${issued.Key.Id}_${"A".repeat(43)}`;

		expect(await service.authenticate(wrong)).toEqual({
			ok: false,
			reason: "wrong-secret",
			keyId: issued.Key.Id,
		});
	});

	it("accepts a key until its expiry, and refuses it from that moment", async () => {
		const expiresAt = new Date(START.getTime() + 60_000);
		const issued = await service.issue({ name: "Agent", scopes: ["notes:read"], expiresAt });

		advance(59_999);
		expect((await service.authenticate(issued.PlainTextKey)).ok).toBe(true);

		advance(1);
		expect(await service.authenticate(issued.PlainTextKey)).toMatchObject({ ok: false, reason: "expired" });
	});

	it("refuses a revoked key", async () => {
		const issued = await service.issue({ name: "Agent", scopes: ["notes:read"] });
		await service.revoke(issued.Key.Id);

		expect(await service.authenticate(issued.PlainTextKey)).toEqual({
			ok: false,
			reason: "revoked",
			keyId: issued.Key.Id,
		});
	});

	it("writes lastUsedAt on the first use, and then at most once a minute", async () => {
		const issued = await service.issue({ name: "Agent", scopes: ["notes:read"] });
		const touch = vi.spyOn(repository, "touchLastUsed");

		await service.authenticate(issued.PlainTextKey);
		advance(LAST_USED_WRITE_INTERVAL_MS - 1);
		await service.authenticate(issued.PlainTextKey);
		expect(touch).toHaveBeenCalledTimes(1);

		advance(1);
		await service.authenticate(issued.PlainTextKey);
		expect(touch).toHaveBeenCalledTimes(2);
		expect((await service.list())[0]?.LastUsedAt).toBe(clock.toISOString());
	});

	it("does not write lastUsedAt for a refused key", async () => {
		const issued = await service.issue({ name: "Agent", scopes: ["notes:read"] });
		await service.revoke(issued.Key.Id);
		const touch = vi.spyOn(repository, "touchLastUsed");

		await service.authenticate(issued.PlainTextKey);
		await service.authenticate(`app_${issued.Key.Id}_${"A".repeat(43)}`);

		expect(touch).not.toHaveBeenCalled();
	});
});

describe("revoke and list", () => {
	it("keeps a revoked key in the list, with the time", async () => {
		const issued = await service.issue({ name: "Agent", scopes: ["notes:read"] });
		advance(5000);
		await service.revoke(issued.Key.Id);

		expect(await service.list()).toMatchObject([{ Id: issued.Key.Id, RevokedAt: clock.toISOString() }]);
	});

	it("answers not found for an unknown id and for a second revocation", async () => {
		const issued = await service.issue({ name: "Agent", scopes: ["notes:read"] });
		await service.revoke(issued.Key.Id);

		await expect(service.revoke(issued.Key.Id)).rejects.toThrow(NotFoundError);
		await expect(service.revoke("0000000000000000")).rejects.toThrow(NotFoundError);
	});
});

describe("audit hook", () => {
	it("gets creation and revocation, with the id and never the key", async () => {
		const issued = await service.issue({ name: "Agent", scopes: ["notes:read"] });
		await service.revoke(issued.Key.Id);

		expect(audit).toEqual([
			{ type: "key.created", keyId: issued.Key.Id, at: START },
			{ type: "key.revoked", keyId: issued.Key.Id, at: START },
		]);
		expect(JSON.stringify(audit)).not.toContain(parseApiKey(issued.PlainTextKey, "app")!.secret);
	});

	it("does not break the operation when the hook throws", async () => {
		const log = { error: vi.fn() };
		const failing = new ApiKeyService({
			repository,
			scopes: SCOPES,
			log,
			onAudit: () => {
				throw new Error("audit store is down");
			},
		});

		await expect(failing.issue({ name: "Agent", scopes: ["notes:read"] })).resolves.toBeDefined();
		expect(log.error).toHaveBeenCalledOnce();
	});
});
