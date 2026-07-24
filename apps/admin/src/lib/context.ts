import { getContext, setContext } from 'svelte';

import type { AdminApi } from './api.svelte';

const KEY = Symbol('admin-context');

export type AdminContext = {
  /** The authenticated client. Throws if read before the gate has authorized. */
  readonly api: AdminApi;
  signOut: () => void;
};

export function setAdminContext(ctx: AdminContext): void {
  setContext(KEY, ctx);
}

export function useAdmin(): AdminContext {
  const ctx = getContext<AdminContext>(KEY);
  if (!ctx) {
    throw new Error('useAdmin() called outside the authenticated layout');
  }
  return ctx;
}
