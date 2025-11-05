CREATE TABLE "chatroom_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"chatroom_username" varchar(100) NOT NULL,
	"color" varchar(50) NOT NULL,
	"word" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "chatroom_username" varchar(100);--> statement-breakpoint
ALTER TABLE "chatroom_identities" ADD CONSTRAINT "chatroom_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatroom_identities" ADD CONSTRAINT "chatroom_identities_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;