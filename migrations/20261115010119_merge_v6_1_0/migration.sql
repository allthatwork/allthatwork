CREATE INDEX "application_company_id_index" ON "application" ("company_id");--> statement-breakpoint
CREATE INDEX "career_fact_override_user_id_index" ON "career_fact_override" ("user_id");--> statement-breakpoint
CREATE INDEX "career_fact_override_fact_id_index" ON "career_fact_override" ("fact_id");--> statement-breakpoint
CREATE INDEX "career_opportunity_company_id_index" ON "career_opportunity" ("company_id");--> statement-breakpoint
CREATE INDEX "username_redirect_user_id_index" ON "username_redirect" ("user_id");--> statement-breakpoint
CREATE INDEX "contact_company_id_index" ON "contact" ("company_id");--> statement-breakpoint
CREATE INDEX "contact_employment_contact_id_index" ON "contact_employment" ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_employment_company_id_index" ON "contact_employment" ("company_id");--> statement-breakpoint
CREATE INDEX "contact_note_contact_id_index" ON "contact_note" ("contact_id");--> statement-breakpoint
CREATE INDEX "company_board_company_id_index" ON "company_board" ("company_id");