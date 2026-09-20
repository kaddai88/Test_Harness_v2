/**
 * In-memory TaskQueue implementation.
 *
 * Stores jobs in a Map and runs them asynchronously via a scheduling loop.
 * Suitable for development and single-process deployments. For production,
 * swap in a Redis- or Postgres-backed implementation of the same interface.
 */
import type {
  Job,
  JobData,
  JobProcessor,
  JobStatus,
  JobType,
  QueueInventory,
  QueueOptions,
  TaskQueue,
} from "./types.js";

let jobCounter = 0;
function generateJobId(): string {
  jobCounter += 1;
  return `job_${Date.now()}_${jobCounter}`;
}

interface InternalJob extends Job {
  _retryTimer?: ReturnType<typeof setTimeout>;
}

export class InMemoryQueue implements TaskQueue {
  private jobs = new Map<string, InternalJob>();
  private processors = new Map<JobType, JobProcessor>();
  private activeCount = 0;
  private closed = false;
  private paused = false;
  private scheduleTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly concurrency: number;
  private readonly maxAttempts: number;
  private readonly retryDelay: number;

  constructor(opts: QueueOptions = {}) {
    this.concurrency = opts.concurrency ?? 4;
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.retryDelay = opts.retryDelay ?? 1000;
  }

  async add(
    type: JobType,
    data: JobData,
    opts?: { priority?: number }
  ): Promise<string> {
    if (this.closed) {
      throw new Error("Queue is closed");
    }

    const job: InternalJob = {
      id: generateJobId(),
      type,
      data,
      status: "waiting",
      priority: opts?.priority ?? 0,
      attempts: 0,
      maxAttempts: this.maxAttempts,
      createdAt: new Date(),
    };

    this.jobs.set(job.id, job);
    this.schedule();
    return job.id;
  }

  process(type: JobType, processor: JobProcessor): void {
    this.processors.set(type, processor);
    // A processor was registered — try to drain waiting jobs of this type.
    this.schedule();
  }

  async getJob(id: string): Promise<Job | null> {
    return this.jobs.get(id) ?? null;
  }

  async getJobs(type?: JobType, status?: JobStatus): Promise<Job[]> {
    const all = [...this.jobs.values()];
    return all.filter((j) => {
      if (type !== undefined && j.type !== type) return false;
      if (status !== undefined && j.status !== status) return false;
      return true;
    });
  }

  async remove(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;
    if (job._retryTimer) clearTimeout(job._retryTimer);
    this.jobs.delete(id);
  }

  async pause(): Promise<void> {
    if (this.closed) throw new Error("Queue is closed");
    this.paused = true;
    if (this.scheduleTimer) {
      clearTimeout(this.scheduleTimer);
      this.scheduleTimer = null;
    }
  }

  async resume(): Promise<void> {
    if (this.closed) throw new Error("Queue is closed");
    this.paused = false;
    this.schedule();
  }

  async inventory(): Promise<QueueInventory> {
    let waiting = 0;
    let delayed = 0;
    let active = 0;
    for (const job of this.jobs.values()) {
      if (job.status === "waiting") waiting += 1;
      if (job.status === "delayed") delayed += 1;
      if (job.status === "active") active += 1;
    }
    return {
      state: this.closed ? "closed" : this.paused ? "paused" : "open",
      waiting,
      delayed,
      active,
      reserved: 0,
      queued: waiting + delayed,
      // A paused queue can retain jobs while proving that no job is executing.
      isQuiescent: !this.closed && this.paused && active === 0,
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.scheduleTimer) {
      clearTimeout(this.scheduleTimer);
      this.scheduleTimer = null;
    }
    for (const job of this.jobs.values()) {
      if (job._retryTimer) clearTimeout(job._retryTimer);
    }
  }

  // ── Internal scheduling ──

  private schedule(): void {
    if (this.closed || this.paused) return;
    if (this.scheduleTimer) return;
    // Defer to avoid recursive scheduling during a running process call.
    this.scheduleTimer = setTimeout(() => {
      this.scheduleTimer = null;
      this.drain();
    }, 0);
  }

  private drain(): void {
    if (this.closed || this.paused) return;

    while (this.activeCount < this.concurrency) {
      const next = this.pickNext();
      if (!next) break;
      this.activeCount += 1;
      this.runJob(next).finally(() => {
        this.activeCount -= 1;
        // Continue draining after each completion.
        this.schedule();
      });
    }
  }

  private pickNext(): InternalJob | null {
    const candidates: InternalJob[] = [];
    for (const job of this.jobs.values()) {
      if (job.status !== "waiting") continue;
      if (!this.processors.has(job.type)) continue;
      candidates.push(job);
    }
    if (candidates.length === 0) return null;

    // Lower priority number = higher priority. Sort ascending by priority,
    // then by createdAt (FIFO within same priority).
    candidates.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    return candidates[0] ?? null;
  }

  private async runJob(job: InternalJob): Promise<void> {
    const processor = this.processors.get(job.type);
    if (!processor) {
      job.status = "failed";
      job.failedReason = `No processor registered for type "${job.type}"`;
      return;
    }

    job.status = "active";
    job.processedAt = new Date();
    job.attempts += 1;

    try {
      const result = await processor.process(job);
      job.status = "completed";
      job.completedAt = new Date();
      job.result = result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      job.failedReason = message;

      if (job.attempts < job.maxAttempts) {
        // Exponential backoff: delay * 2^(attempt-1)
        const delay = this.retryDelay * Math.pow(2, job.attempts - 1);
        job.status = "delayed";
        job._retryTimer = setTimeout(() => {
          job._retryTimer = undefined;
          if (this.closed) return;
          job.status = "waiting";
          this.schedule();
        }, delay);
      } else {
        job.status = "failed";
        job.completedAt = new Date();
      }
    }
  }
}
