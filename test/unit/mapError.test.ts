import { createError } from "h3";
import { describe, expect, it, vi } from "vitest";
import {
	ApiError,
	ConflictError,
	ForbiddenError,
	NotFoundError,
	UnauthorizedError,
	UnavailableError,
	UpstreamError,
	ValidationError,
} from "#shared/utils/apiErrors";
import { INTERNAL_ERROR_MESSAGE, mapAndLogError, mapError } from "~~/server/utils/mapError";

const SECRET = "SQLITE_ERROR: no such table: users";

describe("mapError: typed errors", () => {
	it.each([
		[new ValidationError("Bad title."), 400],
		[new UnauthorizedError("Sign in."), 401],
		[new ForbiddenError("Not for you."), 403],
		[new NotFoundError("No such note."), 404],
		[new ConflictError("Already exists."), 409],
		[new UpstreamError("The mail service failed."), 502],
		[new UnavailableError("The database is busy."), 503],
	])("keeps the status and message of %s", (error, status) => {
		const mapped = mapError(error);
		expect(mapped.status).toBe(status);
		expect(mapped.message).toBe(error.message);
		expect(mapped).not.toHaveProperty("payload");
	});

	it("names each error after its class", () => {
		expect(new ConflictError("x").name).toBe("ConflictError");
		expect(new ConflictError("x")).toBeInstanceOf(ApiError);
	});

	it("keeps the payload of a conflict", () => {
		const existing = { id: 7, title: "Same" };
		expect(mapError(new ConflictError("Already exists.", { payload: existing })).payload).toEqual(existing);
	});

	it("keeps the cause for the log and never sends it to the caller", () => {
		const cause = new Error(SECRET);
		const error = new UpstreamError("The mail service failed.", { cause });

		expect(error.cause).toBe(cause);
		expect(error.payload).toBeUndefined();
		expect(mapError(error)).toEqual({ status: 502, message: "The mail service failed.", log: true });
	});

	it("sets no cause when none is given", () => {
		expect(new NotFoundError("x")).not.toHaveProperty("cause");
		expect(new NotFoundError("x", { payload: 1 })).not.toHaveProperty("cause");
	});

	it("carries a payload and a cause together", () => {
		const cause = new Error("db");
		const error = new ApiError(418, "No coffee.", { payload: { pot: "tea" }, cause });

		expect(error.cause).toBe(cause);
		expect(mapError(error)).toEqual({
			status: 418,
			message: "No coffee.",
			payload: { pot: "tea" },
			log: false,
		});
	});

	it("asks for a log line for typed 5xx errors only", () => {
		expect(mapError(new NotFoundError("x")).log).toBe(false);
		expect(mapError(new UpstreamError("x")).log).toBe(true);
	});

	it("treats a typed error with a status outside 400 to 599 as unexpected", () => {
		expect(mapError(new ApiError(200, SECRET))).toEqual({
			status: 500,
			message: INTERNAL_ERROR_MESSAGE,
			log: true,
		});
	});
});

describe("mapError: h3 errors", () => {
	it("passes a 4xx through with its message", () => {
		const mapped = mapError(
			createError({ statusCode: 400, statusMessage: "Bad Request", message: "Invalid JSON body" }),
		);
		expect(mapped).toEqual({ status: 400, message: "Invalid JSON body", log: false });
	});

	it("passes the data of a 4xx through as the payload", () => {
		expect(
			mapError(createError({ statusCode: 422, message: "No.", data: { field: "title" } })).payload,
		).toEqual({
			field: "title",
		});
	});

	it("hides an h3 5xx", () => {
		const mapped = mapError(createError({ statusCode: 503, message: SECRET }));
		expect(mapped).toEqual({ status: 500, message: INTERNAL_ERROR_MESSAGE, log: true });
	});
});

describe("mapError: everything else becomes a generic 500", () => {
	const upstreamFetchError = Object.assign(
		new Error(`[GET] "https://internal.example/users": 404 Not Found`),
		{
			statusCode: 404,
		},
	);

	it.each([
		["an Error", new Error(SECRET)],
		["a 5xx-looking object", { statusCode: 503, message: SECRET }],
		["a 4xx-looking object", { statusCode: 404, message: SECRET }],
		["an Error with a status code that h3 did not make", upstreamFetchError],
		["a string", SECRET],
		["a number", 42],
		["null", null],
		["undefined", undefined],
	])("%s", (_name, thrown) => {
		const mapped = mapError(thrown);
		expect(mapped).toEqual({ status: 500, message: INTERNAL_ERROR_MESSAGE, log: true });
		expect(JSON.stringify(mapped)).not.toContain("SQLITE");
		expect(JSON.stringify(mapped)).not.toContain("internal.example");
	});
});

describe("mapAndLogError", () => {
	const context = { method: "POST", path: "/api/notes" };

	it("logs the original error with the method and path", () => {
		const log = vi.fn();
		const error = new Error(SECRET);
		const mapped = mapAndLogError(error, context, log);

		expect(mapped.message).toBe(INTERNAL_ERROR_MESSAGE);
		expect(log).toHaveBeenCalledOnce();
		expect(log.mock.calls[0]?.[0]).toContain("POST /api/notes");
		expect(log.mock.calls[0]?.[1]).toBe(error);
	});

	it("does not log an error that is the caller's to fix", () => {
		const log = vi.fn();
		mapAndLogError(new ValidationError("Bad title."), context, log);
		mapAndLogError(createError({ statusCode: 400, message: "Invalid JSON body" }), context, log);
		expect(log).not.toHaveBeenCalled();
	});
});
