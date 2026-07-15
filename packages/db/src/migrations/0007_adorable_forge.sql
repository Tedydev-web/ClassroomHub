CREATE TABLE "scorm_lesson_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"package_item_id" uuid NOT NULL,
	"created_by_profile_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scorm_lesson_content_lesson_unique" UNIQUE("lesson_id")
);
--> statement-breakpoint
ALTER TABLE "scorm_lesson_content" ADD CONSTRAINT "scorm_lesson_content_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_lesson_content" ADD CONSTRAINT "scorm_lesson_content_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_lesson_content" ADD CONSTRAINT "scorm_lesson_content_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "public"."lesson"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_lesson_content" ADD CONSTRAINT "scorm_lesson_content_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."scorm_package"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_lesson_content" ADD CONSTRAINT "scorm_lesson_content_package_item_id_fkey" FOREIGN KEY ("package_item_id") REFERENCES "public"."scorm_package_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_lesson_content" ADD CONSTRAINT "scorm_lesson_content_created_by_profile_id_fkey" FOREIGN KEY ("created_by_profile_id") REFERENCES "public"."profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_scorm_lesson_content_organization" ON "scorm_lesson_content" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_scorm_lesson_content_package" ON "scorm_lesson_content" USING btree ("package_id");