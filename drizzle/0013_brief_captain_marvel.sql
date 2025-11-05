ALTER TABLE "posts" ADD COLUMN "opened_by" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "opened_by_username" varchar(100);--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;