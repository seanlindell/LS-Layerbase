import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { MemoryApiKeyRepository } from "../../server/utils/apiKeyRepositories";
import { ApiKeyService } from "../../server/utils/apiKeyService";
import type { ApiKeyAuditEntry, ApiKeyRepository } from "../../server/utils/apiKeyService";
import type { ContainerSetup } from "../../server/utils/container";
import type * as schema from "./db/schema";
import { NoteRepository } from "./repositories/NoteRepository";
import type { INoteRepository } from "./repositories/NoteRepository";
import { NoteService } from "./services/NoteService";

/** Everything that can be resolved in the playground, by name. */
export interface PlaygroundCradle {
	db: BetterSQLite3Database<typeof schema>;
	noteRepository: INoteRepository;
	noteService: NoteService;
	apiKeyRepository: ApiKeyRepository;
	apiKeyService: ApiKeyService;
	/** One id per request. The plugin registers it in the scope of each request. */
	requestId: string;
}

/** What a key of the playground can be allowed to do. */
export const PLAYGROUND_SCOPES = ["notes:read", "notes:write"] as const;

/** Each audit entry goes to the log. It never holds a key or a secret. */
function logAudit(entry: ApiKeyAuditEntry): void {
	console.info(`[playground] audit ${JSON.stringify(entry)}`);
}

/**
 * The playground's services and repositories. The plugin adds `db`, because the
 * database is opened by the server and a test does not want one. For the same
 * reason the keys are kept in memory here, and the plugin replaces that
 * registration with the SQLite repository.
 */
export const registerServices: ContainerSetup<PlaygroundCradle> = ({
	container,
	service,
	factory,
	value,
}) => {
	container.register({
		noteRepository: service(NoteRepository),
		noteService: service(NoteService),
		apiKeyRepository: value(new MemoryApiKeyRepository()),
		apiKeyService: factory(
			({ apiKeyRepository }) =>
				new ApiKeyService({
					repository: apiKeyRepository,
					scopes: PLAYGROUND_SCOPES,
					prefix: "pgk",
					onAudit: logAudit,
				}),
		),
	});
};
