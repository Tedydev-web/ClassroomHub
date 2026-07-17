CREATE TABLE "question_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" bigint NOT NULL,
	"revision" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "question_revision_question_id_revision_unique" UNIQUE("question_id","revision"),
	CONSTRAINT "question_revision_id_question_id_unique" UNIQUE("id","question_id"),
	CONSTRAINT "question_revision_revision_min_check" CHECK ("question_revision"."revision" >= 1)
);
--> statement-breakpoint
ALTER TABLE "question_answer" DROP CONSTRAINT "question_answer_question_id_fkey";
--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN "current_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "question_answer" ADD COLUMN "question_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "question_revision" ADD CONSTRAINT "question_revision_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_answer" ADD CONSTRAINT "question_answer_question_revision_id_fkey" FOREIGN KEY ("question_revision_id") REFERENCES "public"."question_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_answer" ADD CONSTRAINT "question_answer_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "question_answer_question_revision_idx" ON "question_answer" USING btree ("question_revision_id") WHERE "question_answer"."question_revision_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_current_revision_fkey" FOREIGN KEY ("current_revision_id","id") REFERENCES "public"."question_revision"("id","question_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "question_revision_forbid_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'question_revision rows are immutable; publish a new revision instead';
END
$$;--> statement-breakpoint
CREATE TRIGGER "question_revision_immutable"
BEFORE UPDATE ON "question_revision"
FOR EACH ROW
EXECUTE FUNCTION "question_revision_forbid_update"();--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "question_type" WHERE "typename" = 'ASSESSMENT_ITEM' AND "id" <> 16)
		OR EXISTS (SELECT 1 FROM "question_type" WHERE "id" = 16 AND "typename" IS DISTINCT FROM 'ASSESSMENT_ITEM') THEN
		RAISE EXCEPTION 'question_type id 16 is reserved for ASSESSMENT_ITEM; resolve the conflicting row before migrating';
	END IF;
END
$$;--> statement-breakpoint
INSERT INTO "question_type" ("id", "label", "typename")
VALUES (16, 'Composite item', 'ASSESSMENT_ITEM')
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
SELECT setval(
	pg_get_serial_sequence('question_type', 'id'),
	GREATEST((SELECT COALESCE(MAX("id"), 1) FROM "question_type"), 16)
);