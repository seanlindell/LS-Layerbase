import { randomUUID } from "node:crypto";
import { asValue } from "awilix";
import { registerServices } from "../container";
import type { PlaygroundCradle } from "../container";

// Builds the container once, after the migrations (file name order). Each request
// gets a scope of it, with one value of its own.
export default defineContainerPlugin<PlaygroundCradle>(
	(tools) => {
		tools.container.register({ db: tools.value(useDb()) });
		registerServices(tools);
	},
	{
		scopePerRequest: true,
		onRequestScope: (scope) => scope.register({ requestId: asValue(randomUUID()) }),
	},
);
