import { InjectionMode, Lifetime, asClass, asFunction, asValue, createContainer } from "awilix";
import type { AwilixContainer, BuildResolver, Constructor, DisposableResolver, Resolver } from "awilix";
import type { H3Event } from "h3";

declare module "h3" {
	interface H3EventContext {
		/** The container for this request: the app's container, or a scope of it. */
		container?: AwilixContainer;
	}
}

/**
 * How long one instance lives.
 *
 * - `singleton`: one instance for the whole server. This is the default.
 * - `scoped`: one instance per request. It needs `scopePerRequest` on the plugin.
 * - `transient`: a new instance each time it is resolved.
 */
export type ServiceLifetime = "singleton" | "scoped" | "transient";

const LIFETIMES = {
	singleton: Lifetime.SINGLETON,
	scoped: Lifetime.SCOPED,
	transient: Lifetime.TRANSIENT,
} as const;

/** What a setup function gets to register the app's services with. */
export interface ContainerTools<Cradle extends object> {
	container: AwilixContainer<Cradle>;
	/** Registers a class. Its constructor gets the other registrations as one object. */
	service<T>(
		implementation: Constructor<T>,
		lifetime?: ServiceLifetime,
	): BuildResolver<T> & DisposableResolver<T>;
	/** Registers a function that makes the value. It gets the other registrations as one object. */
	factory<T>(
		make: (cradle: Cradle) => T,
		lifetime?: ServiceLifetime,
	): BuildResolver<T> & DisposableResolver<T>;
	/** Registers a value that exists already, for example a database connection or a fake. */
	value<T>(value: T): Resolver<T>;
}

/**
 * Registers the app's services and repositories. Keep it in a file of its own, so
 * that the plugin and the tests use the same registrations.
 */
export type ContainerSetup<Cradle extends object> = (tools: ContainerTools<Cradle>) => void;

/**
 * Builds a container and runs the setup function on it.
 *
 * The container is strict: a singleton cannot depend on something with a shorter
 * life, and a name can be resolved only if it is registered.
 */
export function buildContainer<Cradle extends object>(
	setup: ContainerSetup<Cradle>,
): AwilixContainer<Cradle> {
	const container = createContainer<Cradle>({ injectionMode: InjectionMode.PROXY, strict: true });

	setup({
		container,
		service: (implementation, lifetime = "singleton") =>
			asClass(implementation, { lifetime: LIFETIMES[lifetime] }),
		factory: (make, lifetime = "singleton") => asFunction(make, { lifetime: LIFETIMES[lifetime] }),
		value: (value) => asValue(value),
	});

	return container;
}

/**
 * For tests: the app's container, with some registrations replaced by fakes.
 *
 *     const container = createTestContainer(registerServices, { noteRepository: fakeRepository });
 *     const service = container.resolve("noteService"); // gets the fake
 *
 * A registration that the test does not resolve is never built, so a test of one
 * service needs fakes only for what that service uses.
 */
export function createTestContainer<Cradle extends object>(
	setup: ContainerSetup<Cradle>,
	fakes: Partial<Cradle> = {},
): AwilixContainer<Cradle> {
	const container = buildContainer(setup);
	for (const [name, fake] of Object.entries(fakes)) {
		container.register(name, asValue(fake));
	}

	return container;
}

/** On `globalThis`, so that a second bundled copy of this module finds the same container. */
const KEY = Symbol.for("layerbase.container");

export function setRootContainer(container: AwilixContainer | undefined): void {
	(globalThis as { [KEY]?: AwilixContainer })[KEY] = container;
}

/**
 * The container, typed with the app's registrations.
 *
 * With an event it is the container of that request, which is a scope when the
 * plugin has `scopePerRequest`. Without an event (a server plugin, a task) it is
 * the app's root container.
 */
export function useContainer<Cradle extends object>(event?: H3Event): AwilixContainer<Cradle> {
	const container = event?.context.container ?? (globalThis as { [KEY]?: AwilixContainer })[KEY];
	if (!container) {
		throw new Error(
			"[layerbase] There is no container yet. Add a server plugin with `defineContainerPlugin`, and name it so that it runs before the code that resolves from it.",
		);
	}

	return container as AwilixContainer<Cradle>;
}

/** The typed `resolve` of one app. See `defineResolver`. */
export interface ContainerResolve<Cradle extends object> {
	/** Resolves from the app's root container. */
	<Name extends keyof Cradle>(name: Name): Cradle[Name];
	/** Resolves from the container of this request. */
	<Name extends keyof Cradle>(event: H3Event, name: Name): Cradle[Name];
}

/**
 * Makes a `resolve` function that knows the app's registrations:
 *
 *     // server/utils/resolve.ts
 *     export const resolve = defineResolver<AppCradle>();
 *
 *     // in a route
 *     const note = resolve(event, "noteService").find(id);
 */
export function defineResolver<Cradle extends object>(): ContainerResolve<Cradle> {
	return <Name extends keyof Cradle>(eventOrName: H3Event | Name, name?: Name): Cradle[Name] => {
		if (name === undefined) return useContainer<Cradle>().resolve(eventOrName as Name);

		return useContainer<Cradle>(eventOrName as H3Event).resolve(name);
	};
}
