import { randomUUID } from 'node:crypto';

import type { Redis } from 'ioredis';

import { createRedisConnection } from '@cio/jobs';

const LEASE_TTL_MS = 90_000;
const GLOBAL_KEY = 'exam-import:ai-lease:global';

const ACQUIRE_SCRIPT = `
local now = tonumber(ARGV[1])
local expiresAt = tonumber(ARGV[2])
local globalLimit = tonumber(ARGV[3])
local orgLimit = tonumber(ARGV[4])
local member = ARGV[5]

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)

if redis.call('ZCARD', KEYS[1]) >= globalLimit or redis.call('ZCARD', KEYS[2]) >= orgLimit then
  return 0
end

redis.call('ZADD', KEYS[1], expiresAt, member)
redis.call('ZADD', KEYS[2], expiresAt, member)
redis.call('PEXPIRE', KEYS[1], expiresAt - now)
redis.call('PEXPIRE', KEYS[2], expiresAt - now)
return 1
`;

const RELEASE_SCRIPT = `
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
return 1
`;

export type RedisEvaluator = {
  eval(script: string, numberOfKeys: number, ...arguments_: Array<string | number>): Promise<unknown>;
};

export type ExamImportAiLease = {
  release: () => Promise<void>;
};

let leaseConnection: Redis | null = null;

function orgLeaseKey(organizationId: string): string {
  return `exam-import:ai-lease:org:${organizationId}`;
}

function getLeaseConnection(): Redis {
  leaseConnection ??= createRedisConnection();

  return leaseConnection;
}

export async function acquireExamImportAiLeaseWithRedis(
  redis: RedisEvaluator,
  input: {
    organizationId: string;
    globalLimit: number;
    organizationLimit: number;
    now?: number;
    member?: string;
  }
): Promise<ExamImportAiLease | null> {
  const now = input.now ?? Date.now();
  const member = input.member ?? randomUUID();
  const organizationKey = orgLeaseKey(input.organizationId);
  const result = await redis.eval(
    ACQUIRE_SCRIPT,
    2,
    GLOBAL_KEY,
    organizationKey,
    now,
    now + LEASE_TTL_MS,
    input.globalLimit,
    input.organizationLimit,
    member
  );
  if (result !== 1) return null;

  return {
    release: async () => {
      await redis.eval(RELEASE_SCRIPT, 2, GLOBAL_KEY, organizationKey, member);
    }
  };
}

export function acquireExamImportAiLease(input: {
  organizationId: string;
  globalLimit: number;
  organizationLimit: number;
}): Promise<ExamImportAiLease | null> {
  return acquireExamImportAiLeaseWithRedis(getLeaseConnection() as RedisEvaluator, input);
}

export async function closeExamImportAiLeaseConnection(): Promise<void> {
  if (!leaseConnection) return;

  const connection = leaseConnection;
  leaseConnection = null;
  await connection.quit();
}
