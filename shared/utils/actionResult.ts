/**
 * The body of every write (action) response.
 *
 * `Success` tells the two cases apart, so a caller that has the body can branch on
 * it alone. The HTTP status says the same thing: a success is 2xx, a failure is 4xx
 * or 5xx. A failure is never sent with status 200.
 */
export type ActionResult<T = null> = ActionSuccess<T> | ActionFailure;

export interface ActionSuccess<T = null> {
	Success: true;
	/** A short sentence for the user, for example "Note created." */
	Message: string;
	ResponseObject: T;
}

export interface ActionFailure {
	Success: false;
	/** Why the write was refused, written for the caller. */
	Message: string;
	/**
	 * Extra data about the refusal, or `null`. For example the record that already
	 * exists, on a 409. Its type is not known to the caller, so check it before use.
	 */
	ResponseObject: unknown;
}

function ok(message: string): ActionSuccess<null>;
function ok<T>(message: string, responseObject: T): ActionSuccess<T>;
function ok<T>(message: string, responseObject?: T): ActionSuccess<T | null> {
	return { Success: true, Message: message, ResponseObject: responseObject ?? null };
}

function fail(message: string, payload: unknown = null): ActionFailure {
	return { Success: false, Message: message, ResponseObject: payload ?? null };
}

/**
 * Constructors for the two results: `ActionResult.ok("Note created.", note)` and
 * `ActionResult.fail("That title is taken.", existingNote)`.
 *
 * A handler normally only calls `ok`. To refuse a write it throws a typed error,
 * and `defineActionHandler` builds the failure with the right status.
 */
export const ActionResult = { ok, fail };
