<script lang="ts">
  import ExamImportReview from '$features/course/pages/exam-import-review.svelte';

  let { data } = $props();
</script>

<ExamImportReview courseId={data.courseId} importId={data.importId} />
