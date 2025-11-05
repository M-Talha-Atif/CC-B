CREATE TABLE "admin_referral_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"assigned_to_user_id" uuid,
	"created_by_admin_id" uuid NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "admin_referral_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "referral_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referral_code" varchar(50) NOT NULL,
	"code_type" varchar(20) NOT NULL,
	"used_by_user_id" uuid NOT NULL,
	"code_owner_id" uuid,
	"admin_creator_id" uuid,
	"points_to_user" numeric(10, 2) DEFAULT '0.00',
	"points_to_code_owner" numeric(10, 2) DEFAULT '0.00',
	"points_to_admin" numeric(10, 2) DEFAULT '0.00',
	"referral_level" integer DEFAULT 1,
	"used_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "points_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"type" varchar(50) NOT NULL,
	"description" text,
	"referral_usage_id" uuid,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "referral_codes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "referral_codes" CASCADE;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_referral_code_unique";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "points" SET DATA TYPE numeric(10, 2);--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "points" SET DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "personal_referral_code" varchar(50);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "assigned_referral_code" varchar(50);--> statement-breakpoint
ALTER TABLE "admin_referral_codes" ADD CONSTRAINT "admin_referral_codes_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_referral_codes" ADD CONSTRAINT "admin_referral_codes_created_by_admin_id_users_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_usage" ADD CONSTRAINT "referral_usage_used_by_user_id_users_id_fk" FOREIGN KEY ("used_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_usage" ADD CONSTRAINT "referral_usage_code_owner_id_users_id_fk" FOREIGN KEY ("code_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_usage" ADD CONSTRAINT "referral_usage_admin_creator_id_users_id_fk" FOREIGN KEY ("admin_creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_transactions" ADD CONSTRAINT "points_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_transactions" ADD CONSTRAINT "points_transactions_referral_usage_id_referral_usage_id_fk" FOREIGN KEY ("referral_usage_id") REFERENCES "public"."referral_usage"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "referral_code";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_personal_referral_code_unique" UNIQUE("personal_referral_code");