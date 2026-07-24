<script lang="ts">
  import { goto } from '$app/navigation';

  $effect(() => {
    goto('/users', { replaceState: true });
  });
</script>

<div class="empty">Redirecting to users…</div>
