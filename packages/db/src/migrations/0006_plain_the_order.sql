CREATE TYPE "public"."SCORM_ATTEMPT_STATUS" AS ENUM('active', 'terminated', 'abandoned', 'error');--> statement-breakpoint
CREATE TYPE "public"."SCORM_COMPLETION_STATUS" AS ENUM('unknown', 'not_attempted', 'incomplete', 'completed');--> statement-breakpoint
CREATE TYPE "public"."SCORM_PACKAGE_STATUS" AS ENUM('uploaded', 'parsed', 'failed', 'ready', 'archived');--> statement-breakpoint
CREATE TYPE "public"."SCORM_REGISTRATION_STATUS" AS ENUM('not_started', 'in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."SCORM_SUCCESS_STATUS" AS ENUM('unknown', 'passed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."SCORM_VERSION" AS ENUM('1.2', '2004', 'unknown');--> statement-breakpoint
CREATE TABLE "scorm_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" "SCORM_ATTEMPT_STATUS" DEFAULT 'active' NOT NULL,
	"initialized_at" timestamp with time zone,
	"terminated_at" timestamp with time zone,
	"last_committed_at" timestamp with time zone,
	"session_time_seconds" integer DEFAULT 0 NOT NULL,
	"runtime_snapshot_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scorm_attempt_registration_number_unique" UNIQUE("registration_id","attempt_number")
);
--> statement-breakpoint
CREATE TABLE "scorm_package" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_by_profile_id" uuid,
	"source_asset_id" uuid,
	"title" text NOT NULL,
	"version" "SCORM_VERSION" DEFAULT 'unknown' NOT NULL,
	"manifest_identifier" text,
	"entrypoint" text,
	"status" "SCORM_PACKAGE_STATUS" DEFAULT 'uploaded' NOT NULL,
	"manifest_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scorm_package_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"parent_item_id" uuid,
	"title" text NOT NULL,
	"identifier" text NOT NULL,
	"resource_identifier" text,
	"launch_href" text,
	"order" integer DEFAULT 0 NOT NULL,
	"is_launchable" boolean DEFAULT false NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "scorm_package_item_package_identifier_unique" UNIQUE("package_id","identifier")
);
--> statement-breakpoint
CREATE TABLE "scorm_registration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"package_item_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"group_member_id" uuid,
	"status" "SCORM_REGISTRATION_STATUS" DEFAULT 'not_started' NOT NULL,
	"completion_status" "SCORM_COMPLETION_STATUS" DEFAULT 'unknown' NOT NULL,
	"success_status" "SCORM_SUCCESS_STATUS" DEFAULT 'unknown' NOT NULL,
	"score_raw" double precision,
	"score_scaled" double precision,
	"total_time_seconds" integer DEFAULT 0 NOT NULL,
	"last_location" text,
	"suspend_data" text,
	"last_error_code" text,
	"last_launched_at" timestamp with time zone,
	"last_committed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"passed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scorm_registration_lesson_profile_unique" UNIQUE("lesson_id","profile_id")
);
--> statement-breakpoint
CREATE TABLE "scorm_runtime_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"element" text,
	"value_preview" text,
	"error_code" text,
	"meta_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scorm_attempt" ADD CONSTRAINT "scorm_attempt_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "public"."scorm_registration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_package" ADD CONSTRAINT "scorm_package_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_package" ADD CONSTRAINT "scorm_package_created_by_profile_id_fkey" FOREIGN KEY ("created_by_profile_id") REFERENCES "public"."profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_package" ADD CONSTRAINT "scorm_package_source_asset_id_fkey" FOREIGN KEY ("source_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_package_item" ADD CONSTRAINT "scorm_package_item_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."scorm_package"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_package_item" ADD CONSTRAINT "scorm_package_item_parent_item_id_fkey" FOREIGN KEY ("parent_item_id") REFERENCES "public"."scorm_package_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_registration" ADD CONSTRAINT "scorm_registration_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."scorm_package"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_registration" ADD CONSTRAINT "scorm_registration_package_item_id_fkey" FOREIGN KEY ("package_item_id") REFERENCES "public"."scorm_package_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_registration" ADD CONSTRAINT "scorm_registration_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_registration" ADD CONSTRAINT "scorm_registration_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "public"."lesson"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_registration" ADD CONSTRAINT "scorm_registration_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_registration" ADD CONSTRAINT "scorm_registration_group_member_id_fkey" FOREIGN KEY ("group_member_id") REFERENCES "public"."groupmember"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_runtime_event" ADD CONSTRAINT "scorm_runtime_event_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "public"."scorm_attempt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_scorm_attempt_registration_status" ON "scorm_attempt" USING btree ("registration_id","status");--> statement-breakpoint
CREATE INDEX "idx_scorm_package_organization_status" ON "scorm_package" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "idx_scorm_package_created_at" ON "scorm_package" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_scorm_package_item_package_order" ON "scorm_package_item" USING btree ("package_id","order");--> statement-breakpoint
CREATE INDEX "idx_scorm_registration_package" ON "scorm_registration" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "idx_scorm_registration_course_status" ON "scorm_registration" USING btree ("course_id","status");--> statement-breakpoint
CREATE INDEX "idx_scorm_runtime_event_attempt_created_at" ON "scorm_runtime_event" USING btree ("attempt_id","created_at");