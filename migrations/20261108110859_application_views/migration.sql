CREATE TABLE "application_view" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"layout" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "application_view_user_name_unique_idx" ON "application_view" ("user_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "application_view_user_default_unique_idx" ON "application_view" ("user_id") WHERE "is_default";--> statement-breakpoint
ALTER TABLE "application_view" ADD CONSTRAINT "application_view_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;