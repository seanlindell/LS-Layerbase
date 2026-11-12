// Applies the playground's migrations when the server starts.
export default defineMigrationPlugin(() => {
	const migrate = sqliteMigrator(useDb());
	const delay = Number(useRuntimeConfig().slowMigrationMs);
	if (!delay) return { migrate };

	// For the tests: acts like a slow, asynchronous migration, so that requests
	// arrive before the schema is ready.
	return {
		migrate: async (context) => {
			await new Promise((resolve) => setTimeout(resolve, delay));
			await migrate(context);
		},
	};
});
