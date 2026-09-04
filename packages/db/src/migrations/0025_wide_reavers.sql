CREATE TYPE "public"."INVITE_LINK_RESOURCE_TYPE" AS ENUM('COURSE', 'COHORT');--> statement-breakpoint
CREATE TYPE "public"."LESSON_VERSION_KIND" AS ENUM('auto', 'manual', 'publish');--> statement-breakpoint
CREATE TABLE "invite_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"resource_type" "INVITE_LINK_RESOURCE_TYPE" NOT NULL,
	"course_id" uuid,
	"cohort_id" uuid,
	"role_id" bigint NOT NULL,
	"token" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by_profile_id" uuid NOT NULL,
	"revoked_by_profile_id" uuid,
	"revoked_at" timestamp with time zone,
	"is_revoked" boolean DEFAULT false NOT NULL,
	"join_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
	CONSTRAINT "invite_link_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "invite_link_course_id_role_id_unique" UNIQUE("course_id","role_id"),
	CONSTRAINT "invite_link_cohort_id_role_id_unique" UNIQUE("cohort_id","role_id"),
	CONSTRAINT "invite_link_resource_target_check" CHECK ((
        ("invite_link"."resource_type" = 'COURSE' AND "invite_link"."course_id" IS NOT NULL AND "invite_link"."cohort_id" IS NULL)
        OR ("invite_link"."resource_type" = 'COHORT' AND "invite_link"."cohort_id" IS NOT NULL AND "invite_link"."course_id" IS NULL)
      ))
);
--> statement-breakpoint
DROP VIEW "public"."lesson_versions";--> statement-breakpoint
ALTER TABLE "lesson" ADD COLUMN "comments_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_language_history" ADD COLUMN "kind" "LESSON_VERSION_KIND" DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_language_history" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "lesson_language_history" ADD COLUMN "author_id" uuid;--> statement-breakpoint
ALTER TABLE "lesson_language_history" ADD COLUMN "session_started_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_language_history" ADD COLUMN "edit_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_language_history" ADD COLUMN "is_sealed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "welcome_email_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "welcome_email_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invite_link" ADD CONSTRAINT "invite_link_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_link" ADD CONSTRAINT "invite_link_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_link" ADD CONSTRAINT "invite_link_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "public"."cohort"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_link" ADD CONSTRAINT "invite_link_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_invite_link_organization_id" ON "invite_link" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "lesson_language_history" ADD CONSTRAINT "lesson_language_history_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profile"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "lesson_language_history_language_timestamp_idx" ON "lesson_language_history" USING btree ("lesson_language_id","timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_submission_submitted_by_exercise_id" ON "submission" USING btree ("submitted_by","exercise_id");--> statement-breakpoint
ALTER TABLE "lesson_language_history" DROP COLUMN "old_content";--> statement-breakpoint
CREATE VIEW "public"."lesson_versions" AS (SELECT llh.id, lag(llh.new_content) OVER (PARTITION BY llh.lesson_language_id ORDER BY llh."timestamp", llh.id) AS old_content, llh.new_content, llh.kind, llh.label, llh.session_started_at, llh."timestamp", llh.edit_count, llh.is_sealed, llh.author_id, p.fullname AS author_name, p.avatar_url AS author_avatar_url, ll.locale, ll.lesson_id FROM lesson_language_history llh JOIN lesson_language ll ON ll.id = llh.lesson_language_id LEFT JOIN profile p ON p.id = llh.author_id);