<script lang="ts">
  import { Button } from '@cio/ui/button';
  import { Input } from '@cio/ui/input';
  import { Label } from '@cio/ui/label';

  /**
   * Configuring an exam, using the vocabulary Vietnamese teachers already read.
   *
   * Two combinations are refused here rather than saved and left to disappoint. Showing
   * the paper once everyone has finished needs both a closing time and a working time,
   * because the release moment is one plus the other; without them the setting silently
   * means never. And showing the answers on submit alongside more than one permitted
   * attempt is not a setting at all — a sitter submits, reads the key, clears their cookie
   * and sits again with full marks.
   *
   * The server refuses the same combinations. This only says so earlier.
   */
  let {
    submitting = false,
    onsubmit
  }: {
    submitting?: boolean;
    onsubmit: (settings: Record<string, unknown>) => void;
  } = $props();

  let title = $state('');
  let mode = $state<'public' | 'private'>('public');
  let workingMinutes = $state('');
  let opensAt = $state('');
  let closesAt = $state('');
  let maxAttempts = $state('1');
  let requiresName = $state(true);
  let requiresClass = $state(true);
  let requiresCandidateNumber = $state(false);
  let scoreVisibility = $state<'never' | 'on_submit' | 'after_everyone' | 'above_threshold'>('never');
  let answerVisibility = $state<'never' | 'on_submit' | 'after_everyone' | 'above_threshold'>('never');

  const REVEAL_OPTIONS = [
    { value: 'never', label: 'Không cho xem' },
    { value: 'on_submit', label: 'Khi làm bài xong' },
    { value: 'after_everyone', label: 'Khi tất cả thi xong' },
    { value: 'above_threshold', label: 'Khi đạt điểm nhất định' }
  ] as const;

  const issues = $derived.by(() => {
    const found: string[] = [];

    if (title.trim().length === 0) found.push('Đề thi cần có tiêu đề');

    for (const [label, value] of [
      ['Cho xem điểm', scoreVisibility],
      ['Cho xem đề và đáp án', answerVisibility]
    ] as const) {
      if (value === 'after_everyone' && (!closesAt || workingMinutes.trim().length === 0)) {
        found.push(`"${label} — khi tất cả thi xong" cần đặt cả thời gian làm bài và giờ đóng đề`);
      }
    }

    if (answerVisibility === 'on_submit' && maxAttempts !== '1') {
      found.push('Cho xem đáp án ngay khi nộp thì phải giới hạn 1 lượt làm, nếu không học sinh đọc đáp án rồi thi lại');
    }

    if (opensAt && closesAt && new Date(opensAt) >= new Date(closesAt)) {
      found.push('Giờ mở đề phải trước giờ đóng đề');
    }

    return found;
  });

  function save() {
    if (issues.length > 0 || submitting) return;

    onsubmit({
      title: title.trim(),
      mode,
      workingSeconds: workingMinutes.trim() ? Math.round(Number(workingMinutes) * 60) : null,
      opensAt: opensAt ? new Date(opensAt).toISOString() : null,
      closesAt: closesAt ? new Date(closesAt).toISOString() : null,
      maxAttempts: maxAttempts.trim() ? Number(maxAttempts) : null,
      requiresName,
      requiresClass,
      requiresCandidateNumber,
      scoreVisibility,
      answerVisibility,
      commentVisibility: 'never',
      revealThreshold: null
    });
  }
</script>

<div class="ui:space-y-6">
  <div class="ui:space-y-2">
    <Label for="exam-title">Tiêu đề đề thi</Label>
    <Input id="exam-title" bind:value={title} maxlength={300} />
  </div>

  <fieldset class="ui:space-y-2">
    <legend class="ui:text-sm ui:font-medium">Ai được phép làm</legend>
    <label class="ui:flex ui:items-center ui:gap-2 ui:text-sm">
      <input type="radio" bind:group={mode} value="public" /> Tất cả mọi người có link, không cần đăng nhập
    </label>
    <label class="ui:flex ui:items-center ui:gap-2 ui:text-sm">
      <input type="radio" bind:group={mode} value="private" /> Chỉ học sinh đã đăng nhập
    </label>
  </fieldset>

  <div class="ui:grid ui:gap-4 ui:sm:grid-cols-2">
    <div class="ui:space-y-2">
      <Label for="exam-minutes">Thời gian làm bài (phút)</Label>
      <Input
        id="exam-minutes"
        inputmode="numeric"
        bind:value={workingMinutes}
        placeholder="Để trống nếu không giới hạn"
      />
    </div>
    <div class="ui:space-y-2">
      <Label for="exam-attempts">Số lượt làm đề</Label>
      <Input
        id="exam-attempts"
        inputmode="numeric"
        bind:value={maxAttempts}
        placeholder="Để trống nếu không giới hạn"
      />
    </div>
    <div class="ui:space-y-2">
      <Label for="exam-opens">Giờ mở đề</Label>
      <Input id="exam-opens" type="datetime-local" bind:value={opensAt} />
    </div>
    <div class="ui:space-y-2">
      <Label for="exam-closes">Giờ đóng đề</Label>
      <Input id="exam-closes" type="datetime-local" bind:value={closesAt} />
    </div>
  </div>

  <fieldset class="ui:space-y-2">
    <legend class="ui:text-sm ui:font-medium">Học sinh khai báo</legend>
    <label class="ui:flex ui:items-center ui:gap-2 ui:text-sm">
      <input type="checkbox" bind:checked={requiresName} /> Họ và tên
    </label>
    <label class="ui:flex ui:items-center ui:gap-2 ui:text-sm">
      <input type="checkbox" bind:checked={requiresClass} /> Lớp
    </label>
    <label class="ui:flex ui:items-center ui:gap-2 ui:text-sm">
      <input type="checkbox" bind:checked={requiresCandidateNumber} /> Số báo danh
    </label>
  </fieldset>

  <div class="ui:grid ui:gap-4 ui:sm:grid-cols-2">
    <div class="ui:space-y-2">
      <Label for="exam-score-visibility">Cho xem điểm</Label>
      <select
        id="exam-score-visibility"
        class="ui:border-border ui:w-full ui:rounded-md ui:border ui:px-3 ui:py-2 ui:text-sm"
        bind:value={scoreVisibility}
      >
        {#each REVEAL_OPTIONS as option (option.value)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </div>
    <div class="ui:space-y-2">
      <Label for="exam-answer-visibility">Cho xem đề và đáp án</Label>
      <select
        id="exam-answer-visibility"
        class="ui:border-border ui:w-full ui:rounded-md ui:border ui:px-3 ui:py-2 ui:text-sm"
        bind:value={answerVisibility}
      >
        {#each REVEAL_OPTIONS as option (option.value)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </div>
  </div>

  {#if issues.length > 0}
    <ul class="ui:text-destructive ui:space-y-1 ui:text-sm" role="alert">
      {#each issues as issue (issue)}
        <li>{issue}</li>
      {/each}
    </ul>
  {/if}

  <Button class="ui:min-h-11" disabled={issues.length > 0 || submitting} onclick={save}>
    {submitting ? 'Đang lưu…' : 'Lưu đề thi'}
  </Button>
</div>
