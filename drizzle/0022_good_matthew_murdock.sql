CREATE TABLE "post_rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"hour_key" varchar(50) NOT NULL,
	"post_count" integer DEFAULT 0 NOT NULL,
	"hour_start_time" timestamp NOT NULL,
	"hour_end_time" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "post_rate_limits" ADD CONSTRAINT "post_rate_limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_user_hour" ON "post_rate_limits" USING btree ("user_id","hour_key");--> statement-breakpoint
CREATE INDEX "hour_end_time_idx" ON "post_rate_limits" USING btree ("hour_end_time");