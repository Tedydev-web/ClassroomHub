-- Additive integrity hardening for revision persistence (follow-up to 0011).
-- 1) Same-question answer linkage: a non-null question_answer.question_revision_id may only
--    reference a revision of the same question. MATCH SIMPLE (default) exempts legacy rows
--    whose question_revision_id is NULL; the single-column FK from 0011 stays in place for
--    drizzle schema metadata.
ALTER TABLE "question_answer" ADD CONSTRAINT "question_answer_revision_same_question_fkey"
FOREIGN KEY ("question_revision_id", "question_id")
REFERENCES "public"."question_revision"("id", "question_id")
ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- 2) Append-only deletes: reject direct DELETE on question_revision while still allowing
--    FK cascades (hard-deleting an unattempted draft question, or its exercise, removes the
--    revisions). Cascaded deletes run inside PostgreSQL's internal RI trigger, so
--    pg_trigger_depth() > 0 there; a top-level direct DELETE sees depth 0. Proven by the
--    migration rehearsal probes (direct delete -> P0001; draft-question delete still cascades).
CREATE OR REPLACE FUNCTION "question_revision_forbid_direct_delete"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'question_revision rows are append-only; delete the parent question to cascade its revisions';
END
$$;--> statement-breakpoint
CREATE TRIGGER "question_revision_append_only"
BEFORE DELETE ON "question_revision"
FOR EACH ROW
WHEN (pg_trigger_depth() = 0)
EXECUTE FUNCTION "question_revision_forbid_direct_delete"();
