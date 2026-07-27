ALTER TABLE "exam_import" DROP CONSTRAINT "exam_import_started_at_status_check";--> statement-breakpoint
ALTER TABLE "ai_token_usage" ADD COLUMN "transport" text DEFAULT 'official' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_token_usage" ADD COLUMN "workload_domain" text DEFAULT 'interactive' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_token_usage" ADD COLUMN "workload_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_token_usage" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "exam_import" ADD COLUMN "ai_region_audit" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_import" ADD COLUMN "ai_cursor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_import" ADD COLUMN "ai_attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_import" ADD COLUMN "ai_model" text;--> statement-breakpoint
ALTER TABLE "exam_import" ADD CONSTRAINT "exam_import_ai_cursor_nonnegative_check" CHECK ("exam_import"."ai_cursor" >= 0);--> statement-breakpoint
ALTER TABLE "exam_import" ADD CONSTRAINT "exam_import_ai_attempt_nonnegative_check" CHECK ("exam_import"."ai_attempt" >= 0);--> statement-breakpoint
ALTER TABLE "exam_import" ADD CONSTRAINT "exam_import_started_at_status_check" CHECK (("exam_import"."status"::text = 'queued' AND "exam_import"."started_at" IS NULL) OR ("exam_import"."status"::text IN ('running', 'waiting_for_ai', 'draft_ready', 'failed', 'published') AND "exam_import"."started_at" IS NOT NULL) OR "exam_import"."status"::text = 'canceled');--> statement-breakpoint
CREATE UNIQUE INDEX "ai_token_usage_idempotency_key_unique" ON "ai_token_usage" USING btree ("idempotency_key") WHERE "ai_token_usage"."idempotency_key" IS NOT NULL;
