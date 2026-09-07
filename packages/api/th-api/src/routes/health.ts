/**
 * Health & status routes.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseRepositories } from "@test-harness/th-persistence";
import type { TaskQueue } from "@test-harness/th-queue";
import { sendJson } from "../http.js";

export interface HealthDeps {
  repos: DatabaseRepositories;
  queue: TaskQueue;
}

export async function handleHealth(
  _req: IncomingMessage,
  res: ServerResponse,
  _deps: HealthDeps
): Promise<void> {
  sendJson(res, 200, {
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "0.1.0",
  });
}

export async function handleStatus(
  _req: IncomingMessage,
  res: ServerResponse,
  deps: HealthDeps
): Promise<void> {
  const totalSessions = await deps.repos.sessions.count();
  const pendingSessions = await deps.repos.sessions.count({ status: "pending" });
  // "running" is the current term for active execution; "executing" is legacy data
  const runningSessions = await deps.repos.sessions.count({ status: "running" });
  const executingSessions = await deps.repos.sessions.count({ status: "executing" });
  const activeSessions = runningSessions + executingSessions;
  const completedSessions = await deps.repos.sessions.count({ status: "completed" });
  const failedSessions = await deps.repos.sessions.count({ status: "failed" });

  const waitingJobs = await deps.queue.getJobs(undefined, "waiting");
  const activeJobs = await deps.queue.getJobs(undefined, "active");

  sendJson(res, 200, {
    status: "ok",
    sessions: {
      total: totalSessions,
      pending: pendingSessions,
      active: activeSessions,
      completed: completedSessions,
      failed: failedSessions,
    },
    queue: {
      waiting: waitingJobs.length,
      active: activeJobs.length,
    },
  });
}
