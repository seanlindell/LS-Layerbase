// Who the request is, as the auth middleware sees it. Public, so it also answers "nobody".
export default defineApiHandler((event) => ({
	auth: event.context.auth ?? null,
	user: readPlaygroundSession(event),
}));
