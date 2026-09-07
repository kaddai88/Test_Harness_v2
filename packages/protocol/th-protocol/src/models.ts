/**
 * @test-harness/th-protocol
 *
 * Core DSH-style types for the AI-driven testing platform.
 *
 * Data flow:
 *   User describes test → Agent plans → executes browser actions → reports findings
 *
 * Types:
 *   - SessionTarget / SessionConfig / LLMConfig — agent loop inputs
 *   - Finding / FindingSeverity — agent output
 *   - TargetConfig — persistence-level target configuration
 */

// ── Finding (agent output) ──

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface Finding {
  id: string;
  sessionId: string;
  severity: FindingSeverity;
  title: string;
  description: string;
  evidence?: {
    selector?: string;
    screenshot?: string;
    url?: string;
    html?: string;
  };
  recommendation?: string;
  createdAt: Date;
}

// ── Target / Session Config (agent loop inputs) ──

export type TargetScope = "page" | "site" | "domain";

export interface TargetConfig {
  scope: TargetScope;
  auth?: {
    type: "cookie" | "header" | "basic";
    credentials: Record<string, string>;
  };
  headers?: Record<string, string>;
  userAgent?: string;
}

export interface SessionTarget {
  url: string;
  scope?: TargetScope;
  auth?: TargetConfig["auth"];
  headers?: Record<string, string>;
}

export interface LLMConfig {
  provider: string;
  model: string;
  temperature?: number;
}

/** Test type presets — different granularity levels for testing */
export type TestType = "smoke" | "confirmation" | "acceptance" | "full";

export interface SessionConfig {
  strategy: "sequential" | "parallel" | "adaptive" | string;
  maxTurns?: number;
  maxRetriesPerAction?: number;
  instructions?: string;
  /** Test type preset: smoke | confirmation | acceptance | full */
  testType?: TestType;
  llm: LLMConfig;
}
