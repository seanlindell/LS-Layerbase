// A tiny in-memory store, so the playground has something to read and write.
export interface Note {
	id: number;
	title: string;
}

const notes: Note[] = [{ id: 1, title: "First note" }];

/** The message of the fake bug below. The tests check that it never reaches a caller. */
export const SECRET_BUG_MESSAGE = "SQLITE_ERROR: no such table: secret_notes";

export function findNote(id: number): Note {
	const note = notes.find((item) => item.id === id);
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

	const existing = notes.find((item) => item.title === clean);
	if (existing) throw new ConflictError("A note with that title already exists.", existing);

	const note = { id: notes.length + 1, title: clean };
	notes.push(note);

	return note;
}
