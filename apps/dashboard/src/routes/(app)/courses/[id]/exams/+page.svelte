<script lang="ts">
  import { Badge } from '@cio/ui/badge';
  import { Button } from '@cio/ui/button';

  import { classroomhub } from '$lib/utils/services/api';
  import { snackbar } from '$lib/components/Snackbar/store';

  /**
   * The exams of one course.
   *
   * Opening an exam is the moment its paper stops moving, so this is also where a teacher
   * is shown the paper's shape before the link goes out. That summary earns its place from
   * our own history: the `.docx` import once published forty questions with seventeen
   * answer keys missing, and nobody knew until students sat it.
   */
  let { data } = $props();

  /**
   * The loader is the source; `refreshed` only holds what a button fetched since. Storing
   * the loader's value in plain state instead would capture it at mount, so navigating
   * away and back would render whatever was on screen the first time.
   */
  let refreshed = $state<typeof data.exams | null>(null);
  const exams = $derived(refreshed ?? data.exams);
  let busyId = $state<string | null>(null);
  let summary = $state<{
    examId: string;
    questionCount: number;
    questionsWithoutAnswerKey: Array<{ order: number; title: string }>;
  } | null>(null);

  async function refresh() {
    const response = await classroomhub.exam.course[':courseId'].$get({ param: { courseId: data.courseId } });
    const body = await response.json();
    if ('success' in body && body.success) refreshed = body.data;
  }

  /** Shown before opening, never as a gate. It reports; the teacher decides. */
  async function checkPaper(examId: string) {
    busyId = examId;

    try {
      const response = await classroomhub.exam[':examId'].summary.$get({ param: { examId } });
      const body = await response.json();

      if ('success' in body && body.success) {
        summary = { examId, ...body.data };
      }
    } finally {
      busyId = null;
    }
  }

  async function open(examId: string) {
    busyId = examId;

    try {
      const response = await classroomhub.exam[':examId'].open.$post({ param: { examId } });

      if (response.ok) {
        snackbar.success('Đã mở đề. Đề đã được đóng băng, sửa câu hỏi sau lúc này không đổi bài của học sinh.');
        await refresh();
      } else {
        const body = await response.json();
        snackbar.error('error' in body ? String(body.error) : 'Không mở được đề');
      }
    } finally {
      busyId = null;
    }
  }

  async function close(examId: string) {
    busyId = examId;

    try {
      await classroomhub.exam[':examId'].close.$post({ param: { examId } });
      snackbar.success('Đã đóng đề. Ai đang làm vẫn làm hết giờ của mình.');
      await refresh();
    } finally {
      busyId = null;
    }
  }

  async function copyLink(slug: string) {
    await navigator.clipboard.writeText(`${window.location.origin}/exam/${slug}`);
    snackbar.success('Đã sao chép link');
  }

  const STATUS_LABEL: Record<string, string> = {
    draft: 'Nháp',
    open: 'Đang mở',
    closed: 'Đã đóng'
  };
</script>

<div class="ui:mx-auto ui:w-full ui:max-w-5xl ui:space-y-6 ui:px-4 ui:py-6">
  <header class="ui:flex ui:items-center ui:justify-between ui:gap-3">
    <h1 class="ui:text-xl ui:font-semibold">Đề thi</h1>
    <Button href={`/courses/${data.courseId}/exams/new`}>Tạo đề thi</Button>
  </header>

  {#if exams.length === 0}
    <p class="ui:text-muted-foreground ui:py-10 ui:text-center ui:text-sm">
      Chưa có đề thi nào. Tạo một đề rồi gửi link cho học sinh.
    </p>
  {:else}
    <ul class="ui:space-y-3">
      {#each exams as exam (exam.id)}
        <li class="ui:border-border ui:space-y-3 ui:rounded-md ui:border ui:p-4">
          <div class="ui:flex ui:flex-wrap ui:items-center ui:justify-between ui:gap-3">
            <div class="ui:min-w-0">
              <p class="ui:truncate ui:font-medium">{exam.title}</p>
              <p class="ui:text-muted-foreground ui:text-xs">
                {STATUS_LABEL[exam.status] ?? exam.status}
                {exam.mode === 'public' ? ' · Ai có link cũng làm được' : ' · Cần đăng nhập'}
                {exam.workingSeconds ? ` · ${Math.round(exam.workingSeconds / 60)} phút` : ' · Không giới hạn giờ'}
              </p>
            </div>

            <div class="ui:flex ui:flex-wrap ui:gap-2">
              <Button size="sm" variant="ghost" href={`/courses/${data.courseId}/exams/${exam.id}/results`}>
                Kết quả
              </Button>

              {#if exam.status === 'draft'}
                <Button size="sm" variant="outline" disabled={busyId === exam.id} onclick={() => checkPaper(exam.id)}>
                  Kiểm tra đề
                </Button>
                <Button size="sm" disabled={busyId === exam.id} onclick={() => open(exam.id)}>Mở đề</Button>
              {:else if exam.status === 'open'}
                <Button size="sm" variant="outline" onclick={() => copyLink(exam.slug)}>Sao chép link</Button>
                <Button size="sm" variant="outline" disabled={busyId === exam.id} onclick={() => close(exam.id)}>
                  Đóng đề
                </Button>
              {/if}
            </div>
          </div>

          {#if summary && summary.examId === exam.id}
            <div class="ui:bg-muted ui:space-y-1 ui:rounded-md ui:p-3 ui:text-sm">
              <p>Đề có {summary.questionCount} câu.</p>
              {#if summary.questionsWithoutAnswerKey.length > 0}
                <p class="ui:text-destructive ui:font-medium">
                  {summary.questionsWithoutAnswerKey.length} câu chưa có đáp án đúng:
                  {summary.questionsWithoutAnswerKey.map((question) => `câu ${question.order}`).join(', ')}
                </p>
                <p class="ui:text-muted-foreground ui:text-xs">
                  Những câu này sẽ được 0 điểm cho mọi học sinh. Sửa đáp án trước khi mở đề.
                </p>
              {:else}
                <p class="ui:text-muted-foreground">Mọi câu đều có đáp án đúng.</p>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <p class="ui:text-muted-foreground ui:text-xs">
    Đề thi tách riêng khỏi bài tập: bài tập cần tài khoản và ghi nhận tiến độ, đề thi có thể gửi link công khai và tính
    giờ. Điểm thi không vào sổ điểm của khoá học.
  </p>
</div>
