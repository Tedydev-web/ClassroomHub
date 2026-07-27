CREATE TYPE "public"."EXAM_IMPORT_EXTRACTOR" AS ENUM('docx', 'pdf', 'aiken', 'gift');--> statement-breakpoint
CREATE TYPE "public"."EXAM_IMPORT_STATUS" AS ENUM('queued', 'running', 'draft_ready', 'failed', 'published', 'canceled');--> statement-breakpoint
CREATE TABLE "exam_import" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"actor_profile_id" uuid,
	"source_asset_id" uuid,
	"status" "EXAM_IMPORT_STATUS" DEFAULT 'queued' NOT NULL,
	"extractor" "EXAM_IMPORT_EXTRACTOR" NOT NULL,
	"section_count" integer DEFAULT 0 NOT NULL,
	"question_count" integer DEFAULT 0 NOT NULL,
	"review_required_count" integer DEFAULT 0 NOT NULL,
	"blocking_issue_count" integer DEFAULT 0 NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"failure" jsonb,
	"published_exercise_id" uuid,
	"started_at" timestamp with time zone,
	"draft_ready_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_import_section_count_nonnegative_check" CHECK ("exam_import"."section_count" >= 0),
	CONSTRAINT "exam_import_question_count_nonnegative_check" CHECK ("exam_import"."question_count" >= 0),
	CONSTRAINT "exam_import_review_required_count_nonnegative_check" CHECK ("exam_import"."review_required_count" >= 0),
	CONSTRAINT "exam_import_blocking_issue_count_nonnegative_check" CHECK ("exam_import"."blocking_issue_count" >= 0),
	CONSTRAINT "exam_import_warning_count_nonnegative_check" CHECK ("exam_import"."warning_count" >= 0),
	CONSTRAINT "exam_import_review_required_count_within_question_count_check" CHECK ("exam_import"."review_required_count" <= "exam_import"."question_count"),
	CONSTRAINT "exam_import_failure_status_check" CHECK (("exam_import"."status" = 'failed' AND "exam_import"."failure" IS NOT NULL) OR ("exam_import"."status" <> 'failed' AND "exam_import"."failure" IS NULL)),
	CONSTRAINT "exam_import_published_exercise_status_check" CHECK ("exam_import"."status" = 'published' OR "exam_import"."published_exercise_id" IS NULL),
	CONSTRAINT "exam_import_published_at_status_check" CHECK (("exam_import"."status" = 'published' AND "exam_import"."published_at" IS NOT NULL) OR ("exam_import"."status" <> 'published' AND "exam_import"."published_at" IS NULL)),
	CONSTRAINT "exam_import_draft_ready_at_status_check" CHECK (("exam_import"."status" IN ('draft_ready', 'published') AND "exam_import"."draft_ready_at" IS NOT NULL) OR ("exam_import"."status" NOT IN ('draft_ready', 'published') AND "exam_import"."draft_ready_at" IS NULL)),
	CONSTRAINT "exam_import_started_at_status_check" CHECK (("exam_import"."status" = 'queued' AND "exam_import"."started_at" IS NULL) OR ("exam_import"."status" IN ('running', 'draft_ready', 'failed', 'published') AND "exam_import"."started_at" IS NOT NULL) OR "exam_import"."status" = 'canceled')
);
--> statement-breakpoint
CREATE TABLE "exam_import_draft" (
	"import_id" uuid PRIMARY KEY NOT NULL,
	"draft" jsonb NOT NULL,
	"embedded_assets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"schema_version" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"cleanup_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_import_draft_schema_version_min_check" CHECK ("exam_import_draft"."schema_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "exam_import" ADD CONSTRAINT "exam_import_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "exam_import" ADD CONSTRAINT "exam_import_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "exam_import" ADD CONSTRAINT "exam_import_actor_profile_id_fkey" FOREIGN KEY ("actor_profile_id") REFERENCES "public"."profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_import" ADD CONSTRAINT "exam_import_source_asset_id_fkey" FOREIGN KEY ("source_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "exam_import" ADD CONSTRAINT "exam_import_published_exercise_id_fkey" FOREIGN KEY ("published_exercise_id") REFERENCES "public"."exercise"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_import_draft" ADD CONSTRAINT "exam_import_draft_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "public"."exam_import"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_exam_import_org_course_created" ON "exam_import" USING btree ("organization_id","course_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_exam_import_org_course_status" ON "exam_import" USING btree ("organization_id","course_id","status");--> statement-breakpoint
CREATE INDEX "idx_exam_import_source_asset" ON "exam_import" USING btree ("source_asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_import_published_exercise_unique" ON "exam_import" USING btree ("published_exercise_id") WHERE "exam_import"."published_exercise_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_exam_import_draft_expires_at" ON "exam_import_draft" USING btree ("expires_at");
