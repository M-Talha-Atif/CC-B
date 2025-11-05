ALTER TABLE "points_transactions" DROP CONSTRAINT "points_transactions_referral_usage_id_referral_usage_id_fk";
--> statement-breakpoint
ALTER TABLE "points_transactions" DROP CONSTRAINT "points_transactions_performed_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "points_transactions" DROP CONSTRAINT "points_transactions_related_transaction_id_points_transactions_id_fk";
--> statement-breakpoint
ALTER TABLE "referral_usage" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "referral_usage" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "points_transactions" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "points_transactions" DROP COLUMN "referral_usage_id";--> statement-breakpoint
ALTER TABLE "points_transactions" DROP COLUMN "performed_by_user_id";--> statement-breakpoint
ALTER TABLE "points_transactions" DROP COLUMN "related_transaction_id";