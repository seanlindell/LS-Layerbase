/**
 * Errors that are meant for the caller of an API route.
 *
 * Services and handlers throw these. `defineApiHandler` and `defineActionHandler`
 * send the status and the message as they are, so write the message for the caller:
 * say what was wrong and, if possible, what to do. Do not put internal details
 * (SQL, file paths, stack text) in it.
 *
 * Any other thrown value is treated as a bug: the caller gets a generic 500 and
 * the real error is logged.
 */
export class ApiError extends Error {
	/** The HTTP status to answer with, from 400 to 599. */
	readonly status: number;
	/** Optional data for the caller, for example the record that already exists. */
	readonly payload?: unknown;

	constructor(status: number, message: string, payload?: unknown, options?: ErrorOptions) {
		super(message, options);
		this.name = new.target.name;
		this.status = status;
		this.payload = payload;
	}
}

/** 400: the request was understood, but its content is not acceptable. */
export class ValidationError extends ApiError {
	constructor(message: string, payload?: unknown, options?: ErrorOptions) {
		super(400, message, payload, options);
	}
}

/** 401: the caller did not say who it is, or its credential is not valid. */
export class UnauthorizedError extends ApiError {
	constructor(message: string, payload?: unknown, options?: ErrorOptions) {
		super(401, message, payload, options);
	}
}

/** 403: the caller is known, but may not do this. */
export class ForbiddenError extends ApiError {
	constructor(message: string, payload?: unknown, options?: ErrorOptions) {
		super(403, message, payload, options);
	}
}

/** 404: the thing that the request names does not exist. */
export class NotFoundError extends ApiError {
	constructor(message: string, payload?: unknown, options?: ErrorOptions) {
		super(404, message, payload, options);
	}
}

/**
 * 409: the request conflicts with the current state, for example a duplicate.
 * The payload can carry the existing record, so the caller does not need a second
 * request to show it.
 */
export class ConflictError extends ApiError {
	constructor(message: string, payload?: unknown, options?: ErrorOptions) {
		super(409, message, payload, options);
	}
}

/** 502: a service outside this app failed or gave an answer that cannot be used. */
export class UpstreamError extends ApiError {
	constructor(message: string, payload?: unknown, options?: ErrorOptions) {
		super(502, message, payload, options);
	}
}

/** 503: something this app depends on is down or busy. Trying again later can work. */
export class UnavailableError extends ApiError {
	constructor(message: string, payload?: unknown, options?: ErrorOptions) {
		super(503, message, payload, options);
	}
}
