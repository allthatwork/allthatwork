-- The fork's username_redirect kept an old username working in public links for 30 days. Upstream's released_username
-- does the same job (and stops another account from claiming the name meanwhile), so the live redirects move there and
-- the fork's table goes. A redirect lasted 30 days from the change, so its change time is expires_at minus 30 days.
-- Names someone now holds stay out: a reserved name must not point at two accounts.
INSERT INTO "released_username" ("username", "user_id", "released_at")
SELECT "r"."username", "r"."user_id", "r"."expires_at" - interval '30 days'
FROM "username_redirect" AS "r"
WHERE "r"."expires_at" > now()
	AND NOT EXISTS (SELECT 1 FROM "user" AS "u" WHERE lower("u"."username") = lower("r"."username"))
ON CONFLICT ("username") DO UPDATE SET "user_id" = EXCLUDED."user_id", "released_at" = EXCLUDED."released_at"
	WHERE "released_username"."released_at" < EXCLUDED."released_at";
--> statement-breakpoint
DROP TABLE "username_redirect";
