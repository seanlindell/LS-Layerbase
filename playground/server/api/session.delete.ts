export default defineActionHandler((event) => {
	deleteCookie(event, SESSION_COOKIE, { path: "/" });

	return ActionResult.ok("Signed out.");
});
