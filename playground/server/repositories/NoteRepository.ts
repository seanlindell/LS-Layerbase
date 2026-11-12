import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "../db/schema";
import { notes } from "../db/schema";

export type Note = typeof notes.$inferSelect;

export interface INoteRepository {
	findById(id: number): Note | undefined;
	findByTitle(title: string): Note | undefined;
	create(title: string): Note;
}

export class NoteRepository implements INoteRepository {
	private readonly db: BetterSQLite3Database<typeof schema>;

	constructor({ db }: { db: BetterSQLite3Database<typeof schema> }) {
		this.db = db;
	}

	findById(id: number): Note | undefined {
		return this.db.select().from(notes).where(eq(notes.id, id)).get();
	}

	findByTitle(title: string): Note | undefined {
		return this.db.select().from(notes).where(eq(notes.title, title)).get();
	}

	create(title: string): Note {
		return this.db.insert(notes).values({ title }).returning().get();
	}
}
