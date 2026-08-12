# Azota feature audit

Date: 2026-08-12. Scope: the three sections named — `bai-tap` (17 pages), `de-thi` (28),
`thi-online` (38). Roughly 46 pages fetched; about ten returned only a title or an empty
shell, which is a limitation of how that site serves content and is noted per item below.

Purpose: find what Azota does that we do not, decide what to adopt, and record what we
deliberately decline. Feeds `plans/260812-0901-public-timed-exam/`.

## The one finding that changes the plan

**`Tính năng hưởng điểm` — crediting a broken question to everyone.**

Azota: "Tính năng Hưởng điểm được sử dụng khi giáo viên phát hiện một câu hỏi hoặc đáp án
trong đề có sai sót sau khi học sinh đã làm bài." The teacher marks the question, and "hệ
thống sẽ ghi nhận điểm của câu hỏi đó cho toàn bộ học sinh", updated automatically for
everyone who already sat it.

This matters to us more than to them. Our own `.docx` import shipped a paper with seventeen
of forty answer keys missing earlier this year. A wrong key discovered after a class has sat
the paper is not a hypothetical here; it has already happened.

And our design makes the remedy **necessary rather than optional**. We freeze the paper at
publish precisely so a later edit cannot silently move scores. That protection, left alone,
also removes the teacher's only route to fixing a key they got wrong — the paper is frozen,
so correcting the question changes nothing for anyone who already sat it. Freezing must
block accidental retroactive change while still permitting deliberate correction.

Azota also re-scores automatically when point allocation changes: "Khi chia lại điểm cho đề
thi, các bài thi cũng đồng thời được tính lại điểm theo thay đổi của điểm mới cài đặt."

**Adopted**: an explicit teacher action that awards a question's points to every attempt of
an exam and re-scores them, recorded on the exam so the correction is visible rather than
mysterious.

## Adopted earlier in this audit

| Azota | Why we took it |
|---|---|
| One paper, many sittings | A container backs several exams; deleting one exam must not destroy a paper in use elsewhere. This was a real bug in the plan's first draft. |
| `Thông tin đề` — structure check before sending | Reports question count, counts by kind, options per question. Would have caught our seventeen missing keys in seconds. |
| Score and feedback hidden independently | Azota ships a setting purely to hide the mark while showing comments. Since we now support hand-marking, the axis is real. |
| Answer-change history | "thời điểm học sinh chọn đáp án, thay đổi đáp án, đáp án ban đầu và đáp án cuối cùng", used to settle disputes and spot oddities. Our autosave already carries this; we were discarding it. |
| `Yêu cầu nộp lại` → reopening an attempt | A dead battery mid-exam has no self-service remedy when identity is a typed name. |
| Soft delete with restore | An exam holds work that exists nowhere else. |

## Confirmed we already match

- **The exercise/exam split itself.** `Bài tập` is work a teacher reads; `Đề thi` is a
  structured paper; `Thi Online` is how a paper is administered. Content versus delivery,
  which is the line this plan draws.
- **Per-question points.** `question.points` already exists in our schema.
- **Question groups for reading passages.** Azota marks them with roman numerals or
  `Phần`/`Nhóm`; we have passage groups, and our renderer already pins the passage and pages
  the questions.
- **Three assignment audiences** — everyone, by class, selected students. Our `exercise`
  already carries `assignmentMode` with `ALL_STUDENTS` and `SELECTED_STUDENTS`.
- **Monitoring records rather than blocks.** Azota is explicit that it "chưa hỗ trợ tự động
  chặn, khóa bài hoặc buộc học sinh nộp bài"; our plan makes the same promise and no more.

## Declined, with reasons

**Shuffling.** Five variants: questions and options, questions only, options only,
sub-papers, and random selection by blueprint. One detail worth keeping if we ever build it:
when a paper has groups, "hệ thống sẽ chỉ đảo thứ tự câu hỏi trong từng nhóm" — groups stay
intact and only the questions inside them move, which is the only sane behaviour for a
reading passage. Declined for now: it multiplies the frozen-paper problem by the number of
variants.

**Sub-papers and blueprint selection.** A blueprint has topic, cognitive level (`NB`, `TH`,
`VD`) and question kind; questions must be tagged with a level first. Real value, but it
needs a question bank we do not have.

**Question bank, OCR authoring, AI authoring, AI marking.** Whole product areas.

**`Đề tổ hợp`** — 120 questions as three 40-question subjects scored out of 30 in three
parts. Too specific to a national exam format to build speculatively.

**Statistics.** Azota reports registered count, attempts, not yet sat, sitting now, count
below one point, count at or above five, a score distribution chart with the mean,
per-question right/wrong ratios with the student lists, and the hardest questions ranked.
Worth having eventually; not in the first release.

**Excel and Word export, printing, offline OMR marking, Azota Live.**

## Notable differences in approach

**Editing a live paper.** Azota permits editing a question's content but not adding or
removing questions, and shows students the edit history: "Học sinh cũng sẽ xem được lịch sử
sửa đề của giáo viên trong màn chi tiết bài thi." We chose the stronger guarantee — freeze
at publish — so an edit cannot reach a paper already sat. Their transparency is the fallback
for a weaker invariant; ours removes the need for it, at the cost of requiring the explicit
correction action described above.

**Deleting a student's paper.** Azota refuses: "Hệ thống chỉ cho phép người dùng xóa bài thi
được chấm từ phiếu tô Offline, các bài thi online sẽ không thể xóa." Our plan gives the
teacher a delete. Worth reconsidering — a deleted attempt is evidence destroyed, and a
retention limit already covers the privacy need. **Open question below.**

**Routing by content.** Azota decides whether an uploaded file is homework or an exam by
whether it contains `Câu`/`Bài`/`Question` patterns: "File có câu hỏi sẽ tự động được nhận
diện thành đề thi." Our import always produces a paper.

## Concrete rules worth copying verbatim

**Short-answer matching.** Case-insensitive — "Liên kết" and "liên kết" both correct.
Punctuation and spacing significant — "liên kết." and "liênkết" are different answers.
Multiple accepted answers separated by `|`. One line of answer only. Worth checking our own
short-answer type against this, since these are the rules Vietnamese teachers will expect.

**`.docx` answer marking.** Three ways, and Azota explicitly forbids mixing them: an answer
table at the end; underlining **only the option letter**, not the whole option text; or a
single highlight colour. Our importer had to cope with emphasis spanning the whole option
region — worth documenting as the convention we accept, since "không kết hợp nhiều cách đánh
dấu cùng lúc" is exactly the ambiguity that produced our missing-key bug.

**Marking gestures.** One click marks correct, two marks wrong, a third undoes. Cheap and
worth knowing if we ever build annotation.

## Pages that returned no content

`bai-tap/giao-bai-khong-can-tao-danh-sach-hoc-sinh…` (the anonymous-assignment mechanism,
the single most on-topic page in the audit), `bai-tap/cau-hinh-bai-tap`,
`bai-tap/loc-trang-thai-nop-bai…`, `de-thi/tao-de-thi-tu-upload-file`,
`de-thi/tao-de-tu-file-excel`, `de-thi/tao-de-cau-hoi-dung-sai`,
`de-thi/xoa-khoi-phuc-de-da-xoa`, `thi-online/cai-dat-so-luot-lam-de`,
`thi-online/chia-diem-cho-de-thi`, `thi-online/cai-dat-che-do-luyen-tap`.

## Addendum: three pages outside the three sections

Fetched afterwards, from `ung-dung-tinh-nang` and `vip-to-chuc`. All three carry weight.

**The anonymous mechanism, at last.** `Ai được phép thi` → `Tất cả mọi người`; the student
"truy cập vào link đề thi, điền họ tên và thông tin xác thực (nếu giáo viên có cài đặt)".
Azota does not describe any technical means of telling two sitters apart, and states the
consequences itself: "khó truy vết tìm kiếm thông tin học sinh đã tham gia thi", and — the
one worth surfacing to students — "Học sinh không thể lưu lại lịch sử bài thi nếu không đăng
nhập khi thi". A sitter without an account keeps no record of their own. That is inherent to
identity-by-name, not a gap in their product or ours, and the entry screen should say so.

**Proctoring is not camera-based, and is unreliable by their own admission.** The paid tier
records screen-exit and tab-switch timestamps, device information, and access times. It does
not block, lock, or force submission. The line that matters: on web browsers "hệ thống có thể
không ghi nhận đầy đủ số lần chuyển tab" because of browser security limits. A mature product
with a paid proctoring tier cannot reliably count tab switches. Anyone here proposing
screen-exit monitoring should read that sentence first, and no teacher should be told the
count is complete.

**The per-student process view** records attempt count with timestamps, working time, submit
time, who marked the paper, device information, and a per-question answer-change timeline.

**This resolves the delete question below.** The same view offers `Xóa bài thi và cho thi
lại`, used for appeals. So Azota does permit clearing an online paper — but the control is
"clear it and let them sit again", never a bare delete. That framing is better than ours was:
a teacher clearing a paper almost always means the student should get another go. Phase 6 now
follows it, and removal purely to erase a record sits with retention in phase 7 under its own
name.

## Second sweep: the remaining sections

The corpus is far larger than the three sections first named — sixteen top-level sections,
with the FAQ alone at fifty-two pages and the organisation tier at thirty-eight. Something
over two hundred pages in total. What follows is sampled by expected value against this plan,
not read exhaustively, and that limit is stated rather than glossed.

**Correcting a key after the fact — two remedies, not one.** Azota re-scores automatically on
any key edit: "Hệ thống sẽ tự động cập nhật lại điểm khi giáo viên thao tác sửa đáp án ở đề
gốc." That is a different remedy from `hưởng điểm`. A broken question wants its marks given
to everyone; a merely wrong key wants a re-score against the corrected key, because awarding
marks to everyone is unjust to the students who answered correctly. Our plan had only the
first, and the second is the commoner case here, since our import failure produces wrong keys
rather than broken questions. Both are now in phase 4, and neither fires as a side effect of
editing — the freeze exists precisely so scores do not move unasked.

**Identity by name, seen from their side.** Azota's roster mode has students claim a name from
a class list, and enforces "một tên cho một người dùng". Its documented failure modes are
exactly the ones this territory produces: a student who claimed their name and later opens the
paper on another device without logging in finds it greyed out; or somebody else took their
name first, which needs the teacher to intervene. Our design — free-text name, cookie-based
resume — trades that class of lockout for the opposite failure, silent duplicates. Neither
product escapes the trade; ours fails towards letting a student sit rather than locking them
out, which is the right direction for a school.

**"Chưa nộp bài" validates the autosave design.** Their status means "học sinh thoát ra khỏi
màn hình thi khi chưa hết giờ mà chưa ấn nút Nộp bài", and they state plainly that "dữ liệu
bài làm của học sinh sẽ không bị mất". The student can return and submit; the teacher can
re-open. That is the behaviour this plan builds, arrived at independently.

**Their `.docx` import failure catalogue.** Eleven distinct failure modes, and they are our
failure modes. Worth recording for the exam-import pipeline rather than this plan: the literal
word "đáp án" in content stops question detection; a missing full stop after `A`/`B`/`C`/`D`
makes the answer run into the next question; duplicate question numbers make answers "nhảy";
true/false options inside a table are not recognised; images in Shape Format are lost, as are
images when the paper is saved before uploads finish; hidden characters break parsing, findable
with Ctrl+Shift+8.

There is a whole documented error class called `Lỗi làm đề bị dính đáp án` — the answer key
bleeding into what the student sees. A mature product ships a troubleshooting page for exactly
the leak our phase 2 is built to prevent, which is the strongest external argument that the
structural leak test belongs where it is.

## Unresolved questions
1. ~~Partial credit for the four-part true/false question~~ — **resolved, not applicable yet.**
   The imported 2026 paper is forty questions, every one of them a single choice with exactly
   four options; it contains no four-part true/false question at all. The scoring registry
   already carries the machinery — `supportsPartialCredit` is true for `CHECKBOX` and the
   scorer takes a `partial` flag — but `TRUE_FALSE` is a single statement worth all or
   nothing, which is a different thing from the four-statement question used in Maths and
   Physics papers. The trigger for revisiting this is the first import of a paper that
   contains one; until then there is nothing to grade and nothing to decide.
2. Coverage: **bounded deliberately, not forgotten.** The corpus is roughly two hundred pages
   across sixteen sections; the brief named three. Beyond those, the sections most likely to
   matter were sampled — `Ứng dụng tính năng`, `VIP tổ chức`, `Lỗi thường gặp`,
   `Câu hỏi thường gặp`, `Học sinh` — and every one of them yielded something recorded above,
   including the two blockers this plan was revised for. What stays unread is authoring depth
   (question banks, blueprints, OCR), paper-based marking, and account and billing
   administration: real features, all already declined, none of which changes a decision here.
   `Quản lý lớp` and `Đội nhóm – phân quyền` are the two to read first if roster mode is ever
   taken up, since that is where class lists and per-teacher permissions live.

**Nothing else is outstanding.** Every question this audit opened has been answered or
consciously closed.
