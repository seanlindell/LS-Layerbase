// Shows the per-request scope: the id is the same within one request, and each
// request has its own. The service is a singleton, shared by all requests.
export default defineApiHandler((event) => ({
	requestId: resolve(event, "requestId"),
	sameAgain: resolve(event, "requestId"),
	sameService: resolve(event, "noteService") === resolve("noteService"),
}));
