CREATE TABLE "company_board" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"company_id" text NOT NULL,
	"board_id" text NOT NULL,
	"source" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_board" (
	"id" text PRIMARY KEY,
	"ats" text NOT NULL,
	"slug" text NOT NULL,
	"host" text NOT NULL,
	"name" text,
	"website" text,
	"checked_at" timestamp with time zone,
	"fetched_at" timestamp with time zone,
	"error" text,
	"job_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_board_posting" (
	"id" text PRIMARY KEY,
	"board_id" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"remote" boolean DEFAULT false NOT NULL,
	"workplace" text,
	"url" text NOT NULL,
	"pay" jsonb DEFAULT '[]' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"detail_fetched_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "career_opportunity" ADD COLUMN "source" text DEFAULT 'search' NOT NULL;--> statement-breakpoint
ALTER TABLE "career_opportunity" ADD COLUMN "company_id" text;--> statement-breakpoint
ALTER TABLE "career_opportunity" ADD COLUMN "posting_id" text;--> statement-breakpoint
ALTER TABLE "career_opportunity" ADD COLUMN "pay" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "career_opportunity" ADD COLUMN "remote" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "career_opportunity" ADD COLUMN "posted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "career_opportunity" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "career_opportunity_posting_id_index" ON "career_opportunity" ("posting_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_board_user_id_company_id_board_id_index" ON "company_board" ("user_id","company_id","board_id");--> statement-breakpoint
CREATE INDEX "company_board_board_id_index" ON "company_board" ("board_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_board_ats_host_slug_index" ON "job_board" ("ats","host","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "job_board_posting_board_id_external_id_index" ON "job_board_posting" ("board_id","external_id");--> statement-breakpoint
CREATE INDEX "job_board_posting_board_id_closed_at_index" ON "job_board_posting" ("board_id","closed_at");--> statement-breakpoint
ALTER TABLE "career_opportunity" ADD CONSTRAINT "career_opportunity_company_id_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "career_opportunity" ADD CONSTRAINT "career_opportunity_posting_id_job_board_posting_id_fkey" FOREIGN KEY ("posting_id") REFERENCES "job_board_posting"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "company_board" ADD CONSTRAINT "company_board_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "company_board" ADD CONSTRAINT "company_board_company_id_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "company_board" ADD CONSTRAINT "company_board_board_id_job_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "job_board"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "job_board_posting" ADD CONSTRAINT "job_board_posting_board_id_job_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "job_board"("id") ON DELETE CASCADE;