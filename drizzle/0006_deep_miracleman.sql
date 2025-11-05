ALTER TABLE "posts" ADD COLUMN "comments_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "comments_enabled_at" timestamp;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "comments_disabled_at" timestamp;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "eligible_for_deletion" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "cron_processed" boolean DEFAULT false;