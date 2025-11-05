CREATE TABLE "onboarding_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"current_step" varchar(50) DEFAULT 'landing' NOT NULL,
	"completed_steps" json DEFAULT '[]'::json,
	"form_data" json DEFAULT '{}'::json,
	"email_password_completed" boolean DEFAULT false,
	"referral_code_completed" boolean DEFAULT false,
	"business_name_completed" boolean DEFAULT false,
	"website_completed" boolean DEFAULT false,
	"instagram_completed" boolean DEFAULT false,
	"creative_domain_completed" boolean DEFAULT false,
	"phone_number_completed" boolean DEFAULT false,
	"otp_verification_completed" boolean DEFAULT false,
	"onboarding_completed" boolean DEFAULT false,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "onboarding_progress_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "poll_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"option_index" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "post_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"type" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"categories" json NOT NULL,
	"type" varchar(20) DEFAULT 'text',
	"poll_options" json,
	"likes" integer DEFAULT 0,
	"saves" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "referral_code_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referral_code_id" uuid NOT NULL,
	"action" varchar(50) NOT NULL,
	"performed_by_user_id" uuid NOT NULL,
	"affected_user_id" uuid,
	"previous_state" json,
	"new_state" json,
	"points_affected" numeric(10, 2) DEFAULT '0.00',
	"reason" text,
	"metadata" json,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "sessions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "sessions" CASCADE;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_referral_codes" ADD COLUMN "assigned_at" timestamp;--> statement-breakpoint
ALTER TABLE "admin_referral_codes" ADD COLUMN "previous_assigned_to" uuid;--> statement-breakpoint
ALTER TABLE "admin_referral_codes" ADD COLUMN "max_usages" integer;--> statement-breakpoint
ALTER TABLE "admin_referral_codes" ADD COLUMN "current_usages" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "referral_usage" ADD COLUMN "status" varchar(20) DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "referral_usage" ADD COLUMN "updated_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "points_transactions" ADD COLUMN "performed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "points_transactions" ADD COLUMN "related_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "points_transactions" ADD COLUMN "previous_balance" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "points_transactions" ADD COLUMN "new_balance" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_interactions" ADD CONSTRAINT "post_interactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_interactions" ADD CONSTRAINT "post_interactions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_code_audit_log" ADD CONSTRAINT "referral_code_audit_log_referral_code_id_admin_referral_codes_id_fk" FOREIGN KEY ("referral_code_id") REFERENCES "public"."admin_referral_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_code_audit_log" ADD CONSTRAINT "referral_code_audit_log_performed_by_user_id_users_id_fk" FOREIGN KEY ("performed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_code_audit_log" ADD CONSTRAINT "referral_code_audit_log_affected_user_id_users_id_fk" FOREIGN KEY ("affected_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_referral_codes" ADD CONSTRAINT "admin_referral_codes_previous_assigned_to_users_id_fk" FOREIGN KEY ("previous_assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_transactions" ADD CONSTRAINT "points_transactions_performed_by_user_id_users_id_fk" FOREIGN KEY ("performed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_transactions" ADD CONSTRAINT "points_transactions_related_transaction_id_points_transactions_id_fk" FOREIGN KEY ("related_transaction_id") REFERENCES "public"."points_transactions"("id") ON DELETE no action ON UPDATE no action;