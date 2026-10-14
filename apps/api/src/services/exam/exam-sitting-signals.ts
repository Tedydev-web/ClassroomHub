import { createHash } from 'node:crypto';

import { env } from '@cio/core/config/env';

export function hashSittingSignal(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const salt = env.PRIVATE_SERVER_KEY ?? '';
  return createHash('sha256').update(`${salt}:${trimmed}`).digest('hex');
}
