ALTER TABLE "exam" ADD COLUMN "auto_submit_after_leaves" integer;--> statement-breakpoint
ALTER TABLE "exam" ADD COLUMN "support_contact" text;--> statement-breakpoint
ALTER TABLE "exam_attempt" ADD COLUMN "activity_log" jsonb DEFAULT '[]'::jsonb NOT NULL;