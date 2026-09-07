export type SessionStatus = 'pending' | 'planning' | 'executing' | 'running' | 'completed' | 'failed' | 'cancelled';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Session {
  id: string;
  targetUrl: string;
  url?: string;
  targetConfig?: Record<string, unknown>;
  scanConfig?: Record<string, unknown>;
  status: SessionStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdBy?: string | null;
  metadata?: Record<string, unknown> & {
    executionSummary?: {
      overview: string;
      conclusion: string;
      findings: number;
      testCases: Array<{
        name: string;
        action: string;
        result: string;
        screenshot?: string;
        screenshotMimeType?: string;
      }>;
    };
  };
  score?: number;
  findings?: Finding[];
  progress?: number;
  phase?: string;
}

export interface Finding {
  id: string;
  sessionId?: string;
  severity: Severity;
  title: string;
  description: string;
  recommendation?: string;
  url?: string;
  evidence?: {
    selector?: string;
    screenshot?: string;
    url?: string;
    html?: string;
  };
  createdAt: string;
}

export interface AgentActivity {
  id: string;
  sessionId?: string;
  turn: number;
  kind: 'turn_started' | 'stream' | 'tool_call' | 'tool_result';
  tool?: string;
  input?: Record<string, unknown>;
  success?: boolean;
  /** Partial streamed text (kind: "stream") */
  partial?: string;
  done?: boolean;
  timestamp: number;
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  uptime: number;
  activeSessions: number;
}

export interface SessionCreateRequest {
  targetUrl: string;
  url?: string;
  instructions?: string;
  /** Uploaded images as base64 data URLs for vision-capable LLMs */
  images?: string[];
  maxTurns?: number;
  maxRetriesPerAction?: number;
  timeout?: number;
  /** Test type preset: smoke | confirmation | acceptance | full */
  testType?: 'smoke' | 'confirmation' | 'acceptance' | 'full';
}

export interface SessionCreateResponse {
  id: string;
  status: SessionStatus;
}

export interface PaginatedResponse<T> {
  sessions: T[];
  total: number;
  limit?: number;
  offset?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
}

/** Site profile — learned knowledge about a target website */
export interface SiteProfile {
  name: string;
  baseUrl: string;
  elementCache: Array<{
    hint: string;
    selector: string;
    xpath?: string;
    timestamp: number;
    hitCount: number;
    lastVerified: number;
  }>;
  updatedAt: number;
  /** Cognition statistics and data */
  cognition?: {
    episodes: number;
    knowledge: number;
    procedures: number;
    patterns: number;
    recentEpisodes: Array<{
      id: string;
      type: string;
      outcome: string;
      description: string;
      timestamp: number;
    }>;
    recentKnowledge: Array<{
      id: string;
      type: string;
      title: string;
      confidence: number;
    }>;
  };
}
