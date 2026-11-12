import { NotFoundError, ValidationError } from "../../shared/utils/apiErrors";
import {
	DEFAULT_API_KEY_PREFIX,
	assertApiKeyPrefix,
	describeApiKey,
	hashApiKeySecret,
	mintApiKey,
	parseApiKey,
	verifyApiKeySecret,
} from "./apiKeyToken";

/** One API key as it is stored. The secret itself is never stored. */
export interface ApiKeyRecord {
	/** The lookup id from the key. */
	id: string;
	name: string;
	/** SHA-256 of the secret, as hex. */
	secretHash: string;
	scopes: string[];
	createdAt: Date;
	lastUsedAt: Date | null;
	expiresAt: Date | null;
	revokedAt: Date | null;
}

/**
 * Where API keys are stored. The layer has implementations for SQLite and
 * PostgreSQL on Drizzle and one in memory; an app can write its own.
 */
export interface ApiKeyRepository {
	create(record: ApiKeyRecord): Promise<void>;
	findById(id: string): Promise<ApiKeyRecord | null>;
	list(): Promise<ApiKeyRecord[]>;
	touchLastUsed(id: string, at: Date): Promise<void>;
	/** False when there is no such key, or it is revoked already. */
	revoke(id: string, at: Date): Promise<boolean>;
}

/** A key without its hash: safe to send to the person who manages the keys. */
export interface ApiKeyView {
	Id: string;
	Name: string;
	/** For example `lsk_4f2a91cc03b7d5e1…`. */
	Preview: string;
	Scopes: string[];
	CreatedAt: string;
	LastUsedAt: string | null;
	ExpiresAt: string | null;
	RevokedAt: string | null;
}

export interface IssuedApiKey {
	Key: ApiKeyView;
	/** The full key. This is the only time it exists outside the caller's hands. */
	PlainTextKey: string;
}

/** Who a valid key is. This is what a request gets as its identity. */
export interface ApiKeyIdentity {
	keyId: string;
	name: string;
	scopes: string[];
}

/** Why a key was refused. For the audit hook only; the caller never sees it. */
export type ApiKeyRefusal = "malformed" | "unknown" | "wrong-secret" | "expired" | "revoked";

export type ApiKeyAuthResult =
	{ ok: true; key: ApiKeyIdentity } | { ok: false; reason: ApiKeyRefusal; keyId: string | null };

export interface ApiKeyAuditEntry {
	type: "key.used" | "key.refused" | "key.created" | "key.revoked";
	/** Null when the presented string was not a key at all. */
	keyId: string | null;
	reason?: ApiKeyRefusal | "missing-scope" | "not-a-key-route" | "rate-limited";
	method?: string;
	/** Without the query string. */
	path?: string;
	at: Date;
}

export interface ApiKeyServiceOptions {
	repository: ApiKeyRepository;
	/** All scopes that the app knows. A key can only be issued with scopes from this list. */
	scopes: readonly string[];
	/** The first part of each key. Give each app its own. The default is `lsk`. */
	prefix?: string;
	/** Called for each use, refusal, creation and revocation. It never gets a key or a secret. */
	onAudit?: (entry: ApiKeyAuditEntry) => void | Promise<void>;
	/** The clock, for tests. */
	now?: () => Date;
	log?: Pick<Console, "error">;
}

export interface IssueApiKeyInput {
	name: unknown;
	scopes: unknown;
	expiresAt?: Date | null;
}

export const MAX_API_KEY_NAME_LENGTH = 80;

/**
 * `lastUsedAt` answers "is this key still in use?", so it is written at most this
 * often. Without the limit, each authenticated request would be a write.
 */
export const LAST_USED_WRITE_INTERVAL_MS = 60_000;

/** A valid hash that no secret has. Compared against when the id is unknown, so that case takes the same time. */
const NO_SUCH_KEY_HASH = "0".repeat(64);

/**
 * The rules for API keys: issue, list, revoke and check.
 *
 * The secret part of a key exists in two places only: the answer of `issue()`
 * and the caller's configuration. It is hashed on the way in, so a leaked
 * database gives no usable keys.
 */
export class ApiKeyService {
	private readonly repository: ApiKeyRepository;
	private readonly scopes: ReadonlySet<string>;
	private readonly prefix: string;
	private readonly onAudit: ApiKeyServiceOptions["onAudit"];
	private readonly now: () => Date;
	private readonly log: Pick<Console, "error">;

	constructor(options: ApiKeyServiceOptions) {
		this.repository = options.repository;
		this.scopes = new Set(options.scopes);
		this.prefix = options.prefix ?? DEFAULT_API_KEY_PREFIX;
		this.onAudit = options.onAudit;
		this.now = options.now ?? (() => new Date());
		this.log = options.log ?? console;
		assertApiKeyPrefix(this.prefix);
	}

	/** Makes a key. The full key is in the result, and nowhere else afterwards. */
	async issue(input: IssueApiKeyInput): Promise<IssuedApiKey> {
		const name = typeof input.name === "string" ? input.name.trim() : "";
		if (!name) throw new ValidationError("Give the key a name.");
		if (name.length > MAX_API_KEY_NAME_LENGTH) {
			throw new ValidationError(`The name can have ${MAX_API_KEY_NAME_LENGTH} characters at most.`);
		}

		if (!Array.isArray(input.scopes) || input.scopes.length === 0) {
			throw new ValidationError("Give the key one scope or more.");
		}
		const unknown = input.scopes.filter((scope) => typeof scope !== "string" || !this.scopes.has(scope));
		if (unknown.length > 0) {
			throw new ValidationError(`Unknown scope: ${unknown.map(String).join(", ")}.`);
		}
		const scopes = [...new Set(input.scopes as string[])];

		const now = this.now();
		const expiresAt = input.expiresAt ?? null;
		if (expiresAt !== null && (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime())) {
			throw new ValidationError("The expiry must be a time in the future.");
		}

		const minted = mintApiKey(this.prefix);
		const record: ApiKeyRecord = {
			id: minted.id,
			name,
			secretHash: hashApiKeySecret(minted.secret),
			scopes,
			createdAt: now,
			lastUsedAt: null,
			expiresAt,
			revokedAt: null,
		};
		await this.repository.create(record);
		await this.audit({ type: "key.created", keyId: record.id, at: now });

		return { Key: this.toView(record), PlainTextKey: minted.plainText };
	}

	async list(): Promise<ApiKeyView[]> {
		return (await this.repository.list()).map((record) => this.toView(record));
	}

	async revoke(id: string): Promise<void> {
		const now = this.now();
		if (!(await this.repository.revoke(id, now))) {
			throw new NotFoundError("That key does not exist or is revoked already.");
		}
		await this.audit({ type: "key.revoked", keyId: id, at: now });
	}

	/**
	 * Checks a presented key. It does not throw for a bad key, and it does not
	 * write an audit entry: the caller knows the route and does that.
	 */
	async authenticate(presented: string): Promise<ApiKeyAuthResult> {
		const parsed = parseApiKey(presented, this.prefix);
		if (!parsed) return { ok: false, reason: "malformed", keyId: null };

		const record = await this.repository.findById(parsed.id);
		if (!record) {
			verifyApiKeySecret(parsed.secret, NO_SUCH_KEY_HASH);

			return { ok: false, reason: "unknown", keyId: parsed.id };
		}

		if (!verifyApiKeySecret(parsed.secret, record.secretHash)) {
			return { ok: false, reason: "wrong-secret", keyId: record.id };
		}
		if (record.revokedAt !== null) return { ok: false, reason: "revoked", keyId: record.id };

		const now = this.now();
		if (record.expiresAt !== null && record.expiresAt.getTime() <= now.getTime()) {
			return { ok: false, reason: "expired", keyId: record.id };
		}

		if (
			record.lastUsedAt === null ||
			now.getTime() - record.lastUsedAt.getTime() >= LAST_USED_WRITE_INTERVAL_MS
		) {
			await this.repository.touchLastUsed(record.id, now);
		}

		return { ok: true, key: { keyId: record.id, name: record.name, scopes: [...record.scopes] } };
	}

	/** Sends an entry to the audit hook. An error in the hook is logged and goes no further. */
	async audit(entry: ApiKeyAuditEntry): Promise<void> {
		if (!this.onAudit) return;
		try {
			await this.onAudit(entry);
		} catch (error) {
			this.log.error("[layerbase] The API key audit hook failed:", error);
		}
	}

	private toView(record: ApiKeyRecord): ApiKeyView {
		return {
			Id: record.id,
			Name: record.name,
			Preview: describeApiKey(record.id, this.prefix),
			Scopes: [...record.scopes],
			CreatedAt: record.createdAt.toISOString(),
			LastUsedAt: record.lastUsedAt?.toISOString() ?? null,
			ExpiresAt: record.expiresAt?.toISOString() ?? null,
			RevokedAt: record.revokedAt?.toISOString() ?? null,
		};
	}
}
