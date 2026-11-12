// How an app shows the layer's notifications. With Nuxt UI this would be
// `useToast().add({ title, description: message, color })`.
export default defineNuxtPlugin((nuxtApp) => {
	const notifications = usePlaygroundNotifications();
	nuxtApp.hook("layerbase:notify", (notification) => {
		notifications.value.push(notification);
	});
});
