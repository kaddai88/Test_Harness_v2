/**
 * Tests for InMemoryQueue — in-memory task queue implementation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { InMemoryQueue } from "./in-memory-queue.js";
import type { JobProcessor, JobType, JobData, Job } from "./types.js";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeProcessor(
  fn?: (job: Job) => Promise<unknown>
): JobProcessor {
  return {
    process: fn ?? vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe("InMemoryQueue", () => {
  let queue: InMemoryQueue;

  beforeEach(() => {
    queue = new InMemoryQueue({ maxAttempts: 3, retryDelay: 10 });
  });

  afterEach(async () => {
    await queue.close();
  });

  // ── add ──

  it("add creates a job with unique id", async () => {
    const id1 = await queue.add("test:execute", { sessionId: "s1" });
    const id2 = await queue.add("test:execute", { sessionId: "s2" });

    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^job_/);
  });

  it("add throws when queue is closed", async () => {
    await queue.close();
    await expect(
      queue.add("test:execute", { sessionId: "s1" })
    ).rejects.toThrow("Queue is closed");
  });

  // ── add and process ──

  it("add and process: job gets processed", async () => {
    const processFn = vi.fn().mockResolvedValue({ result: "done" });
    queue.process("test:execute", { process: processFn });

    const jobId = await queue.add("test:execute", { sessionId: "s1" });

    // Wait for the scheduling loop to pick it up
    await wait(50);

    const job = await queue.getJob(jobId);
    expect(job).not.toBeNull();
    expect(job!.status).toBe("completed");
    expect(job!.result).toEqual({ result: "done" });
    expect(processFn).toHaveBeenCalledOnce();
  });

  // ── getJob ──

  it("getJob returns job by id", async () => {
    const jobId = await queue.add("test:execute", { sessionId: "s1" });
    const job = await queue.getJob(jobId);

    expect(job).not.toBeNull();
    expect(job!.id).toBe(jobId);
    expect(job!.type).toBe("test:execute");
    expect(job!.data.sessionId).toBe("s1");
    expect(job!.status).toBe("waiting");
    expect(job!.attempts).toBe(0);
  });

  it("getJob returns null for unknown id", async () => {
    const job = await queue.getJob("nonexistent");
    expect(job).toBeNull();
  });

  // ── getJobs ──

  it("getJobs filters by type and status", async () => {
    await queue.add("test:execute", { sessionId: "s1" });
    await queue.add("test:execute", { sessionId: "s2" });
    await queue.add("test:execute", { sessionId: "s3" });

    const all = await queue.getJobs();
    expect(all).toHaveLength(3);

    const executeJobs = await queue.getJobs("test:execute");
    expect(executeJobs).toHaveLength(3);

    const waitingJobs = await queue.getJobs(undefined, "waiting");
    expect(waitingJobs).toHaveLength(3);

    const activeSessionExecute = await queue.getJobs("test:execute", "active");
    expect(activeSessionExecute).toHaveLength(0);
  });

  // ── priority ──

  it("priority ordering works", async () => {
    const order: string[] = [];
    const processFn = vi.fn().mockImplementation(async (job: Job) => {
      order.push(job.data.sessionId);
      return { ok: true };
    });
    queue.process("test:execute", { process: processFn });

    // Add jobs with different priorities (lower number = higher priority)
    await queue.add("test:execute", { sessionId: "low" }, { priority: 10 });
    await queue.add("test:execute", { sessionId: "high" }, { priority: 1 });
    await queue.add("test:execute", { sessionId: "medium" }, { priority: 5 });

    // Wait for processing
    await wait(100);

    // High priority should be processed first
    expect(order[0]).toBe("high");
    expect(order[1]).toBe("medium");
    expect(order[2]).toBe("low");
  });

  // ── failed job retries ──

  it("failed job retries up to maxAttempts", async () => {
    const processFn = vi.fn().mockRejectedValue(new Error("fail!"));
    queue.process("test:execute", { process: processFn });

    const jobId = await queue.add("test:execute", { sessionId: "s1" });

    // Wait for retries (with 10ms base retry delay, exponential backoff)
    // maxAttempts=3: attempt 1 fails → delayed 10ms → attempt 2 → delayed 20ms → attempt 3 → failed
    await wait(300);

    const job = await queue.getJob(jobId);
    expect(job!.status).toBe("failed");
    expect(job!.attempts).toBe(3);
    expect(job!.failedReason).toBe("fail!");
    expect(processFn).toHaveBeenCalledTimes(3);
  });

  // ── remove ──

  it("remove deletes a job", async () => {
    const jobId = await queue.add("test:execute", { sessionId: "s1" });
    let job = await queue.getJob(jobId);
    expect(job).not.toBeNull();

    await queue.remove(jobId);
    job = await queue.getJob(jobId);
    expect(job).toBeNull();
  });

  it("remove is no-op for nonexistent job", async () => {
    await expect(queue.remove("nonexistent")).resolves.toBeUndefined();
  });

  // ── close ──

  it("close stops processing", async () => {
    const processFn = vi.fn().mockResolvedValue({ ok: true });
    queue.process("test:execute", { process: processFn });

    await queue.close();

    // After close, adding should throw
    await expect(
      queue.add("test:execute", { sessionId: "s1" })
    ).rejects.toThrow("Queue is closed");
  });

  it("pauses consumption while retaining queued jobs and proves quiescence", async () => {
    let release!: () => void;
    const active = new Promise<void>((resolve) => { release = resolve; });
    queue = new InMemoryQueue({ concurrency: 1 });
    queue.process("test:execute", { process: async () => active });
    await queue.add("test:execute", { sessionId: "active" });
    await queue.add("test:execute", { sessionId: "waiting" });
    await wait(20);

    await queue.pause();
    expect(await queue.inventory()).toMatchObject({
      state: "paused", active: 1, waiting: 1, reserved: 0, isQuiescent: false,
    });

    release();
    await wait(20);
    expect(await queue.inventory()).toMatchObject({
      state: "paused", active: 0, waiting: 1, isQuiescent: true,
    });

    await queue.resume();
    await wait(20);
    expect(await queue.inventory()).toMatchObject({ state: "open", active: 0, waiting: 0 });
  });

  it("keeps close distinct from pause and cannot resume a closed queue", async () => {
    await queue.pause();
    expect((await queue.inventory()).state).toBe("paused");
    await queue.close();
    expect(await queue.inventory()).toMatchObject({ state: "closed", isQuiescent: false });
    await expect(queue.resume()).rejects.toThrow("Queue is closed");
  });

  // ── no processor ──

  it("job stays waiting if no processor is registered", async () => {
    const jobId = await queue.add("test:execute", { sessionId: "s1" });

    // Wait for scheduling cycle
    await wait(50);

    // pickNext skips jobs whose type has no processor, so the job stays "waiting"
    const job = await queue.getJob(jobId);
    expect(job!.status).toBe("waiting");
  });
});
