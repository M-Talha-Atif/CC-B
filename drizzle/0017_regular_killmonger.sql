CREATE TABLE "creative_inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"creative_domain" varchar(50) NOT NULL,
	"selected_service" text NOT NULL,
	"proposal_count" integer NOT NULL,
	"total_amount" numeric(10, 2) NOT NULL,
	"location" text NOT NULL,
	"wedding_date" varchar(20) NOT NULL,
	"budget" varchar(50) NOT NULL,
	"guest_count" integer NOT NULL,
	"chat_messages" json NOT NULL,
	"stripe_session_id" varchar(255),
	"stripe_payment_intent_id" varchar(255),
	"payment_status" varchar(20) DEFAULT 'pending',
	"paid_at" timestamp,
	"status" varchar(20) DEFAULT 'draft',
	"processed_at" timestamp,
	"proposals_sent" integer DEFAULT 0,
	"proposals_matched" integer DEFAULT 0,
	"metadata" json DEFAULT '{}'::json,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "creative_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inquiry_id" uuid NOT NULL,
	"creative_user_id" uuid NOT NULL,
	"proposal_message" text,
	"proposal_amount" numeric(10, 2),
	"availability" json DEFAULT '{}'::json,
	"status" varchar(20) DEFAULT 'sent',
	"viewed_at" timestamp,
	"responded_at" timestamp,
	"last_contacted_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "creative_inquiries" ADD CONSTRAINT "creative_inquiries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_proposals" ADD CONSTRAINT "creative_proposals_inquiry_id_creative_inquiries_id_fk" FOREIGN KEY ("inquiry_id") REFERENCES "public"."creative_inquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_proposals" ADD CONSTRAINT "creative_proposals_creative_user_id_users_id_fk" FOREIGN KEY ("creative_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;