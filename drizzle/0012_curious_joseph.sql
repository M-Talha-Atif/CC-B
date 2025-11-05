ALTER TABLE "users" ADD COLUMN "is_anonymous" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "encrypted_data" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "anonymous_id" varchar(100);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "anonymous_activated_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "original_data_backup" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_anonymous_id_unique" UNIQUE("anonymous_id");