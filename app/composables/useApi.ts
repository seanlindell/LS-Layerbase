import { createApiRunner } from "../utils/apiClient";
import type { ApiNotification } from "../utils/apiClient";

declare module "#app" {
	interface RuntimeNuxtHooks {
		/**
		 * Called when `useApi()` has something to tell the user. The layer shows
		 * nothing itself; an app listens here and shows a toast with its own UI.
		 */
		"layerbase:notify": (notification: ApiNotification) => void;
	}
}

type FetchOptions = NonNullable<Parameters<typeof $fetch>[1]>;

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

	return createApiRunner<FetchOptions>(
		(request, options) => $fetch(request, options),
		(notification) => {
			void nuxtApp.callHook("layerbase:notify", notification);
		},
	);
}
