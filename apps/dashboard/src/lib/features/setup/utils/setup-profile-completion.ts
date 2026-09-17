import type { SetupItem } from '../api/setup-progress.svelte';

/**
 * The server cannot tell whether the profile step is done, so every surface that shows setup
 * progress settles it from the signed-in profile's avatar. One definition, so the setup page,
 * the header ring and the sidebar entry never disagree about whether setup is finished.
 */
export function withProfileCompletion(setupItems: SetupItem[], avatarUrl: string | null | undefined): SetupItem[] {
  return setupItems.map((item) =>
    item.id === 'profile' ? { ...item, is_completed: !avatarUrl?.includes('avatars/avatar.png') || !!avatarUrl } : item
  );
}
