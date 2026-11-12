import type { ActionFailure, ActionSuccess } from "../../shared/utils/actionResult";

/**
 * A failed request, in the shape of an `ActionResult`. `useApi().run()` builds it
 * from whatever the server sent, so a caller branches on `Success` only.
 */
export interface ApiFailure extends ActionFailure {
	/** The HTTP status, or `null` when no response arrived (for example the network is down). */
	Status: number | null;
}

/** What `useApi().run()` resolves to. It does not throw. */
export type ApiResult<T = null> = ActionSuccess<T> | ApiFailure;

/** Shown when no response arrived at all. */
export const NETWORK_ERROR_MESSAGE = "The server could not be reached. Check the connection and try again.";
/** Shown when something other than the request failed, for example code in the caller. */
export const UNKNOWN_ERROR_MESSAGE = "Something went wrong. Try again.";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

/** The HTTP status of a thrown fetch error (ofetch `FetchError`) or Nuxt error, if it has one. */
export function fetchErrorStatus(error: unknown): number | undefined {
	if (!isRecord(error)) return undefined;

	const response = isRecord(error.response) ? error.response.status : undefined;
	for (const status of [error.status, error.statusCode, response]) {
		if (typeof status === "number" && status >= 100) return status;
	}

	return undefined;
}

/** True for an error that `$fetch` threw, with or without a response. */
function isFetchError(error: unknown): error is Record<string, unknown> {
	return isRecord(error) && (error.name === "FetchError" || "response" in error || "request" in error);
}

/**
 * Turns anything that a request threw into an `ApiFailure`.
 *
 * - Body is an `ActionResult` (a refused write): its `Message` and `ResponseObject`.
 * - Body is an h3 error (a read error, or a refusal from a middleware): its
 *   `message`, and its `data` as the `ResponseObject`.
 * - A response without a usable body: a message with the status.
 * - No response: a fixed message about the connection.
 */
export function toApiFailure(error: unknown): ApiFailure {
	const status = fetchErrorStatus(error) ?? null;
	const body = isRecord(error) ? error.data : undefined;

	if (isRecord(body)) {
		const actionMessage = body.Success === false ? nonEmptyString(body.Message) : undefined;
		if (actionMessage) {
			return {
				Success: false,
				Message: actionMessage,
				ResponseObject: body.ResponseObject ?? null,
				Status: status,
			};
		}

		const h3Message = nonEmptyString(body.message);
		if (h3Message) {
			return { Success: false, Message: h3Message, ResponseObject: body.data ?? null, Status: status };
		}
	}

	if (status !== null) {
		return {
			Success: false,
			Message: `The request failed with status ${status}.`,
			ResponseObject: null,
			Status: status,
		};
	}

	const message = isFetchError(error) ? NETWORK_ERROR_MESSAGE : UNKNOWN_ERROR_MESSAGE;

	return { Success: false, Message: message, ResponseObject: null, Status: null };
}

/** The message for a person, for anything that a request threw. */
export function fetchErrorMessage(error: unknown): string {
	return toApiFailure(error).Message;
}

/** A message for the app to show, for example as a toast. */
export interface ApiNotification {
	kind: "error" | "success";
	title: string;
	/** More detail. For an error this is the message from the server. */
	message?: string;
}

/** Options of `run()` that are not passed on to `$fetch`. */
export interface ApiRunOwnOptions {
	/** Set to true when the request starts and to false when it ends, also on failure. */
	pending?: { value: boolean };
	/** The title of the error notification. */
	errorTitle?: string;
	/** Send no notification on failure. The caller shows the failure itself. */
	silent?: boolean;
}

/** The parts of `$fetch` that the runner needs. */
export type ApiFetcher<Options> = (request: string, options?: Options) => Promise<unknown>;

export const DEFAULT_ERROR_TITLE = "Something went wrong";

/**
 * Builds `run`, `errorMessage` and the notify functions on top of a fetch function
 * and a notification sink. `useApi()` wires this to `$fetch` and to a Nuxt hook;
 * tests pass their own.
 */
export function createApiRunner<Options extends object>(
	fetcher: ApiFetcher<Options>,
	notify: (notification: ApiNotification) => void,
) {
	function notifyError(error: unknown, title = DEFAULT_ERROR_TITLE) {
		notify({ kind: "error", title, message: fetchErrorMessage(error) });
	}

	function notifySuccess(title: string, message?: string) {
		notify({ kind: "success", title, message });
	}

	/**
	 * Sends a request to a route that answers with an `ActionResult`, and never
	 * throws. On failure it sends an error notification (unless `silent`) and
	 * resolves to an `ApiFailure`.
	 */
	async function run<T = null>(request: string, options?: Options & ApiRunOwnOptions): Promise<ApiResult<T>> {
		const { pending, errorTitle, silent, ...fetchOptions } = options ?? ({} as Options & ApiRunOwnOptions);

		let result: ApiResult<T>;
		if (pending) pending.value = true;
		try {
			const body = await fetcher(request, fetchOptions as Options);
			if (isRecord(body) && body.Success === true) {
				result = body as unknown as ActionSuccess<T>;
			} else if (isRecord(body) && body.Success === false) {
				// A server that still answers 200 with `Success: false`.
				result = toApiFailure({ data: body, status: 200 });
			} else {
				result = {
					Success: false,
					Message: "The server sent an answer that could not be read.",
					ResponseObject: null,
					Status: null,
				};
			}
		} catch (error) {
			result = toApiFailure(error);
		} finally {
			if (pending) pending.value = false;
		}

		if (!result.Success && !silent) {
			notify({ kind: "error", title: errorTitle ?? DEFAULT_ERROR_TITLE, message: result.Message });
		}

		return result;
	}

	return { run, errorMessage: fetchErrorMessage, errorStatus: fetchErrorStatus, notifyError, notifySuccess };
}
