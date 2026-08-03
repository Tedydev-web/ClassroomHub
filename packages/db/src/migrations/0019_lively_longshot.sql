ALTER TABLE "course_newsfeed_comment" ADD COLUMN "parent_id" bigint;--> statement-breakpoint
ALTER TABLE "course_newsfeed_comment" ADD COLUMN "reply_to_comment_id" bigint;--> statement-breakpoint
ALTER TABLE "course_newsfeed_comment" ADD CONSTRAINT "course_newsfeed_comment_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."course_newsfeed_comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_newsfeed_comment" ADD CONSTRAINT "course_newsfeed_comment_reply_to_comment_id_fkey" FOREIGN KEY ("reply_to_comment_id") REFERENCES "public"."course_newsfeed_comment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_newsfeed_comment_parent_id_idx" ON "course_newsfeed_comment" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "course_newsfeed_comment_reply_to_comment_id_idx" ON "course_newsfeed_comment" USING btree ("reply_to_comment_id");