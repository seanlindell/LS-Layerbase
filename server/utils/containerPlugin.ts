import type { AwilixContainer } from "awilix";
import type { H3Event } from "h3";
import { buildContainer, setRootContainer } from "./container";
import { layerbaseEventContext } from "./eventContext";
import type { ContainerSetup } from "./container";

export interface ContainerPluginOptions<Cradle extends object> {
	/**
	 * Give each request a scope of the container. Registrations with the `scoped`
	 * lifetime then live for one request. Without this, each request uses the root
	 * container.
	 */
	scopePerRequest?: boolean;
	/**
	 * Called for each request with its scope, to register values that belong to
	 * the request, for example the signed-in user. Only with `scopePerRequest`.
	 */
	onRequestScope?: (scope: AwilixContainer<Cradle>, event: H3Event) => void;
}

/**
 * A Nitro plugin that builds the app's container once, when the server starts,
 * and makes it available to each request.
 *
 *     // server/plugins/01.container.ts
 *     export default defineContainerPlugin(registerServices);
 *
 * Name the file so that it runs after the migration plugin and before the
 * plugins that resolve services.
 */
export function defineContainerPlugin<Cradle extends object>(
	setup: ContainerSetup<Cradle>,
	options: ContainerPluginOptions<Cradle> = {},
) {
	return defineNitroPlugin((nitroApp) => {
		const container = buildContainer(setup);
		setRootContainer(container);

		nitroApp.hooks.hook("request", (event) => {
			if (!options.scopePerRequest) {
				layerbaseEventContext(event).container = container;

				return;
			}

			const scope = container.createScope();
			layerbaseEventContext(event).container = scope;
			options.onRequestScope?.(scope, event);
		});

		if (options.scopePerRequest) {
			nitroApp.hooks.hook("afterResponse", async (event) => {
				await event.context.layerbase?.container?.dispose();
			});
		}

		nitroApp.hooks.hook("close", async () => {
			await container.dispose();
			setRootContainer(undefined);
		});
	});
}
