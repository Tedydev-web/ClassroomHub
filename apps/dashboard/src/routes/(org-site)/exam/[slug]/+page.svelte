<script lang="ts">
  import { t } from '$lib/utils/functions/translations';
  import { AssessmentItemRenderer, QuestionNavigation } from '@cio/ui/custom/exercise-question';
  import { Progress } from '@cio/ui/base/progress';
  import {
    getAssessmentVerticalSliceResponseProgress,
    type AssessmentDeliveryDefinition,
    type AssessmentResponseEnvelope
  } from '@cio/question-types';
  import { getAssessmentPassageWorkspaceLabels } from '$features/course/components/exercise/question-labels';
  import { buildOutlineGroups, questionNumberStarts } from '$features/exam/paper-outline';
  import ExamPaperNavigator from '$features/exam/exam-paper-navigator.svelte';
  import BookmarkIcon from '@lucide/svelte/icons/bookmark';
  import LayoutGridIcon from '@lucide/svelte/icons/layout-grid';
  import StickyNoteIcon from '@lucide/svelte/icons/sticky-note';
  import {
    addNote,
    readAnnotations,
    removeNote,
    toggleBookmark,
    writeAnnotations,
    type PaperAnnotations
  } from '$features/exam/exam-annotations';

  import ExamCountdown from '$features/exam/exam-countdown.svelte';
  import ExamEntryForm from '$features/exam/exam-entry-form.svelte';
  import ExamStartConfirm from '$features/exam/exam-start-confirm.svelte';
  import ExamSubmitConfirm from '$features/exam/exam-submit-confirm.svelte';
  import ExamResumeOffer from '$features/exam/exam-resume-offer.svelte';
  import LanguagePicker from '$features/ui/language-picker.svelte';
  import type { ResumeOwner } from '$features/exam/exam-resume-owner';
  import ExamLeftWarning from '$features/exam/exam-left-warning.svelte';
  import LifeBuoyIcon from '@lucide/svelte/icons/life-buoy';
  import { Button } from '@cio/ui/base/button';
  import * as Dialog from '@cio/ui/base/dialog';
  import { Textarea } from '@cio/ui/base/textarea';
  import { watchFocus } from '$features/exam/exam-activity';
  import { clockOffsetMs, createAutosaveQueue, remainingSeconds } from '$features/exam/exam-autosave';
  import { Confetti } from '$features/ui';
  import { celebrate } from '$features/ui/confetti/store';
  import { isSittingOver, refusalKey, refusalMessage } from '$features/exam/exam-refusals';
  import { classroomhub } from '$lib/utils/services/api';

  /**
   * Sitting a paper without an account.
   *
   * The renderer is the one built for passage papers — it already pins the passage, pages
   * one question at a time on a phone, and highlights the gap belonging to the current
   * question. It takes a definition and a response and emits changes; where those changes
   * go is this page's business, which is exactly the seam an exam needs.
   *
   * `public-course/exercise-view` is deliberately not reused. That component grades in the
   * browser and keeps its attempts in `localStorage` — the behaviour being replaced here —
   * and reusing it would leave browser-side grading one prop away from running.
   */
  let { data } = $props();

  type Stage = 'entry' | 'sitting' | 'submitted';

  let stage = $state<Stage>('entry');

  /**
   * Stops a pull-to-refresh from reloading the paper mid-sitting.
   *
   * `overscroll-behavior` only governs an element that scrolls, and the document is what
   * scrolls here — the class had been sitting on a flex column that never does, so the
   * guard read as present and did nothing. Applied to the scrollport itself, and only while
   * someone is actually sitting the exam, so no other page inherits it.
   */
  $effect(() => {
    if (stage !== 'sitting' || typeof document === 'undefined') return;

    const root = document.documentElement;
    const previous = root.style.overscrollBehaviorY;
    root.style.overscrollBehaviorY = 'contain';

    return () => {
      root.style.overscrollBehaviorY = previous;
    };
  });
  let starting = $state(false);
  let entryError = $state<string | null>(null);

  let attemptId = $state<string | null>(null);
  let paper = $state<{ questions: Array<{ questionId: number; definition: AssessmentDeliveryDefinition }> } | null>(
    null
  );
  let expiresAt = $state<string | null>(null);
  let offset = $state(0);

  const responses = $state<Record<number, AssessmentResponseEnvelope>>({});
  let saveState = $state<'saved' | 'saving' | 'unsaved'>('saved');
  let submitting = $state(false);
  let submitError = $state<string | null>(null);
  /** The clock ended the paper and the server could not be reached to say so. */
  let timedOutOffline = $state(false);
  /**
   * The clock has reached zero. Set before anything is submitted, because the paper must
   * stop looking live the moment it stops being live — a candidate reading 00:00 next to
   * working Next and Previous buttons is being told they still have time.
   */
  let timeUp = $state(false);
  // Only ever set when the teacher chose to show it; the server decides, not this page.
  let revealedResult = $state<{ score: string; total: string } | null>(null);

  const queue = createAutosaveQueue({
    send: async (answers) => {
      if (!attemptId) return;

      await classroomhub['exam-sitting'].attempt[':attemptId'].answers.$put(
        { param: { attemptId }, json: { answers } },
        { headers: { 'x-exam-sitting': '1' } }
      );
    }
  });

  // A debounced save and an interval save deliberately overlap; the queue is built for it.
  const AUTOSAVE_EVERY_MS = 15_000;
  $effect(() => {
    if (stage !== 'sitting') return;

    const timer = setInterval(async () => {
      await queue.flush();
      saveState = queue.state();
    }, AUTOSAVE_EVERY_MS);

    return () => clearInterval(timer);
  });

  /** Server refusals a sitter can meet, mapped to the phrasing they should read. */
  /**
   * What the server actually said.
   *
   * The API client throws on any 4xx before this page can read the body, so the old
   * `catch` reported "could not reach the server" for every refusal — including "you have
   * used all your attempts", which is not a connection problem and sends a sitter into
   * retrying a paper that will never open. The thrown error carries the response text, so
   * the message is there; it only had to be unwrapped.
   */
  function serverMessage(error: unknown, fallback: string): string {
    const key = refusalKey(error);
    if (key) return $t(`exam.refusal.${key}`);

    // The API speaks English and a sitter should not, so the refusals they can actually
    // meet are translated above. Anything else is shown as sent: a message in the wrong
    // language still beats the wrong message.
    return refusalMessage(error) || fallback;
  }

  /**
   * Seeded from the loader, then raised if the server refuses a start for want of one. A
   * teacher can protect an exam after this page was loaded, in which case the entry form
   * drew no password box and the refusal is the first anybody hears of it.
   */
  let needsPassword = $state(data.exam.requiresPassword);
  /**
   * Raised when the server counted this device as having sat already. It is the one refusal
   * a candidate may honestly disagree with — two people sharing one phone — so the form
   * offers them a way to say so rather than a dead end.
   */
  let attemptsUsed = $state(false);

  type EntryDetails = {
    displayName: string;
    className: string;
    candidateNumber: string;
    nickname: string;
    password: string;
    sameDeviceDifferentPerson: boolean;
  };

  /**
   * Held between the form and the confirmation. The clock starts on the request the
   * confirmation sends, so until then this is only what the candidate typed.
   */
  let pendingEntry = $state<EntryDetails | null>(null);
  let confirming = $state(false);

  function propose(details: EntryDetails) {
    pendingEntry = details;
    confirming = true;
  }

  async function confirmStart() {
    if (!pendingEntry) return;

    await start(pendingEntry);

    // Closed either way. Every refusal is shown on the form underneath — the password box,
    // the shared-device way past the attempt limit, the message itself — and this dialog
    // shows none of them. Left open, it hid all three behind a button that had gone back to
    // reading "begin", which is exactly a candidate confirming and nothing happening.
    confirming = false;
  }

  async function start(details: EntryDetails) {
    starting = true;
    entryError = null;

    try {
      const response = await classroomhub['exam-sitting'][':slug'].start.$post(
        { param: { slug: data.slug }, json: details },
        { headers: { 'x-exam-sitting': '1' } }
      );
      const body = await response.json();

      if (!('success' in body) || !body.success) {
        // A teacher can protect an exam after this page was loaded, in which case the entry
        // form never drew a password box. Asking for one now is the difference between a
        // sitter who can go on and a sitter stuck on a refusal they cannot act on.
        if ('code' in body && body.code === 'EXAM_PASSWORD_REQUIRED') {
          needsPassword = true;
        }

        if (refusalKey(body) === 'attempts_used') attemptsUsed = true;

        entryError = serverMessage(body, $t('exam.manage.open_failed'));
        return;
      }

      attemptId = body.data.attemptId;
      paper = body.data.paper;
      expiresAt = body.data.expiresAt ?? null;
      // Measured once, so a device whose clock has drifted still sees the server's time.
      offset = clockOffsetMs(body.data.serverNow ?? new Date().toISOString());
      stage = 'sitting';
    } catch (error) {
      // The client throws on a 4xx before the body can be read, so every refusal that
      // matters reaches the page here rather than above. Setting the flag only in the
      // branch that never runs is why a candidate sharing a phone was shown the refusal
      // and never the way past it.
      if (refusalKey(error) === 'attempts_used') attemptsUsed = true;
      if (refusalKey(error) === 'password_required') needsPassword = true;

      entryError = serverMessage(error, $t('exam.sitting.start_failed'));
    } finally {
      starting = false;
    }
  }

  function answered(questionId: number, response: AssessmentResponseEnvelope) {
    responses[questionId] = response;
    queue.enqueue({ questionId, answerData: response });
    saveState = 'unsaved';
  }

  /**
   * `celebrated` is deliberate: a paper the clock ended is still finished, but a candidate
   * who ran out of time is not in a mood to be congratulated, and confetti over that reads
   * as the screen not understanding what just happened to them.
   */
  /**
   * Reports departures and returns while the paper is being sat.
   *
   * The report is sent on the way out as well as on the way back, so a candidate who leaves
   * and never returns still leaves a record — that one is the only case the paper cannot
   * describe from the return alone.
   */
  let leaves = $state(0);
  let warningOpen = $state(false);
  let helpOpen = $state(false);
  let autoSubmitAfterLeaves = $state<number | null>(null);

  async function reportActivity(events: Array<{ kind: 'left' | 'returned'; at: string }>) {
    if (!attemptId) return;

    try {
      const response = await classroomhub['exam-sitting'].attempt[':attemptId'].activity.$post(
        { param: { attemptId }, json: { events } },
        { headers: { 'x-exam-sitting': '1' } }
      );
      const body = await response.json();
      if (!('success' in body) || !body.success) return;

      leaves = body.data.leaves;
      autoSubmitAfterLeaves = body.data.autoSubmitAfterLeaves;

      // The server decides, not the page: a candidate whose paper was handed in for them
      // must not be able to keep answering by ignoring a dialog.
      if (body.data.submitted) {
        warningOpen = false;
        stage = 'submitted';
      }
    } catch {
      // A report that did not arrive is not worth interrupting a candidate over. The
      // absence itself is what the record is for, and the next one will carry the count.
    }
  }

  $effect(() => {
    if (stage !== 'sitting') return;

    return watchFocus({
      onLeft: (at) => void reportActivity([{ kind: 'left', at }]),
      onReturned: (at) => {
        warningOpen = true;
        void reportActivity([{ kind: 'returned', at }]);
      }
    });
  });

  async function submit({ celebrated = true }: { celebrated?: boolean } = {}) {
    if (!attemptId || submitting) return;

    submitting = true;
    submitError = null;

    try {
      // Everything outstanding goes first. Submitting with work still queued would be the
      // one moment losing it matters most.
      await queue.flush();
      saveState = queue.state();

      if (saveState === 'unsaved') {
        // Unless the clock already ended it, in which case there is nothing to wait for:
        // the server grades an expired attempt from whatever reached it.
        if (timeUp) {
          stage = 'submitted';
          timedOutOffline = true;

          return;
        }

        submitError = $t('exam.sitting.unsaved_blocks_submit');

        return;
      }

      const response = await classroomhub['exam-sitting'].attempt[':attemptId'].submit.$post(
        { param: { attemptId } },
        { headers: { 'x-exam-sitting': '1' } }
      );
      const body = await response.json();

      if ('success' in body && body.success) {
        revealedResult = body.data.result ?? null;
      } else if (isSittingOver(body)) {
        // Already over on the server. Say so, rather than leaving them on a live paper.
        stage = 'submitted';

        return;
      }

      stage = 'submitted';
      if (celebrated) celebrate();
    } catch (error) {
      if (isSittingOver(error)) {
        stage = 'submitted';

        return;
      }

      submitError = serverMessage(error, $t('exam.sitting.submit_failed'));
    } finally {
      submitting = false;
    }
  }

  /**
   * The clock ran out. This is the one submit the candidate cannot retry themselves, so it
   * retries for them, across the same thirty seconds of grace the server allows.
   *
   * It used to try exactly once. A candidate whose connection dropped in the last minute
   * got a red error saying their unsaved work blocked the submit, and then nothing — the
   * clock was gone and the screen was a dead end. What that error did not say is that the
   * server grades an expired attempt from whatever was saved: `finaliseExpiredAttempts`
   * scores `attempt.answers` against the frozen paper and stamps the submission at the
   * moment the clock ended. Their paper was never in danger; only the message was.
   */
  async function onTimeUp() {
    timeUp = true;

    const until = Date.now() + 30_000;

    while (Date.now() < until) {
      await submit({ celebrated: false });
      if (stage === 'submitted') return;

      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }

    // Still unreachable. Say what is true rather than what failed.
    timedOutOffline = true;
    submitError = null;
    stage = 'submitted';
  }

  /**
   * The paper this device already has open, offered rather than entered.
   *
   * A refresh mid-paper must continue the same attempt with the time already spent gone —
   * otherwise the student loses their work and gains a fresh clock, which is the wrong
   * outcome twice over. That used to happen automatically, which quietly handed the second
   * person to pick up a shared phone the first person's answers.
   *
   * The cookie cannot tell those two apart and neither can the server, so the question goes
   * to the only party who knows. Until it is answered this holds nothing but a name: the
   * paper and the answers stay on the server.
   */
  let resumable = $state<ResumeOwner | null>(null);
  let resumableSeconds = $state<number | null>(null);
  let resuming = $state(false);
  let resumeError = $state<string | null>(null);

  $effect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await classroomhub['exam-sitting'][':slug'].resume.$get(
          { param: { slug: data.slug } },
          { headers: { 'x-exam-sitting': '1' } }
        );
        const body = await response.json();

        if (cancelled || !('success' in body) || !body.success || !body.data) return;

        resumable = body.data;
        resumableSeconds = body.data.secondsRemaining ?? null;
        offset = clockOffsetMs(body.data.serverNow);
      } catch {
        // No resume is not an error: it only means this browser has not started yet.
      }
    })();

    return () => {
      cancelled = true;
    };
  });

  /** Claims the offered paper, once its owner has said it is theirs. */
  async function continueAttempt() {
    resuming = true;
    resumeError = null;

    try {
      const response = await classroomhub['exam-sitting'][':slug'].resume.$post(
        { param: { slug: data.slug } },
        { headers: { 'x-exam-sitting': '1' } }
      );
      const body = await response.json();

      if (!('success' in body) || !body.success || !body.data) {
        // The attempt was there a moment ago and is not now: its clock ran out, or it was
        // submitted from another tab. Dropping the offer puts the entry form in its place.
        resumable = null;
        return;
      }

      attemptId = body.data.attemptId;
      paper = body.data.paper;
      expiresAt = body.data.expiresAt ?? null;
      offset = clockOffsetMs(body.data.serverNow);

      for (const saved of body.data.answers ?? []) {
        responses[saved.questionId] = saved.answerData;
      }

      stage = 'sitting';
    } catch (error) {
      resumeError = serverMessage(error, $t('exam.resume.failed'));
    } finally {
      resuming = false;
    }
  }

  /**
   * Rendering is the exercise page's, not a second one built for exams.
   *
   * Everything below mirrors `view-mode.svelte`: the same renderer, the same passage
   * workspace labels, the same container and header rules, and the same continuous
   * numbering across items. A paper sat as an exam should look like a paper sat as an
   * exercise, because it is the same paper.
   */
  const passageWorkspaceLabels = $derived(getAssessmentPassageWorkspaceLabels());

  /** Answered and total counted per interaction, so a passage of six counts as six. */
  const progress = $derived.by(() => {
    let answered = 0;
    let total = 0;

    for (const question of paper?.questions ?? []) {
      const counted = getAssessmentVerticalSliceResponseModelProgress(question);
      answered += counted.answered;
      total += counted.total;
    }

    return { answered, total };
  });

  const unansweredCount = $derived(progress.total - progress.answered);

  function getAssessmentVerticalSliceResponseModelProgress(question: {
    questionId: number;
    definition: AssessmentDeliveryDefinition;
  }): { answered: number; total: number } {
    return getAssessmentVerticalSliceResponseProgress(
      question.definition,
      (responses[question.questionId] ?? null) as AssessmentResponseEnvelope | null
    );
  }

  /**
   * The number the sitter sees beside each question, continuous across the whole paper.
   * A passage holding six questions advances the count by six, so question seven really
   * is the seventh question rather than the second item.
   */
  // Declared before the outline that reads it: the outline is lazy, so the order does not
  // change behaviour, but a reader should not have to prove that to themselves.
  let currentIndex = $state(1);
  /**
   * The number the candidate is on, which is not the same as the item they are on: a
   * passage of ten questions is one item and ten numbers. Null after paging, where no
   * particular number was asked for.
   */
  let currentNumber = $state<number | null>(null);
  let navigatorOpen = $state(false);
  let annotations = $state<PaperAnnotations>({ bookmarks: [], notes: [] });
  let pendingQuote = $state<string | null>(null);
  let noteBody = $state('');

  // Read once the attempt exists, because the marks belong to this sitting and not to the
  // paper. A refresh mid-exam finds them again.
  $effect(() => {
    if (!attemptId) return;

    annotations = readAnnotations(attemptId);
  });

  function persist(next: PaperAnnotations) {
    annotations = next;
    if (attemptId) writeAnnotations(attemptId, next);
  }

  /**
   * The question outline the exercise page carries, fed from the paper instead of from
   * sections — an exam has none. Forty questions across ten passages is exactly where a
   * candidate needs to see, at a glance, which ones they have not answered yet.
   *
   * Built by the same module the teacher's preview uses, so the two cannot number one
   * paper two different ways.
   */
  const outlineGroups = $derived(
    buildOutlineGroups(paper?.questions ?? [], {
      currentIndex,
      currentNumber,
      bookmarked: bookmarkedNumbers,
      noted: notedNumbers,
      answered: (question) => (responses[question.questionId] ?? null) as AssessmentResponseEnvelope | null,
      labels: {
        range: (start, end) =>
          $t('course.navItem.lessons.exercises.all_exercises.assessment_item.passage_workspace_question_range', {
            start,
            end
          }),
        single: (index) =>
          $t('course.navItem.lessons.exercises.all_exercises.assessment_item.question_number', { index })
      }
    })
  );

  /**
   * One item at a time, with the same Previous/Next/Finish control the exercise page uses.
   * A paper of forty questions in one scroll is a different product from the one the
   * course already teaches with, and the passage workspace is built to own the viewport.
   */
  const items = $derived(paper?.questions ?? []);
  const currentItem = $derived(items[currentIndex - 1]);
  const isLastItem = $derived(currentIndex >= items.length);

  function goPrevious() {
    if (currentIndex > 1) {
      currentIndex -= 1;
      currentNumber = null;
    }
  }

  /**
   * Whether the candidate has been asked to confirm handing in.
   *
   * Only ever raised by the candidate pressing the finish button. The clock running out
   * submits without asking, which is right: that submit is not theirs to agree to, and a
   * dialog waiting for an answer nobody is there to give would stand between their work and
   * the server.
   */
  let confirmingSubmit = $state(false);
  let submitMinutesLeft = $state<number | null>(null);

  function goNext() {
    if (!isLastItem) {
      currentIndex += 1;
      currentNumber = null;

      return;
    }

    // Read once, as the dialog opens. A ticking figure in a dialog is a second clock
    // competing with the one in the header, and the candidate is being asked a question
    // whose answer does not change between one second and the next.
    const left = remainingSeconds(expiresAt, offset);
    submitMinutesLeft = left === null ? null : Math.ceil(left / 60);

    confirmingSubmit = true;
  }

  async function confirmSubmit() {
    await submit();

    if (stage === 'submitted') confirmingSubmit = false;
  }

  /** Every number still blank, read off the same outline the drawer draws. */
  const unansweredNumbers = $derived(
    outlineGroups.flatMap((group) =>
      group.questions.filter((question) => !question.isAnswered).map((question) => Number(question.label))
    )
  );

  const numberStartByQuestionId = $derived(questionNumberStarts(paper?.questions ?? []));

  const bookmarkedNumbers = $derived(new Set(annotations.bookmarks));

  /** The numbers carrying a note, so the outline can mark them the way it marks bookmarks. */
  const notedNumbers = $derived(new Set(annotations.notes.map((note) => note.questionNumber)));

  /** The number a bookmark button acts on: the one jumped to, or the item's first. */
  const currentPageNumber = $derived(
    currentNumber ?? (currentItem ? (numberStartByQuestionId[currentItem.questionId] ?? 1) : 1)
  );

  /**
   * Brings the candidate to one question rather than to the passage holding it.
   *
   * The item has to change first so the question exists in the document, and the scroll
   * waits a frame for that render. Where the anchor is missing — a renderer that does not
   * number its interactions — landing on the item is still the right outcome, so the
   * failure is silent and harmless.
   */
  function goToQuestion(number: number) {
    const target = (paper?.questions ?? []).findIndex((question) => {
      const start = numberStartByQuestionId[question.questionId] ?? 1;
      const count = (question.definition?.blocks ?? []).filter(
        (block: { kind?: string }) => block.kind === 'interaction'
      ).length;

      return number >= start && number < start + count;
    });

    if (target < 0) return;

    currentIndex = target + 1;
    currentNumber = number;

    requestAnimationFrame(() => {
      document
        .querySelector(`[data-question-number="${number}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /**
   * Turns whatever the candidate has selected into the start of a note.
   *
   * The selection is captured at the moment they ask for a note, not held as they drag:
   * a selection that survives being tapped away is a selection that fights the paper.
   */
  function beginNote() {
    const selected = typeof window === 'undefined' ? '' : (window.getSelection()?.toString() ?? '');

    pendingQuote = selected.trim();
    noteBody = '';
  }

  function saveNote() {
    if (!noteBody.trim()) return;

    persist(addNote(annotations, { questionNumber: currentPageNumber, quote: pendingQuote ?? '', body: noteBody }));
    pendingQuote = null;
    noteBody = '';
  }
</script>

{#snippet offerResume()}
  {#if resumable}
    <ExamResumeOffer
      owner={resumable}
      secondsRemaining={resumableSeconds}
      continuing={resuming}
      error={resumeError}
      oncontinue={continueAttempt}
    />
  {/if}
{/snippet}

{#if stage === 'entry'}
  <ExamEntryForm
    resumeOffer={resumable ? offerResume : undefined}
    title={data.exam.title}
    requiresName={data.exam.requiresName}
    requiresClass={data.exam.requiresClass}
    requiresCandidateNumber={data.exam.requiresCandidateNumber}
    requiresPassword={needsPassword}
    {attemptsUsed}
    workingMinutes={data.exam.workingSeconds ? Math.round(data.exam.workingSeconds / 60) : null}
    {starting}
    error={entryError}
    onstart={propose}
  />

  <ExamStartConfirm
    open={confirming}
    title={data.exam.title}
    workingMinutes={data.exam.workingSeconds ? Math.round(data.exam.workingSeconds / 60) : null}
    questionCount={data.exam.questionCount ?? 0}
    maxAttempts={data.exam.maxAttempts ?? null}
    {starting}
    oncancel={() => (confirming = false)}
    onconfirm={confirmStart}
  />
{:else if stage === 'sitting'}
  <Dialog.Root open={helpOpen} onOpenChange={(next) => (helpOpen = next)}>
    <Dialog.Content class="ui:max-w-sm">
      <Dialog.Header>
        <Dialog.Title>{$t('exam.help.title')}</Dialog.Title>
        <Dialog.Description>{$t('exam.help.saved_note')}</Dialog.Description>
      </Dialog.Header>

      {#if data.exam.supportContact}
        <p class="ui:text-sm ui:font-medium">{data.exam.supportContact}</p>
      {:else}
        <p class="ui:text-muted-foreground ui:text-sm">{$t('exam.help.no_contact')}</p>
      {/if}

      <p class="ui:text-muted-foreground ui:text-sm">{$t('exam.help.clock_note')}</p>

      <Dialog.Footer>
        <Button onclick={() => (helpOpen = false)}>{$t('exam.left.continue')}</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>

  <ExamPaperNavigator
    groups={outlineGroups}
    notes={annotations.notes}
    answered={progress.answered}
    total={progress.total}
    open={navigatorOpen}
    onOpenChange={(next) => (navigatorOpen = next)}
    onSelect={goToQuestion}
    onRemoveNote={(id) => persist(removeNote(annotations, id))}
  />

  <!--
    Written against whatever was selected, and against the question on screen when nothing
    was. A note is the candidate's own; it is never sent anywhere.
  -->
  <Dialog.Root open={pendingQuote !== null} onOpenChange={(next) => !next && (pendingQuote = null)}>
    <Dialog.Content class="ui:max-w-sm">
      <Dialog.Header>
        <Dialog.Title>{$t('exam.notes.title', { number: String(currentPageNumber) })}</Dialog.Title>
        {#if pendingQuote}
          <Dialog.Description class="ui:italic">“{pendingQuote}”</Dialog.Description>
        {/if}
      </Dialog.Header>

      <Textarea bind:value={noteBody} rows={4} placeholder={$t('exam.notes.placeholder')} />

      <Dialog.Footer>
        <Button variant="ghost" onclick={() => (pendingQuote = null)}>{$t('exam.left.continue')}</Button>
        <Button disabled={!noteBody.trim()} onclick={saveNote}>{$t('exam.notes.save')}</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>

  <ExamSubmitConfirm
    open={confirmingSubmit}
    answered={progress.answered}
    total={progress.total}
    {unansweredNumbers}
    minutesLeft={submitMinutesLeft}
    {submitting}
    error={submitError}
    oncancel={() => (confirmingSubmit = false)}
    onconfirm={confirmSubmit}
    onjump={(number) => {
      confirmingSubmit = false;
      goToQuestion(number);
    }}
  />

  <ExamLeftWarning open={warningOpen} {leaves} {autoSubmitAfterLeaves} onacknowledge={() => (warningOpen = false)} />

  <!--
    A column exactly the height of the viewport, and the only thing on the page that is not
    allowed to scroll. Everything that scrolls does so inside a pane with its own frame: the
    passage, and the questions. That is what keeps the header and the action bar where a
    candidate left them, and what makes the paper fit a tall phone and a short laptop
    without anybody predicting either — the middle simply takes what is left over.
  -->
  <div class="ui:flex ui:flex-col ui:overflow-hidden h-dvh">
    <header
      class="ui:border-border ui:bg-background ui:z-20 ui:shrink-0 ui:flex ui:items-center ui:justify-between ui:gap-3 ui:border-b ui:px-3 ui:py-3 ui:sm:px-6 ui:lg:px-8 pt-[max(0.75rem,env(safe-area-inset-top))] 2xl:px-16"
    >
      <!-- Quiet on purpose: the candidate knows which paper they are sitting, and the
           header has one thing worth reading at a glance. -->
      <p class="ui:text-muted-foreground ui:truncate ui:text-sm">{data.exam.title}</p>
      <div class="ui:flex ui:shrink-0 ui:items-center ui:gap-2">
        <!--
          In the header rather than only on the entry screen. A candidate discovers they
          cannot read the interface once they are already sitting the paper, and leaving to
          change it is not on offer: the clock is running.
        -->
        <LanguagePicker />
        <!--
          Never says "saved" while anything is outstanding. The reassurance folds away on a
          narrow header to leave the clock room; the warning never does, because a candidate
          whose work is not on the server is the one person who has to know.
        -->
        <span
          class={[
            'ui:text-muted-foreground ui:text-xs',
            saveState === 'saved' ? 'ui:hidden ui:sm:inline' : 'ui:text-foreground ui:font-medium'
          ]}
        >
          {saveState === 'saved'
            ? $t('exam.sitting.saved')
            : saveState === 'saving'
              ? $t('exam.sitting.saving')
              : $t('exam.sitting.unsaved')}
        </span>
        <!--
          Beside the clock, because a candidate in trouble looks at the clock first. It says
          what to do rather than promising to fix anything: the paper cannot grant time, and
          only the person named here can.
        -->
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={$t('exam.help.title')}
          onclick={() => (helpOpen = true)}
        >
          <LifeBuoyIcon size={18} />
        </Button>

        <ExamCountdown {expiresAt} clockOffsetMs={offset} onexpired={onTimeUp} />
      </div>
    </header>

    <!--
      The paper takes the width it is given. A passage on the left and its questions on
      the right is the whole point of this layout, and capping the page at a reading
      column squeezed both into the middle while a third of a laptop screen sat empty.
      Padding grows with the viewport instead, so a phone still gets its margins.
    -->
    <main
      class="ui:flex ui:min-h-0 ui:w-full ui:flex-1 ui:flex-col ui:overflow-y-auto ui:px-3 ui:py-4 ui:sm:px-6 ui:lg:px-8 2xl:px-16"
    >
      {#if currentItem}
        {#key currentItem.questionId}
          <AssessmentItemRenderer
            fillsParent
            definition={currentItem.definition}
            response={responses[currentItem.questionId]}
            disabled={submitting || timeUp}
            questionNumber={numberStartByQuestionId[currentItem.questionId]}
            interactionNumberStart={numberStartByQuestionId[currentItem.questionId]}
            showItemHeader={currentItem.definition?.presentation?.layout !== 'passage_split'}
            showContainer
            trueLabel={$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.true_label')}
            falseLabel={$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.false_label')}
            {passageWorkspaceLabels}
            onResponseChange={(response) => answered(currentItem.questionId, response)}
          />
        {/key}
      {/if}
    </main>

    <!--
      Pinned rather than sticky. A sticky bar keeps its place in the flow, so it floated over
      the tail of the paper while scrolling and only settled clear at the very end — which is
      how it came to cover an option a candidate was reading. Fixed, paired with the matching
      padding on the paper above, means the two never occupy the same pixels.
    -->
    <footer
      class="ui:border-border ui:bg-background ui:relative ui:z-20 ui:flex ui:shrink-0 ui:flex-col ui:gap-2 ui:border-t ui:px-3 ui:py-3 ui:sm:px-6 ui:lg:px-8 pb-[max(0.75rem,env(safe-area-inset-bottom))] 2xl:px-16"
    >
      <!--
        Inside the bar, not after it. The bar is pinned, so anything following it in the
        flow is pushed to the very place the bar occupies — which is where a failed submit
        used to go, leaving a candidate no idea their paper had not been handed in. Being
        inside also means its height is measured, so the paper still clears it.
      -->
      {#if timeUp}
        <!--
          Said where the buttons were, because that is where a candidate is looking when the
          clock stops. It reports rather than warns: the answers are already on the server,
          and the sitting is being closed off, not lost.
        -->
        <p class="ui:text-muted-foreground ui:px-3 ui:pb-2 ui:text-sm ui:sm:px-6" role="status">
          {$t('exam.sitting.time_up_closing')}
        </p>
      {:else if submitError}
        <p class="ui:text-destructive ui:text-sm" role="alert">{submitError}</p>
      {/if}

      <!--
        Along the bar's own top edge, out of the flow entirely.
        As a row of its own it cost real height, and every pixel this bar takes is taken
        from the paper above it: the workspace is sized `100dvh` less the chrome, and this
        bar's measured height is part of that subtraction. Progress is read and never
        touched, so it is the one thing here that can give its height back.
      -->
      <Progress
        value={progress.total > 0 ? (progress.answered / progress.total) * 100 : 0}
        class="ui:absolute ui:inset-x-0 ui:top-0 ui:h-1 ui:rounded-none"
      />

      <!--
        The three controls a candidate reaches for without looking, in the bar their thumb
        already rests on: where am I in the paper, mark this one, write this down.

        Getting to another question is the most valuable of the three and was the smallest —
        an unlabelled icon in a row of identical icons. It is now the wide one, and it says
        where the candidate is standing, so the control that moves them through the paper
        also answers the question that makes them want to move.
      -->
      <div class="ui:flex ui:flex-wrap ui:items-center ui:gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="ui:h-9 ui:min-w-0 ui:flex-1 ui:justify-start ui:gap-2"
          onclick={() => (navigatorOpen = true)}
        >
          <LayoutGridIcon size={18} class="ui:shrink-0" />
          <span class="ui:truncate">
            {$t('exam.navigator.open_at', {
              number: String(currentPageNumber),
              total: String(progress.total)
            })}
            <!-- Only where there is room for it; the number is the part that must always fit. -->
            <span class="ui:text-muted-foreground ui:hidden ui:sm:inline">
              ·
              {unansweredCount > 0
                ? $t('exam.sitting.unanswered', { count: String(unansweredCount) })
                : $t('exam.sitting.all_answered')}
            </span>
          </span>
        </Button>

        <Button
          type="button"
          variant="outline"
          size="icon"
          class="ui:size-9 ui:shrink-0"
          aria-pressed={bookmarkedNumbers.has(currentPageNumber)}
          aria-label={$t('exam.navigator.bookmark_this', { number: String(currentPageNumber) })}
          onclick={() => persist(toggleBookmark(annotations, currentPageNumber))}
        >
          <!--
            Amber when set, and the same amber the outline uses. It used to go to the
            button's `secondary` fill, which on this bar is a grey barely distinguishable
            from the outline beside it — so the one control whose whole job is to be
            noticeable afterwards was the hardest to tell the state of.
          -->
          <BookmarkIcon
            size={18}
            class={bookmarkedNumbers.has(currentPageNumber) ? 'ui:fill-amber-400 ui:text-amber-500' : ''}
          />
        </Button>

        <Button
          type="button"
          variant="outline"
          size="icon"
          class="ui:size-9 ui:shrink-0"
          aria-label={$t('exam.notes.add')}
          onclick={beginNote}
        >
          <StickyNoteIcon size={18} class={notedNumbers.has(currentPageNumber) ? 'ui:text-emerald-600' : ''} />
        </Button>

        <!--
          Paging shares this row rather than taking one of its own. It had a row to itself
          for a while, and the paper above lost that height directly — the questions pane
          gets three fifths of whatever the bar leaves, so a row here costs several lines of
          the thing a candidate is actually trying to read.
        -->
        <div class="ui:ml-auto ui:shrink-0">
          <QuestionNavigation
            canGoBack={currentIndex > 1 && !timeUp}
            canGoNext={!submitting && !timeUp}
            isLast={isLastItem}
            isSubmitting={submitting}
            previousLabel={$t('course.navItem.lessons.exercises.all_exercises.previous')}
            nextLabel={$t('course.navItem.lessons.exercises.all_exercises.next')}
            finishLabel={$t('exam.sitting.submit')}
            onPrevious={goPrevious}
            onNext={goNext}
          />
        </div>
      </div>
    </footer>
  </div>
{:else}
  <!-- The exam is served outside the course layout, which is where the celebration canvas
       usually lives, so it is mounted here. -->
  {#if !timedOutOffline}
    <Confetti />
  {/if}

  <div class="ui:mx-auto ui:max-w-md ui:space-y-3 ui:px-4 ui:py-16 ui:text-center">
    <h1 class="ui:text-xl ui:font-semibold">
      {timedOutOffline ? $t('exam.sitting.timed_out_title') : $t('exam.sitting.submitted_title')}
    </h1>

    {#if revealedResult}
      <p class="ui:tabular-nums ui:text-3xl ui:font-semibold">
        {revealedResult.score}/{revealedResult.total}
      </p>
    {/if}

    <p class="ui:text-muted-foreground ui:text-sm">
      {timedOutOffline ? $t('exam.sitting.timed_out_offline_body') : $t('exam.sitting.submitted_body')}
    </p>
  </div>
{/if}
