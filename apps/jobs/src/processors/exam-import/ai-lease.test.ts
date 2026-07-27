import { describe, expect, it, vi } from 'vitest';

import { acquireExamImportAiLeaseWithRedis, type RedisEvaluator } from './ai-lease';

describe('exam import AI lease', () => {
  it('returns a releasable lease when Redis admits both scopes', async () => {
    const evalCommand = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    const redis: RedisEvaluator = { eval: evalCommand };

    const lease = await acquireExamImportAiLeaseWithRedis(redis, {
      organizationId: 'org-1',
      globalLimit: 4,
      organizationLimit: 2,
      now: 1_000,
      member: 'lease-1'
    });

    expect(lease).not.toBeNull();
    await lease?.release();
    expect(evalCommand).toHaveBeenCalledTimes(2);
  });

  it('does not expose a release handle when either scope is full', async () => {
    const evalCommand = vi.fn().mockResolvedValue(0);
    const redis: RedisEvaluator = { eval: evalCommand };

    await expect(
      acquireExamImportAiLeaseWithRedis(redis, {
        organizationId: 'org-1',
        globalLimit: 1,
        organizationLimit: 1
      })
    ).resolves.toBeNull();
    expect(evalCommand).toHaveBeenCalledOnce();
  });
});
