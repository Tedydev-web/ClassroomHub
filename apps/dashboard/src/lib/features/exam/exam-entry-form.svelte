<script lang="ts">
  import { Button } from '@cio/ui/button';
  import { Input } from '@cio/ui/input';
  import { Label } from '@cio/ui/label';

  /**
   * What a sitter fills in before the clock starts. Only the fields the exam asks for
   * appear, and everything is checked before starting — being told a password is wrong
   * after the clock has started would be its own small injustice.
   */
  let {
    title,
    requiresName = true,
    requiresClass = false,
    requiresCandidateNumber = false,
    requiresPassword = false,
    workingMinutes = null,
    starting = false,
    error = null,
    onstart
  }: {
    title: string;
    requiresName?: boolean;
    requiresClass?: boolean;
    requiresCandidateNumber?: boolean;
    requiresPassword?: boolean;
    workingMinutes?: number | null;
    starting?: boolean;
    error?: string | null;
    onstart: (details: { displayName: string; className: string; candidateNumber: string; password: string }) => void;
  } = $props();

  let displayName = $state('');
  let className = $state('');
  let candidateNumber = $state('');
  let password = $state('');

  const missing = $derived(
    (requiresName && displayName.trim().length === 0) ||
      (requiresClass && className.trim().length === 0) ||
      (requiresCandidateNumber && candidateNumber.trim().length === 0) ||
      (requiresPassword && password.length === 0)
  );

  function start() {
    if (missing || starting) return;

    onstart({
      displayName: displayName.trim(),
      className: className.trim(),
      candidateNumber: candidateNumber.trim(),
      password
    });
  }
</script>

<div class="ui:mx-auto ui:w-full ui:max-w-md ui:space-y-6 ui:px-4 ui:py-10">
  <div class="ui:space-y-2">
    <h1 class="ui:text-2xl ui:font-semibold">{title}</h1>
    {#if workingMinutes}
      <p class="ui:text-muted-foreground ui:text-sm">Thời gian làm bài: {workingMinutes} phút</p>
    {/if}
  </div>

  <div class="ui:space-y-4">
    {#if requiresName}
      <div class="ui:space-y-2">
        <Label for="exam-name">Họ và tên</Label>
        <Input id="exam-name" bind:value={displayName} autocomplete="name" maxlength={120} />
      </div>
    {/if}

    {#if requiresClass}
      <div class="ui:space-y-2">
        <Label for="exam-class">Lớp</Label>
        <Input id="exam-class" bind:value={className} maxlength={120} />
      </div>
    {/if}

    {#if requiresCandidateNumber}
      <div class="ui:space-y-2">
        <Label for="exam-candidate">Số báo danh</Label>
        <Input id="exam-candidate" bind:value={candidateNumber} maxlength={120} />
      </div>
    {/if}

    {#if requiresPassword}
      <div class="ui:space-y-2">
        <Label for="exam-password">Mật khẩu đề thi</Label>
        <Input id="exam-password" type="password" bind:value={password} maxlength={200} />
      </div>
    {/if}
  </div>

  <!--
    Said before they start rather than discovered afterwards. Azota states the same
    limitation of sitting without an account: the result is not theirs to come back to.
  -->
  <p class="ui:text-muted-foreground ui:text-xs">
    Bạn đang làm bài mà không đăng nhập, nên hệ thống không lưu lịch sử bài thi cho bạn. Sau khi nộp, bạn chỉ xem lại
    được nếu giáo viên cho phép ngay trong lần này.
  </p>

  {#if error}
    <p class="ui:text-destructive ui:text-sm" role="alert">{error}</p>
  {/if}

  <Button class="ui:min-h-11 ui:w-full" disabled={missing || starting} onclick={start}>
    {starting ? 'Đang mở đề…' : 'Bắt đầu làm bài'}
  </Button>
</div>
