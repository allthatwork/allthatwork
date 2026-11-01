ALTER TABLE "application" ADD COLUMN "found_by" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "search_fit" smallint;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "search_notes" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "search_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "targeting_notes" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "targeting_fit" smallint;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "targeting_reviews" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "targeting_primary_lane" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "targeting_secondary_lane" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "targeting_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "targeting_questions" jsonb DEFAULT '[]' NOT NULL;