import type { PostProcessingStatus } from "@test-harness/th-protocol";

export interface PostProcessingTransitionOptions {
  expected: PostProcessingStatus[];
  target: PostProcessingStatus;
  error?: string | null;
}

export interface PostProcessingTransitionResult {
  applied: boolean;
  currentState: PostProcessingStatus;
  previousState?: PostProcessingStatus;
}

const TERMINAL_POST_PROCESSING_STATES: readonly PostProcessingStatus[] = [
  "success",
  "partial",
  "failed",
  "not_applicable",
];

export function assertValidPostProcessingTransition(
  sessionStatus: string,
  currentState: PostProcessingStatus,
  options: PostProcessingTransitionOptions,
): void {
  if (currentState === options.target && options.expected.includes(currentState)) {
    return;
  }
  if (sessionStatus === "cancelled") {
    throw new Error("post-processing is not applicable to cancelled session");
  }
  if (sessionStatus !== "completed" && sessionStatus !== "failed") {
    throw new Error("post-processing requires a completed or failed session");
  }
  if (TERMINAL_POST_PROCESSING_STATES.includes(currentState)) {
    throw new Error(`post-processing state is terminal: ${currentState}`);
  }
  if (currentState !== "pending" || options.target !== "running") {
    if (currentState !== "running" || !["success", "partial", "failed"].includes(options.target)) {
      throw new Error(`Invalid post-processing transition: ${currentState} -> ${options.target}`);
    }
  }
  if (options.target === "failed" && !options.error) {
    throw new Error("post-processing failed requires an error");
  }
  if (options.target !== "failed" && options.error !== undefined && options.error !== null) {
    throw new Error("post-processing error is only valid for failed state");
  }
}
