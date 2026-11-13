import type { AwilixContainer } from "awilix";
import type { H3Event } from "h3";
import type { AuthIdentity } from "./authRules";

/**
 * What the layer keeps on each request. It sits under `event.context.layerbase`,
 * so that an app can still declare its own `event.context.container` or
 * `event.context.auth` with its own types.
 */
export interface LayerbaseEventContext {
	/** The container for this request: the app's container, or a scope of it. Set by `defineContainerPlugin`. */
	container?: AwilixContainer;
	/** Who is making the request. Set by `defineAuthMiddleware`; not set on public routes without a credential. */
	auth?: AuthIdentity;
}

declare module "h3" {
	interface H3EventContext {
		layerbase?: LayerbaseEventContext;
	}
}

/** The layer's part of the request context, created on first use. */
export function layerbaseEventContext(event: H3Event): LayerbaseEventContext {
	event.context.layerbase ??= {};

	return event.context.layerbase;
}
