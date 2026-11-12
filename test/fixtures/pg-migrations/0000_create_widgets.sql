CREATE TABLE "widgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN RAISE NOTICE 'widgets table created'; END $$;
