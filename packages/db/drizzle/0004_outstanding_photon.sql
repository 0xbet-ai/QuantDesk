CREATE TABLE "desk_datasets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"desk_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "desk_datasets" ADD CONSTRAINT "desk_datasets_desk_id_desks_id_fk" FOREIGN KEY ("desk_id") REFERENCES "public"."desks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_datasets" ADD CONSTRAINT "desk_datasets_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Preserve existing dataset ownership by copying rows into the join table
-- before we drop the old deskId column.
INSERT INTO "desk_datasets" ("desk_id", "dataset_id", "created_at")
SELECT "desk_id", "id", "created_at" FROM "datasets" WHERE "desk_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "datasets" DROP CONSTRAINT "datasets_desk_id_desks_id_fk";
--> statement-breakpoint
ALTER TABLE "datasets" DROP COLUMN "desk_id";