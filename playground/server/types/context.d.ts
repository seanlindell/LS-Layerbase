import type { AwilixContainer } from "awilix";
import type { PlaygroundCradle } from "../container";

// An app may type these two fields itself, for its own container and its own
// auth code. The layer keeps its values under `event.context.layerbase`, so this
// compiles. The typecheck of the playground is the test that it keeps compiling.
declare module "h3" {
	interface H3EventContext {
		container?: AwilixContainer<PlaygroundCradle>;
		auth?: { appUserId: number };
	}
}

export {};
