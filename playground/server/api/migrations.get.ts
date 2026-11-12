// Shows the layer's readiness state, for the tests and for a look by hand.
export default defineEventHandler(() => ({ status: migrationStatus(), migrated: isMigrated() }));
