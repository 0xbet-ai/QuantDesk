CREATE TABLE "paper_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"desk_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"experiment_id" uuid NOT NULL,
	"engine" text NOT NULL,
	"container_id" text,
	"container_name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"api_port" integer,
	"meta" jsonb,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone,
	"last_status_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "paper_sessions" ADD CONSTRAINT "paper_sessions_desk_id_desks_id_fk" FOREIGN KEY ("desk_id") REFERENCES "public"."desks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_sessions" ADD CONSTRAINT "paper_sessions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_sessions" ADD CONSTRAINT "paper_sessions_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE no action ON UPDATE no action;