import 'dotenv/config';

import { writeFile } from 'node:fs/promises';

import { env } from './config/env';
import { warnIfFfmpegMissing } from './utils/ffmpeg';
import { startHealthcheckLoop } from './utils/healthcheck-loop';
import { log } from './utils/logger';
import { connectRedis, redis } from '@cio/core/utils/redis/redis';

const healthcheckFile = '/tmp/classroomhub-jobs-health';

async function refreshHealthcheck(): Promise<void> {
  await connectRedis();
  const pong = await redis.ping();
  if (pong !== 'PONG') {
    throw new Error(`Unexpected Redis healthcheck response: ${pong}`);
  }

  await writeFile(healthcheckFile, `${Date.now()}\n`);
}

startHealthcheckLoop({
  probe: refreshHealthcheck,
  intervalMs: 15_000,
  onError: (error: unknown) => {
    log.error('worker-healthcheck-failed', { message: error instanceof Error ? error.message : String(error) });
  }
});

void warnIfFfmpegMissing();

if (!env.REDIS_URL) {
  throw new Error('REDIS_URL is required to start a worker process.');
}

log.info('worker-bootstrap', {
  nodeEnv: env.NODE_ENV,
  pid: process.pid,
  hasOpenAi: Boolean(env.OPENAI_API_KEY)
});

process.on('uncaughtException', (error) => {
  log.error('uncaught-exception', { message: error.message, stack: error.stack });
});

process.on('unhandledRejection', (reason) => {
  log.error('unhandled-rejection', { reason: reason instanceof Error ? reason.message : String(reason) });
});
