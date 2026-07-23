ALTER TABLE "question_answer" ADD COLUMN "attempted_question_title" text;--> statement-breakpoint
ALTER TABLE "question_answer" ADD COLUMN "attempted_question_order" integer;--> statement-breakpoint
ALTER TABLE "question_answer" ADD COLUMN "attempted_exercise_section_id" uuid;