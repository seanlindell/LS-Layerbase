import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
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
	/** One id per request. The plugin registers it in the scope of each request. */
	requestId: string;
}

/**
 * The playground's services and repositories. The plugin adds `db`, because the
 * database is opened by the server and a test does not want one.
 */
export const registerServices: ContainerSetup<PlaygroundCradle> = ({ container, service }) => {
	container.register({
		noteRepository: service(NoteRepository),
		noteService: service(NoteService),
	});
};
