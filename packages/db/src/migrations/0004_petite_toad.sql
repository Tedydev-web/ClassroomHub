CREATE TYPE "public"."EXERCISE_ASSIGNMENT_MODE" AS ENUM('ALL_STUDENTS', 'SELECTED_STUDENTS');--> statement-breakpoint
CREATE TABLE "exercise_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exercise_id" uuid NOT NULL,
	"group_member_id" uuid NOT NULL,
	"assigned_by_profile_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_assignment_exercise_group_member_unique" UNIQUE("exercise_id","group_member_id")
);
--> statement-breakpoint
ALTER TABLE "exercise" ADD COLUMN "assignment_mode" "EXERCISE_ASSIGNMENT_MODE" DEFAULT 'ALL_STUDENTS' NOT NULL;--> statement-breakpoint
ALTER TABLE "exercise_assignment" ADD CONSTRAINT "exercise_assignment_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercise"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_assignment" ADD CONSTRAINT "exercise_assignment_group_member_id_fkey" FOREIGN KEY ("group_member_id") REFERENCES "public"."groupmember"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_assignment" ADD CONSTRAINT "exercise_assignment_assigned_by_profile_id_fkey" FOREIGN KEY ("assigned_by_profile_id") REFERENCES "public"."profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_exercise_assignment_exercise_id" ON "exercise_assignment" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "idx_exercise_assignment_group_member_id" ON "exercise_assignment" USING btree ("group_member_id");