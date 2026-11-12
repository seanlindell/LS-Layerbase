import { STATUS_CODES } from "node:http";
import type { EventHandlerRequest, H3Event } from "h3";
import { ActionResult } from "../../shared/utils/actionResult";
import type { ActionSuccess } from "../../shared/utils/actionResult";
import { mapAndLogError } from "./mapError";
import type { MappedError } from "./mapError";

/**
 * An h3 error with the standard reason phrase and a message written for the caller.
 * Use it for a one-off refusal inside a handler or a middleware:
 *
 *     if (!id) throw httpError(400, "Send an `id`.");
 *
 * For 5xx statuses, throw `UpstreamError` or `UnavailableError`. The handler
 * wrappers treat an h3 error with a 5xx status as unexpected and hide its message.
 */
export function httpError(status: number, message: string, data?: unknown) {
	return createError({ statusCode: status, statusMessage: STATUS_CODES[status], message, data });
}

function mapEventError(event: H3Event, error: unknown): MappedError {
	return mapAndLogError(error, { method: event.method, path: getRequestURL(event).pathname });
}

/**
 * `defineEventHandler` for routes that read (GET).
 *
 * On success the handler's value is the body. On failure the response is an h3
 * error: the real status, and a JSON body with `statusCode`, `statusMessage`,
 * `message` and, when the error carried a payload, `data`.
 */
export function defineApiHandler<T, Request extends EventHandlerRequest = EventHandlerRequest>(
	handler: (event: H3Event<Request>) => T | Promise<T>,
) {
	return defineEventHandler<Request, Promise<T>>(async (event) => {
		try {
			return await handler(event);
		} catch (error) {
			const mapped = mapEventError(event, error);
			throw httpError(mapped.status, mapped.message, mapped.payload);
		}
	});
}

/**
 * `defineEventHandler` for routes that write (POST, PUT, PATCH, DELETE).
 *
 * The body is always an `ActionResult`. The handler returns `ActionResult.ok(...)`;
 * to refuse the write it throws a typed error. On failure the response has the real
 * status and the body `{ Success: false, Message, ResponseObject }`, where
 * `ResponseObject` is the error's payload or `null`.
 */
export function defineActionHandler<T, Request extends EventHandlerRequest = EventHandlerRequest>(
	handler: (event: H3Event<Request>) => ActionSuccess<T> | Promise<ActionSuccess<T>>,
) {
	return defineEventHandler<Request, Promise<ActionResult<T>>>(async (event) => {
		try {
			const result: ActionResult<T> = await handler(event);
			// The types do not allow a handler to return a failure, but untyped code
			// can. A failure must never leave with a success status.
			if (!result.Success && getResponseStatus(event) < 400) setResponseStatus(event, 400);

			return result;
		} catch (error) {
			const mapped = mapEventError(event, error);
			setResponseStatus(event, mapped.status, STATUS_CODES[mapped.status]);

			return ActionResult.fail(mapped.message, mapped.payload);
		}
	});
}
