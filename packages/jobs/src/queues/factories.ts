import { FlowProducer, Queue, type QueueOptions } from 'bullmq';

import { getSharedRedisConnection } from '../connection';
import { QUEUE_NAMES, type QueueName } from './names';
import { buildQueueOptions } from './defaults';

/**
 * Lazy queue + flow-producer accessors backed by the shared Redis
 * connection. Workers should NOT use these — they need their own Redis
 * connection per process. These are for the API enqueue path.
 */

const queues = new Map<QueueName, Queue>();
let flowProducer: FlowProducer | undefined;

export function getQueue(name: QueueName): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, {
      ...buildQueueOptions(name),
      connection: getSharedRedisConnection()
    });
    queue.on('error', (error) => {
      console.error(`BullMQ queue error (${name}):`, error);
    });
    queues.set(name, queue);
  }

  return queue;
}

/**
 * A queue on a connection the caller owns, for a process that also runs a Worker.
 *
 * BullMQ needs a Worker's connection to itself — it blocks on it — so a worker
 * process that also enqueues cannot use `getQueue` above and its shared client.
 * The two that could not reach for the shared queue reached past its options as
 * well: both were built with `new Queue(name, { connection })` and no
 * `defaultJobOptions`, which is where `removeOnComplete` lives.
 *
 * Nothing then removed a finished job. The maintenance queue accumulated 453,000
 * completed jobs and 477,000 Redis keys of which five had any expiry; Redis is
 * configured `noeviction`, so the queue was on course to stop accepting writes
 * rather than shed history. The defaults were never wrong — they were bypassed,
 * so the fix is a way of asking for a queue that cannot bypass them.
 */
export function createQueueOnConnection(name: QueueName, connection: QueueOptions['connection']): Queue {
  const queue = new Queue(name, { ...buildQueueOptions(name), connection });

  queue.on('error', (error) => {
    console.error(`BullMQ queue error (${name}):`, error);
  });

  return queue;
}

export function getFlowProducer(): FlowProducer {
  if (!flowProducer) {
    flowProducer = new FlowProducer({ connection: getSharedRedisConnection() });
    flowProducer.on('error', (error) => {
      console.error('BullMQ flow producer error:', error);
    });
  }

  return flowProducer;
}

/** Eagerly close every cached queue/flow producer. Useful in tests. */
export async function closeAllQueues(): Promise<void> {
  await Promise.all(Array.from(queues.values()).map((queue) => queue.close()));
  queues.clear();

  if (flowProducer) {
    await flowProducer.close();
    flowProducer = undefined;
  }
}

/** Returns every queue name in registration order. */
export function listQueueNames(): QueueName[] {
  return Object.values(QUEUE_NAMES);
}
