import type { H3Event } from "h3";

/**
 * A stand-in for a real session, so that the playground can show how keys and
 * sessions work together. The cookie holds the user's name in plain text and
 * anyone can set it. A real app uses `nuxt-auth-utils` or similar.
 */
export const SESSION_COOKIE = "playground-user";

export interface PlaygroundUser {
	name: string;
}

export function readPlaygroundSession(event: H3Event): PlaygroundUser | null {
	const name = getCookie(event, SESSION_COOKIE);

	return name ? { name } : null;
}
