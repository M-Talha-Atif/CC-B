ALTER TABLE "posts" ADD COLUMN "threshold_met_at" timestamp;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "threshold_met" boolean DEFAULT false;