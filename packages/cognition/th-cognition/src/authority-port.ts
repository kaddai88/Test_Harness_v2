import type { RetrievedExperience } from './context/experience-retriever.js';

export interface CognitionSessionLookup {
  readonly siteId: string;
  readonly sessionId: string;
  readonly targetUrl: string;
  readonly testType?: string;
}

export interface CognitionSessionRecord extends CognitionSessionLookup {
  readonly timestamp: number;
  readonly outcome: 'success' | 'failure' | 'partial';
  readonly findings: readonly { severity: string; title: string; description: string }[];
  readonly actions: readonly { tool: string; input: Readonly<Record<string, unknown>>; success: boolean }[];
}

/** Application capability; it deliberately exposes no persistence repository. */
export interface CognitionLearnedEntityPort {
  retrieveForSession(input: CognitionSessionLookup): Promise<RetrievedExperience>;
  recordSession(input: CognitionSessionRecord): Promise<void>;
}
