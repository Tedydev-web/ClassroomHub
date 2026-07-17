ALTER TABLE "question_answer" ADD COLUMN "score" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "score" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "idempotency_key" uuid;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "sync_question_answer_score_columns"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW."score" IS NULL THEN
			NEW."score" := COALESCE(NEW."point", 0)::numeric;
		ELSE
			NEW."point" := ROUND(NEW."score")::bigint;
		END IF;
	ELSIF NEW."score" IS DISTINCT FROM OLD."score" THEN
		NEW."point" := ROUND(COALESCE(NEW."score", 0))::bigint;
	ELSIF NEW."point" IS DISTINCT FROM OLD."point" OR NEW."score" IS NULL THEN
		NEW."score" := COALESCE(NEW."point", 0)::numeric;
	END IF;

	RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "question_answer_score_columns_sync"
BEFORE INSERT OR UPDATE ON "question_answer"
FOR EACH ROW
EXECUTE FUNCTION "sync_question_answer_score_columns"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "sync_submission_score_columns"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW."score" IS NULL THEN
			NEW."score" := COALESCE(NEW."total", 0)::numeric;
		ELSE
			NEW."total" := ROUND(NEW."score")::bigint;
		END IF;
	ELSIF NEW."score" IS DISTINCT FROM OLD."score" THEN
		NEW."total" := ROUND(COALESCE(NEW."score", 0))::bigint;
	ELSIF NEW."total" IS DISTINCT FROM OLD."total" OR NEW."score" IS NULL THEN
		NEW."score" := COALESCE(NEW."total", 0)::numeric;
	END IF;

	RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "submission_score_columns_sync"
BEFORE INSERT OR UPDATE ON "submission"
FOR EACH ROW
EXECUTE FUNCTION "sync_submission_score_columns"();
