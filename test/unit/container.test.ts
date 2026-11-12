import { describe, expect, it, vi } from "vitest";
import { registerServices } from "~~/playground/server/container";
import type { PlaygroundCradle } from "~~/playground/server/container";
import type { INoteRepository, Note } from "~~/playground/server/repositories/NoteRepository";
import {
	buildContainer,
	createTestContainer,
	defineResolver,
	setRootContainer,
	useContainer,
} from "~~/server/utils/container";
import type { ContainerSetup } from "~~/server/utils/container";
import { ConflictError, NotFoundError } from "#shared/utils/apiErrors";

class Clock {
	static made = 0;
	readonly id = ++Clock.made;
}

class Greeter {
	private readonly clock: Clock;
	readonly greeting: string;

	constructor({ clock, greeting }: { clock: Clock; greeting: string }) {
		this.clock = clock;
		this.greeting = greeting;
	}

	clockId() {
		return this.clock.id;
	}
}

interface TestCradle {
	greeting: string;
	clock: Clock;
	greeter: Greeter;
	requestId: string;
	stamp: { at: number };
}

let stamps = 0;
const setup: ContainerSetup<TestCradle> = ({ container, service, factory, value }) => {
	container.register({
		greeting: value("hello"),
		clock: service(Clock),
		greeter: service(Greeter),
		requestId: factory(() => "none", "scoped"),
		stamp: factory(() => ({ at: ++stamps }), "transient"),
	});
};

describe("buildContainer", () => {
	it("registers classes, factories and values, and injects dependencies by name", () => {
		const container = buildContainer(setup);
		const greeter = container.resolve("greeter");

		expect(greeter).toBeInstanceOf(Greeter);
		expect(greeter.greeting).toBe("hello");
		expect(greeter.clockId()).toBe(container.resolve("clock").id);
	});

	it("makes one instance of a service by default (singleton)", () => {
		const container = buildContainer(setup);

		expect(container.resolve("greeter")).toBe(container.resolve("greeter"));
		expect(container.createScope().resolve("clock")).toBe(container.resolve("clock"));
	});

	it("makes one instance per scope for the scoped lifetime", () => {
		const container = buildContainer(setup);
		const first = container.createScope();
		const second = container.createScope();
		first.register({ requestId: { resolve: () => "request-1" } });

		expect(first.resolve("requestId")).toBe("request-1");
		expect(second.resolve("requestId")).toBe("none");
	});

	it("makes a new instance each time for the transient lifetime", () => {
		const container = buildContainer(setup);

		expect(container.resolve("stamp")).not.toBe(container.resolve("stamp"));
	});

	it("refuses a name that is not registered", () => {
		const container = buildContainer(setup) as unknown as { resolve(name: string): unknown };

		expect(() => container.resolve("missing")).toThrow(/missing/);
	});
});

describe("createTestContainer", () => {
	it("replaces a registration with a fake, and the service gets the fake", () => {
		const fakeClock = { id: 999 } as Clock;
		const container = createTestContainer(setup, { clock: fakeClock });

		expect(container.resolve("clock")).toBe(fakeClock);
		expect(container.resolve("greeter").clockId()).toBe(999);
	});

	it("tests a playground service against a fake repository, without a database", () => {
		const stored: Note = { id: 1, title: "First note" };
		const noteRepository: INoteRepository = {
			findById: (id) => (id === 1 ? stored : undefined),
			findByTitle: (title) => (title === stored.title ? stored : undefined),
			create: vi.fn((title) => ({ id: 2, title })),
		};
		// `db` is registered by the server plugin only. Nothing here resolves it.
		const service = createTestContainer<PlaygroundCradle>(registerServices, { noteRepository }).resolve(
			"noteService",
		);

		expect(service.find(1)).toBe(stored);
		expect(() => service.find(5)).toThrow(NotFoundError);
		expect(() => service.create("First note")).toThrow(ConflictError);
		expect(service.create(" New ")).toEqual({ id: 2, title: "New" });
		expect(noteRepository.create).toHaveBeenCalledWith("New");
	});
});

describe("useContainer and defineResolver", () => {
	const resolve = defineResolver<TestCradle>();

	it("explains what to do when there is no container", () => {
		setRootContainer(undefined);

		expect(() => useContainer()).toThrow(/defineContainerPlugin/);
	});

	it("resolves from the root container without an event", () => {
		const container = buildContainer(setup);
		setRootContainer(container);
		try {
			expect(useContainer<TestCradle>()).toBe(container);
			expect(resolve("greeting")).toBe("hello");
		} finally {
			setRootContainer(undefined);
		}
	});

	it("resolves from the container of the request when given an event", () => {
		const scope = buildContainer(setup).createScope();
		scope.register({ requestId: { resolve: () => "request-7" } });
		const event = { context: { container: scope } } as unknown as Parameters<typeof useContainer>[0];

		expect(resolve(event!, "requestId")).toBe("request-7");
	});
});
