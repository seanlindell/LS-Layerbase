// Issues a key. The full key is in this response and nowhere else afterwards.
export default defineActionHandler(async (event) => {
	requireSession(event);
	const body = await readBody<{ name?: unknown; scopes?: unknown; expiresInSeconds?: unknown }>(event);
	const seconds = typeof body?.expiresInSeconds === "number" ? body.expiresInSeconds : null;

	const issued = await resolve(event, "apiKeyService").issue({
		name: body?.name,
		scopes: body?.scopes,
		expiresAt: seconds === null ? null : new Date(Date.now() + seconds * 1000),
	});

	return ActionResult.ok("Key created. Copy it now; it is not shown again.", issued);
});
