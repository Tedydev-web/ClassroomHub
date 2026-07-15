CREATE TYPE "public"."NOTIFICATION_TYPE" AS ENUM('EXERCISE_DUE_REMINDER', 'LIVE_CLASS_REMINDER', 'NEWSFEED_POST', 'NEWSFEED_COMMENT', 'COMMUNITY_QUESTION', 'COMMUNITY_ANSWER', 'COURSE_COMPLETED', 'CERTIFICATE_EARNED', 'SUBMISSION_GRADED', 'COURSE_INVITE', 'ORGANIZATION_INVITE');--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"course_id" uuid,
	"type" "NOTIFICATION_TYPE" NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_notification_profile_org_created" ON "notification" USING btree ("profile_id","organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_notification_profile_org_unread" ON "notification" USING btree ("profile_id","organization_id","is_read");