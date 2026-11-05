ALTER TABLE "contact" ADD COLUMN "first_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "last_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- No splitting: existing contacts keep their whole name as the first name until a LinkedIn re-import or an edit fills the last name.
UPDATE "contact" SET "first_name" = "name";
