import { eq } from "drizzle-orm";
import { notes } from "../db/schema";

export type Note = typeof notes.$inferSelect;

/** The message of the fake bug below. The tests check that it never reaches a caller. */
export const SECRET_BUG_MESSAGE = "SQLITE_ERROR: no such table: secret_notes";

export function findNote(id: number): Note {
	const note = useDb().select().from(notes).where(eq(notes.id, id)).get();
	if (!note) throw new NotFoundError(`There is no note with id ${id}.`);

	return note;
}

export function createNote(title: unknown): Note {
	if (typeof title !== "string" || !title.trim()) {
		throw new ValidationError("Send a `title` that is not empty.");
	}

	const clean = title.trim();
	// Two fixed titles act as a bug and as an outside failure, for the tests.
	if (clean === "bug") throw new Error(SECRET_BUG_MESSAGE);
	if (clean === "upstream") throw new UpstreamError("The title service did not answer.");

	const db = useDb();
	const existing = db.select().from(notes).where(eq(notes.title, clean)).get();
	if (existing) throw new ConflictError("A note with that title already exists.", existing);

	return db.insert(notes).values({ title: clean }).returning().get();
}
