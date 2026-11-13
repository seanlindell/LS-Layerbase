import {
	ConflictError,
	NotFoundError,
	UpstreamError,
	ValidationError,
} from "../../../shared/utils/apiErrors";
import type { INoteRepository, Note } from "../repositories/NoteRepository";

/** The message of the fake bug below. The tests check that it never reaches a caller. */
export const SECRET_BUG_MESSAGE = "SQLITE_ERROR: no such table: secret_notes";

/** The rules for notes. It throws typed errors, which the handler wrappers turn into responses. */
export class NoteService {
	private readonly noteRepository: INoteRepository;

	constructor({ noteRepository }: { noteRepository: INoteRepository }) {
		this.noteRepository = noteRepository;
	}

	find(id: number): Note {
		const note = this.noteRepository.findById(id);
		if (!note) throw new NotFoundError(`There is no note with id ${id}.`);

		return note;
	}

	create(title: unknown): Note {
		if (typeof title !== "string" || !title.trim()) {
			throw new ValidationError("Send a `title` that is not empty.");
		}

		const clean = title.trim();
		// Two fixed titles act as a bug and as an outside failure, for the tests.
		if (clean === "bug") throw new Error(SECRET_BUG_MESSAGE);
		if (clean === "upstream") throw new UpstreamError("The title service did not answer.");

		const existing = this.noteRepository.findByTitle(clean);
		if (existing) throw new ConflictError("A note with that title already exists.", { payload: existing });

		return this.noteRepository.create(clean);
	}
}
