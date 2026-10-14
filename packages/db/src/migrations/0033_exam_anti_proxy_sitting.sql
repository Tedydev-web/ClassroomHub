CREATE TYPE "public"."EXAM_ATTEMPT_REVIEW" AS ENUM('held', 'accepted');--> statement-breakpoint
ALTER TABLE "exam" ADD COLUMN "start_window_minutes" integer;--> statement-breakpoint
ALTER TABLE "exam" ADD COLUMN "shuffle_questions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "exam" ADD COLUMN "shuffle_options" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "exam" ADD COLUMN "hold_shared_device" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "exam" ADD COLUMN "watermark" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_attempt" ADD COLUMN "device_hash" text;--> statement-breakpoint
ALTER TABLE "exam_attempt" ADD COLUMN "fingerprint_hash" text;--> statement-breakpoint
ALTER TABLE "exam_attempt" ADD COLUMN "review_status" "EXAM_ATTEMPT_REVIEW";--> statement-breakpoint
CREATE INDEX "idx_exam_attempt_exam_device" ON "exam_attempt" USING btree ("exam_id","device_hash") WHERE "exam_attempt"."device_hash" IS NOT NULL;
