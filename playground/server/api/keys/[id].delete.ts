export default defineActionHandler(async (event) => {
	requireSession(event);
	await resolve(event, "apiKeyService").revoke(getRouterParam(event, "id") ?? "");

	return ActionResult.ok("Key revoked.");
});
