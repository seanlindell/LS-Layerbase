import type { ApiNotification } from "../../../app/utils/apiClient";

/** The notifications that `useApi()` has sent, newest last. */
export const usePlaygroundNotifications = () =>
	useState<ApiNotification[]>("playground-notifications", () => []);
