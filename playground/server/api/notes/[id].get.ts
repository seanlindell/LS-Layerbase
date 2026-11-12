import { SECRET_BUG_MESSAGE } from "../../services/NoteService";

// A read route. Failures leave as h3 errors with the real status.
export default defineApiHandler((event) => {
	const raw = getRouterParam(event, "id") ?? "";
	if (raw === "bug") throw new Error(SECRET_BUG_MESSAGE);
	if (!/^\d+$/.test(raw)) throw httpError(400, "The id must be a whole number.");

	return resolve(event, "noteService").find(Number(raw));
});
