/**
 * @test-harness/th-queue
 *
 * Task queue — job scheduling with priority, retry, and concurrency control.
 */

export type {
  Job,
  JobData,
  JobProcessor,
  JobStatus,
  JobType,
  QueueOptions,
  QueueInventory,
  TaskQueue,
} from "./types.js";

export { InMemoryQueue } from "./in-memory-queue.js";

import { InMemoryQueue } from "./in-memory-queue.js";
import type { QueueOptions, TaskQueue } from "./types.js";

/**
 * Create an in-memory TaskQueue.
 *
 * Good for development and single-process deployments.
 */
export function createInMemoryQueue(opts?: QueueOptions): TaskQueue {
  return new InMemoryQueue(opts);
}
