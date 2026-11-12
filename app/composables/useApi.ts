import type { FetchOptions } from "ofetch";
import { createApiRunner } from "../utils/apiClient";
import type { ApiFetcher, ApiNotification } from "../utils/apiClient";

declare module "#app" {
	interface RuntimeNuxtHooks {
		/**
		 * Called when `useApi()` has something to tell the user. The layer shows
		 * nothing itself; an app listens here and shows a toast with its own UI.
		 */
		"layerbase:notify": (notification: ApiNotification) => void;
	}
}

/** The options of `$fetch`, without the types that Nitro derives from the app's routes. */
type ApiFetchOptions = FetchOptions<"json">;

/**
 * Client-side calls to routes that follow the API error contract.
 *
 *     const { run, notifySuccess } = useApi();
 *     const result = await run<Note>("/api/notes", { method: "POST", body: { title } });
 *     if (result.Success) notifySuccess(result.Message);
 *
 * `run` does not throw. On failure it calls the `layerbase:notify` hook and
 * resolves to `{ Success: false, Message, ResponseObject, Status }`.
 */
export function useApi() {
	const nuxtApp = useNuxtApp();

	// Nitro types `$fetch` by the routes of the app, which `run` does not use: the
	// caller names the result type. In an app with more than a few routes, that
	// typing also fails here with "excessive stack depth".
	const fetcher = $fetch as unknown as ApiFetcher<ApiFetchOptions>;

	return createApiRunner<ApiFetchOptions>(fetcher, (notification) => {
		void nuxtApp.callHook("layerbase:notify", notification);
	});
}
