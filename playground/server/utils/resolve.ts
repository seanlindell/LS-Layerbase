import type { PlaygroundCradle } from "../container";

/** `resolve(event, "noteService")`, typed with the playground's registrations. */
export const resolve = defineResolver<PlaygroundCradle>();
