<script lang="ts">
  import { AssessmentItemRenderer } from '@cio/ui/exercise-question';
  import { Button } from '@cio/ui/button';

  import ExamCountdown from '$features/exam/exam-countdown.svelte';
  import ExamEntryForm from '$features/exam/exam-entry-form.svelte';
  import { clockOffsetMs, createAutosaveQueue } from '$features/exam/exam-autosave';
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
  let starting = $state(false);
  let entryError = $state<string | null>(null);

  let attemptId = $state<string | null>(null);
  let paper = $state<{ questions: Array<{ questionId: number; definition: unknown }> } | null>(null);
  let expiresAt = $state<string | null>(null);
  let offset = $state(0);

  const responses = $state<Record<number, unknown>>({});
  let saveState = $state<'saved' | 'saving' | 'unsaved'>('saved');
  let submitting = $state(false);
  let submitError = $state<string | null>(null);

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

  async function start(details: { displayName: string; className: string; candidateNumber: string; password: string }) {
    starting = true;
    entryError = null;

    try {
      const response = await classroomhub['exam-sitting'][':slug'].start.$post(
        { param: { slug: data.slug }, json: details },
        { headers: { 'x-exam-sitting': '1' } }
      );
      const body = await response.json();

      if (!('success' in body) || !body.success) {
        entryError = 'error' in body ? String(body.error) : 'Không mở được đề thi';
        return;
      }

      attemptId = body.data.attemptId;
      paper = body.data.paper;
      expiresAt = body.data.expiresAt ?? null;
      // Measured once, so a device whose clock has drifted still sees the server's time.
      offset = clockOffsetMs(body.data.serverNow ?? new Date().toISOString());
      stage = 'sitting';
    } catch {
      entryError = 'Không kết nối được tới máy chủ';
    } finally {
      starting = false;
    }
  }

  function answered(questionId: number, response: unknown) {
    responses[questionId] = response;
    queue.enqueue({ questionId, answerData: response });
    saveState = 'unsaved';
  }

  async function submit() {
    if (!attemptId || submitting) return;

    submitting = true;
    submitError = null;

    try {
      // Everything outstanding goes first. Submitting with work still queued would be the
      // one moment losing it matters most.
      await queue.flush();
      saveState = queue.state();

      if (saveState === 'unsaved') {
        submitError = 'Một số câu chưa lưu được. Kiểm tra kết nối rồi thử lại.';
        return;
      }

      await classroomhub['exam-sitting'].attempt[':attemptId'].submit.$post(
        { param: { attemptId } },
        { headers: { 'x-exam-sitting': '1' } }
      );
      stage = 'submitted';
    } catch {
      submitError = 'Không nộp được bài. Thử lại sau ít giây.';
    } finally {
      submitting = false;
    }
  }

  /**
   * The convenience path only. Phase 4 finalises an expired attempt from whatever was
   * saved, so a failure here costs nothing — and saying so plainly beats pretending.
   */
  async function onTimeUp() {
    await submit();
  }

  /**
   * Asked once, before the entry screen appears. A refresh mid-paper must continue the
   * same attempt with the time already spent gone — otherwise the student loses their work
   * and gains a fresh clock, which is the wrong outcome twice over.
   */
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

        attemptId = body.data.attemptId;
        paper = body.data.paper;
        expiresAt = body.data.expiresAt ?? null;
        offset = clockOffsetMs(body.data.serverNow);

        for (const saved of body.data.answers ?? []) {
          responses[saved.questionId] = saved.answerData;
        }

        stage = 'sitting';
      } catch {
        // No resume is not an error: it only means this browser has not started yet.
      }
    })();

    return () => {
      cancelled = true;
    };
  });

  const unansweredCount = $derived(
    (paper?.questions ?? []).filter((question) => responses[question.questionId] === undefined).length
  );
</script>

{#if stage === 'entry'}
  <ExamEntryForm
    title={data.exam.title}
    requiresName={data.exam.requiresName}
    requiresClass={data.exam.requiresClass}
    requiresCandidateNumber={data.exam.requiresCandidateNumber}
    requiresPassword={data.exam.requiresPassword}
    workingMinutes={data.exam.workingSeconds ? Math.round(data.exam.workingSeconds / 60) : null}
    {starting}
    error={entryError}
    onstart={start}
  />
{:else if stage === 'sitting'}
  <div class="ui:flex ui:min-h-dvh ui:flex-col">
    <header
      class="ui:border-border ui:bg-background ui:sticky ui:top-0 ui:z-20 ui:flex ui:items-center ui:justify-between ui:gap-3 ui:border-b ui:px-4 ui:py-3"
    >
      <p class="ui:truncate ui:text-sm ui:font-semibold">{data.exam.title}</p>
      <div class="ui:flex ui:shrink-0 ui:items-center ui:gap-3">
        <!-- Never says "saved" while anything is outstanding. -->
        <span class="ui:text-muted-foreground ui:text-xs">
          {saveState === 'saved' ? 'Đã lưu' : saveState === 'saving' ? 'Đang lưu…' : 'Chưa lưu'}
        </span>
        <ExamCountdown {expiresAt} clockOffsetMs={offset} onexpired={onTimeUp} />
      </div>
    </header>

    <main class="ui:flex-1 ui:px-4 ui:py-6">
      {#each paper?.questions ?? [] as question (question.questionId)}
        <AssessmentItemRenderer
          definition={question.definition}
          response={responses[question.questionId]}
          onresponsechange={(response: unknown) => answered(question.questionId, response)}
        />
      {/each}
    </main>

    <footer
      class="ui:border-border ui:bg-background ui:sticky ui:bottom-0 ui:flex ui:items-center ui:justify-between ui:gap-3 ui:border-t ui:px-4 ui:py-3"
    >
      <span class="ui:text-muted-foreground ui:text-xs">
        {unansweredCount > 0 ? `Còn ${unansweredCount} câu chưa trả lời` : 'Đã trả lời hết'}
      </span>
      <Button class="ui:min-h-11" disabled={submitting} onclick={submit}>
        {submitting ? 'Đang nộp…' : 'Nộp bài'}
      </Button>
    </footer>

    {#if submitError}
      <p class="ui:text-destructive ui:px-4 ui:pb-4 ui:text-sm" role="alert">{submitError}</p>
    {/if}
  </div>
{:else}
  <div class="ui:mx-auto ui:max-w-md ui:space-y-3 ui:px-4 ui:py-16 ui:text-center">
    <h1 class="ui:text-xl ui:font-semibold">Đã nộp bài</h1>
    <p class="ui:text-muted-foreground ui:text-sm">
      Bài của bạn đã được ghi nhận. Vì bạn làm bài không đăng nhập nên hệ thống không lưu lịch sử cho bạn xem lại sau.
    </p>
  </div>
{/if}
