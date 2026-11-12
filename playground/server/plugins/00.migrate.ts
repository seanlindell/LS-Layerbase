// Applies the playground's migrations when the server starts.
export default defineMigrationPlugin(() => ({ migrate: sqliteMigrator(useDb()) }));
