// A write route. The body is an `ActionResult` on success and on failure.
export default defineActionHandler(async (event) => {
	const body = await readBody<{ title?: unknown }>(event);

	return ActionResult.ok("Note created.", createNote(body?.title));
});
