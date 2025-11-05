ALTER TABLE "posts" ADD COLUMN "is_quote_post" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "quoted_post_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "quoted_post_snapshot" json;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_quoted_post_id_posts_id_fk" FOREIGN KEY ("quoted_post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;