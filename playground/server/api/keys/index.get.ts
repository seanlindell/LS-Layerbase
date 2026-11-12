// Key management is for a signed-in person. No rule names these routes, so the
// middleware refuses API keys; `requireSession` says the same in the handler.
export default defineApiHandler(async (event) => {
	requireSession(event);

	return await resolve(event, "apiKeyService").list();
});
