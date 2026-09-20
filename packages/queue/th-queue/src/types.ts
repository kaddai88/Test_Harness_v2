/**
 * @test-harness/th-queue — type definitions.
 *
 * Defines jobs, processors, and the TaskQueue interface.
 */

export type JobType =
  | "test:execute"
  | "test:report";

export type JobStatus = "waiting" | "active" | "completed" | "failed" | "delayed";

export interface JobData {
  sessionId: string;
  targetUrl?: string;
  instructions?: string;
}

export interface Job<T = JobData> {
  id: string;
  type: JobType;
  data: T;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  processedAt?: Date;
  completedAt?: Date;
  failedReason?: string;
  result?: unknown;
}

export interface QueueOptions {
  concurrency?: number;
  maxAttempts?: number;
  retryDelay?: number;
}

export interface QueueInventory {
  readonly state: "open" | "paused" | "closed";
  readonly waiting: number;
  readonly delayed: number;
  readonly active: number;
  /** This in-memory implementation has no reservation layer. */
  readonly reserved: 0;
  readonly queued: number;
  readonly isQuiescent: boolean;
}

export interface JobProcessor<T = JobData> {
  process(job: Job<T>): Promise<unknown>;
}

export interface TaskQueue {
  add(type: JobType, data: JobData, opts?: { priority?: number }): Promise<string>;
  process(type: JobType, processor: JobProcessor): void;
  getJob(id: string): Promise<Job | null>;
  getJobs(type?: JobType, status?: JobStatus): Promise<Job[]>;
  remove(id: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  inventory(): Promise<QueueInventory>;
  close(): Promise<void>;
}
