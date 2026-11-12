// "Signs in" as the given name. See server/utils/session.ts: this is not real authentication.
export default defineActionHandler(async (event) => {
	const body = await readBody<{ name?: unknown }>(event);
	const name = typeof body?.name === "string" ? body.name.trim() : "";
	if (!name) throw new ValidationError("Send a `name`.");

	setCookie(event, SESSION_COOKIE, name, { httpOnly: true, sameSite: "lax", path: "/" });

	return ActionResult.ok(`Signed in as ${name}.`);
});
