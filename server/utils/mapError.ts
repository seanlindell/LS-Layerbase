import { ApiError } from "../../shared/utils/apiErrors";

/** What the caller is told about a failure. */
export interface MappedError {
	status: number;
	/** Safe to send to the caller. */
	message: string;
	/** Extra data for the caller, if the error carried any. */
	payload?: unknown;
	/**
	 * True when the operator should see the original error in the log: every
	 * unexpected error, and each typed error with a 5xx status.
	 */
	log: boolean;
}

/** The only message a caller sees for an unexpected error. */
export const INTERNAL_ERROR_MESSAGE = "The server could not complete the request. Try again later.";

function isErrorStatus(status: unknown): status is number {
	return typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599;
}

/**
 * True for an error made by h3's `createError` (or thrown by h3 itself, for example
 * for a body that is not JSON). h3 marks its error class with `__h3_error__`.
 *
 * A status code on some other error is not enough. A failed `$fetch` to an outside
 * service also has `statusCode`, and its message contains the outside URL.
 */
function isH3Error(error: unknown): error is Error & { statusCode: number; data?: unknown } {
	return (
		error instanceof Error &&
		(error.constructor as { __h3_error__?: unknown }).__h3_error__ === true &&
		"statusCode" in error
	);
}

/**
 * Maps any thrown value to the status and message for the caller. This is the one
 * place that decides it, for reads and writes alike.
 *
 * - A typed error (`ApiError` and its subclasses) keeps its status, message and payload.
 * - An h3 client error (4xx) passes through.
 * - Anything else becomes a 500 with a fixed message. The original message never
 *   reaches the caller, because it can contain SQL, paths or other internal details.
 */
export function mapError(error: unknown): MappedError {
	if (error instanceof ApiError && isErrorStatus(error.status)) {
		const mapped: MappedError = { status: error.status, message: error.message, log: error.status >= 500 };
		if (error.payload !== undefined) mapped.payload = error.payload;

		return mapped;
	}

	if (isH3Error(error) && isErrorStatus(error.statusCode) && error.statusCode < 500) {
		const mapped: MappedError = { status: error.statusCode, message: error.message, log: false };
		if (error.data !== undefined) mapped.payload = error.data;

		return mapped;
	}

	return { status: 500, message: INTERNAL_ERROR_MESSAGE, log: true };
}

/** Where a failure happened. The path has no query string, because a query can hold secrets. */
export interface ErrorLogContext {
	method: string;
	path: string;
}

/**
 * Maps the error and, when the operator should see it, writes the original error
 * (with its stack and cause) to the log together with the method and path.
 */
export function mapAndLogError(
	error: unknown,
	context: ErrorLogContext,
	log: (message: string, error: unknown) => void = console.error,
): MappedError {
	const mapped = mapError(error);
	if (mapped.log) {
		log(`[layerbase] ${context.method} ${context.path} failed with ${mapped.status}:`, error);
	}

	return mapped;
}
