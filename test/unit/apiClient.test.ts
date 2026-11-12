import { createFetch } from "ofetch";
import { describe, expect, it, vi } from "vitest";
import {
	NETWORK_ERROR_MESSAGE,
	UNKNOWN_ERROR_MESSAGE,
	createApiRunner,
	fetchErrorMessage,
	fetchErrorStatus,
} from "~~/app/utils/apiClient";
import type { ApiNotification } from "~~/app/utils/apiClient";

interface Note {
	id: number;
	title: string;
}

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A real ofetch instance on top of a fake network, so the errors are real `FetchError`s. */
function runnerFor(respond: () => Response | Promise<Response>) {
	const $fetch = createFetch({ fetch: async () => respond() });
	const notifications: ApiNotification[] = [];
	const runner = createApiRunner<{ method?: string; body?: Record<string, unknown>; retry?: number }>(
		(request, options) => $fetch(request, options),
		(notification) => notifications.push(notification),
	);

	return { ...runner, notifications };
}

describe("run", () => {
	it("returns the ActionResult of a success, typed, without a notification", async () => {
		const note: Note = { id: 2, title: "Second" };
		const { run, notifications } = runnerFor(() =>
			json(200, { Success: true, Message: "Note created.", ResponseObject: note }),
		);

		const result = await run<Note>("/api/notes", { method: "POST", body: { title: "Second" } });

		expect(result).toEqual({ Success: true, Message: "Note created.", ResponseObject: note });
		if (result.Success) expect(result.ResponseObject.title).toBe("Second");
		expect(notifications).toEqual([]);
	});

	it.each([400, 404])("returns the body of a refused write (%i)", async (status) => {
		const { run } = runnerFor(() => json(status, { Success: false, Message: "No.", ResponseObject: null }));

		expect(await run("/api/notes", { method: "POST" })).toEqual({
			Success: false,
			Message: "No.",
			ResponseObject: null,
			Status: status,
		});
	});

	it("gives the payload of a refused write, such as the existing record on a 409", async () => {
		const existing: Note = { id: 1, title: "First" };
		const { run } = runnerFor(() =>
			json(409, {
				Success: false,
				Message: "A note with that title already exists.",
				ResponseObject: existing,
			}),
		);

		const result = await run<Note>("/api/notes", { method: "POST" });

		expect(result.Success).toBe(false);
		expect(result).toMatchObject({ Status: 409, ResponseObject: existing });
	});

	it("reads the message and data of an h3 error body", async () => {
		const { run } = runnerFor(() =>
			json(404, {
				statusCode: 404,
				statusMessage: "Not Found",
				message: "There is no note with id 9.",
				data: { id: 9 },
			}),
		);

		expect(await run("/api/notes/9")).toEqual({
			Success: false,
			Message: "There is no note with id 9.",
			ResponseObject: { id: 9 },
			Status: 404,
		});
	});

	it("returns the server's message for a 500", async () => {
		const { run } = runnerFor(() =>
			json(500, {
				Success: false,
				Message: "The server could not complete the request.",
				ResponseObject: null,
			}),
		);

		expect(await run("/api/notes", { method: "POST", retry: 0 })).toMatchObject({
			Success: false,
			Message: "The server could not complete the request.",
			Status: 500,
		});
	});

	it("names the status when the error body has no message", async () => {
		const { run } = runnerFor(() => new Response("<html>Bad gateway</html>", { status: 502 }));

		expect(await run("/api/notes", { retry: 0 })).toMatchObject({
			Success: false,
			Message: "The request failed with status 502.",
			Status: 502,
		});
	});

	it("returns a fixed message for a network failure", async () => {
		const { run } = runnerFor(() => {
			throw new TypeError("fetch failed");
		});

		expect(await run("/api/notes", { retry: 0 })).toEqual({
			Success: false,
			Message: NETWORK_ERROR_MESSAGE,
			ResponseObject: null,
			Status: null,
		});
	});

	it("treats a 200 with `Success: false` as a failure", async () => {
		const { run, notifications } = runnerFor(() =>
			json(200, { Success: false, Message: "Old style.", ResponseObject: null }),
		);

		expect(await run("/api/old")).toMatchObject({ Success: false, Message: "Old style.", Status: 200 });
		expect(notifications).toHaveLength(1);
	});

	it("fails when a success body is not an ActionResult", async () => {
		const { run } = runnerFor(() => json(200, { id: 1 }));

		expect((await run("/api/notes/1")).Success).toBe(false);
	});

	it("sends one error notification with the title and the server's message", async () => {
		const { run, notifications } = runnerFor(() =>
			json(400, { Success: false, Message: "No.", ResponseObject: null }),
		);

		await run("/api/notes", { method: "POST", errorTitle: "Could not create the note" });

		expect(notifications).toEqual([{ kind: "error", title: "Could not create the note", message: "No." }]);
	});

	it("sends no notification when silent", async () => {
		const { run, notifications } = runnerFor(() =>
			json(400, { Success: false, Message: "No.", ResponseObject: null }),
		);

		await run("/api/notes", { method: "POST", silent: true });

		expect(notifications).toEqual([]);
	});

	it("does not pass its own options on to the fetch function", async () => {
		const fetcher = vi.fn(async () => ({ Success: true, Message: "Ok.", ResponseObject: null }));
		const { run } = createApiRunner<{ method?: string }>(fetcher, () => undefined);

		await run("/api/notes", { method: "POST", pending: { value: false }, errorTitle: "x", silent: true });

		expect(fetcher).toHaveBeenCalledWith("/api/notes", { method: "POST" });
	});

	it("sets the pending flag while the request runs, and clears it after a failure", async () => {
		const pending = { value: false };
		const seen: boolean[] = [];
		const { run } = runnerFor(() => {
			seen.push(pending.value);

			return json(400, { Success: false, Message: "No.", ResponseObject: null });
		});

		await run("/api/notes", { method: "POST", pending });

		expect(seen).toEqual([true]);
		expect(pending.value).toBe(false);
	});
});

describe("errorMessage and errorStatus", () => {
	it("reads a thrown fetch error", async () => {
		const $fetch = createFetch({
			fetch: async () => json(404, { statusCode: 404, message: "No such note." }),
		});
		const error = await $fetch("/api/notes/9").catch((thrown: unknown) => thrown);

		expect(fetchErrorMessage(error)).toBe("No such note.");
		expect(fetchErrorStatus(error)).toBe(404);
	});

	it("uses the fixed message for a network failure", async () => {
		const $fetch = createFetch({
			fetch: async () => {
				throw new TypeError("fetch failed");
			},
		});
		const error = await $fetch("/api/notes", { retry: 0 }).catch((thrown: unknown) => thrown);

		expect(fetchErrorMessage(error)).toBe(NETWORK_ERROR_MESSAGE);
		expect(fetchErrorStatus(error)).toBeUndefined();
	});

	it("does not show the text of an error that is not a fetch error", () => {
		expect(fetchErrorMessage(new Error("Cannot read properties of undefined"))).toBe(UNKNOWN_ERROR_MESSAGE);
		expect(fetchErrorMessage("boom")).toBe(UNKNOWN_ERROR_MESSAGE);
		expect(fetchErrorMessage(null)).toBe(UNKNOWN_ERROR_MESSAGE);
	});
});
