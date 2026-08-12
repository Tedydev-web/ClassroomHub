CREATE TYPE "public"."EXAM_ATTEMPT_STATUS" AS ENUM('in_progress', 'submitted', 'expired');--> statement-breakpoint
CREATE TYPE "public"."EXAM_GRADING_STATE" AS ENUM('complete', 'awaiting_manual', 'unscoreable');--> statement-breakpoint
CREATE TYPE "public"."EXAM_MODE" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TYPE "public"."EXAM_REVEAL" AS ENUM('never', 'on_submit', 'after_everyone', 'above_threshold');--> statement-breakpoint
CREATE TYPE "public"."EXAM_STATUS" AS ENUM('draft', 'open', 'closed');--> statement-breakpoint
CREATE TABLE "exam" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"course_id" uuid,
	"exercise_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" varchar NOT NULL,
	"paper_snapshot" jsonb,
	"corrections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mode" "EXAM_MODE" DEFAULT 'private' NOT NULL,
	"status" "EXAM_STATUS" DEFAULT 'draft' NOT NULL,
	"working_seconds" integer,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"max_attempts" integer,
	"password_hash" text,
	"requires_name" boolean DEFAULT true NOT NULL,
	"requires_class" boolean DEFAULT false NOT NULL,
	"requires_candidate_number" boolean DEFAULT false NOT NULL,
	"score_visibility" "EXAM_REVEAL" DEFAULT 'never' NOT NULL,
	"answer_visibility" "EXAM_REVEAL" DEFAULT 'never' NOT NULL,
	"comment_visibility" "EXAM_REVEAL" DEFAULT 'never' NOT NULL,
	"reveal_threshold" numeric,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_slug_key" UNIQUE("slug"),
	CONSTRAINT "exam_reveal_threshold_required" CHECK (("exam"."score_visibility" <> 'above_threshold' AND "exam"."answer_visibility" <> 'above_threshold' AND "exam"."comment_visibility" <> 'above_threshold') OR "exam"."reveal_threshold" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "exam_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exam_id" uuid NOT NULL,
	"profile_id" uuid,
	"display_name" varchar,
	"class_name" varchar,
	"candidate_number" varchar,
	"token_hash" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"status" "EXAM_ATTEMPT_STATUS" DEFAULT 'in_progress' NOT NULL,
	"grading_state" "EXAM_GRADING_STATE" DEFAULT 'complete' NOT NULL,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"answer_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"manual_scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"score" numeric,
	"total" numeric,
	"ip_hash" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_attempt_exam_token_key" UNIQUE("exam_id","token_hash"),
	CONSTRAINT "exam_attempt_has_an_identity" CHECK ("exam_attempt"."profile_id" IS NOT NULL OR ("exam_attempt"."display_name" IS NOT NULL AND length(btrim("exam_attempt"."display_name")) > 0))
);
--> statement-breakpoint
ALTER TABLE "exam" ADD CONSTRAINT "exam_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam" ADD CONSTRAINT "exam_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam" ADD CONSTRAINT "exam_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercise"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam" ADD CONSTRAINT "exam_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_attempt" ADD CONSTRAINT "exam_attempt_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "public"."exam"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_attempt" ADD CONSTRAINT "exam_attempt_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_exam_course_id" ON "exam" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "idx_exam_exercise_id" ON "exam" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "idx_exam_attempt_exam_id" ON "exam_attempt" USING btree ("exam_id");--> statement-breakpoint
CREATE INDEX "idx_exam_attempt_exam_status" ON "exam_attempt" USING btree ("exam_id","status");