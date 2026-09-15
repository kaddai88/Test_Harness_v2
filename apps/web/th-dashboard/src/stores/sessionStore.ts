import { create } from 'zustand';
import { api } from '../api/client';
import { sessionWebSocket } from '../api/websocket';
import type { Session, Finding, AgentActivity } from '../types';
import {
  initialStreamReducerState,
  reduceStreamEnvelope,
  selectActiveStream,
  type StreamReducerState,
} from './streamReducer';
import { applyFinalAssistantCommit } from './finalCommitReducer';

/**
 * Apply one AgentActivity to the authoritative v1 stream state.
 * Valid streamEnvelope always wins; legacy partial/done fields from the same
 * activity are compatibility-only and never mutate stream state.
 */
export function applyAgentActivityToStreamState(
  state: StreamReducerState,
  activity: AgentActivity,
  selectedSessionId?: string,
): { streamState: StreamReducerState; streamText: string } {
  if (activity.kind !== 'stream' || !activity.streamEnvelope) {
    return {
      streamState: state,
      streamText: selectedSessionId ? selectActiveStream(state, selectedSessionId)?.content ?? '' : '',
    };
  }
  const streamState = reduceStreamEnvelope(state, activity.streamEnvelope);
  const active = selectedSessionId ? selectActiveStream(streamState, selectedSessionId) : null;
  return { streamState, streamText: active?.content ?? '' };
}

interface SessionStore {
  sessions: Session[];
  currentSession: Session | null;
  findings: Finding[];
  agentActivity: AgentActivity[];
  /** Derived compatibility selector for the current session's active v1 stream */
  streamText: string;
  streamState: StreamReducerState;
  loading: boolean;
  error: string | null;
  /** WebSocket connection status */
  wsConnected: boolean;
  totalSessions: number;
  currentPage: number;
  pageSize: number;
  statusFilter: string;

  fetchSessions: () => Promise<void>;
  fetchSession: (id: string) => Promise<void>;
  createSession: (
    url: string,
    instructions?: string,
    maxTurns?: number,
    maxRetriesPerAction?: number,
    images?: string[],
    testType?: 'smoke' | 'confirmation' | 'acceptance' | 'full'
  ) => Promise<string>;
  cancelSession: (id: string) => Promise<void>;
  setPage: (page: number) => void;
  setStatusFilter: (status: string) => void;
  clearError: () => void;
  connectWebSocket: () => () => void;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  currentSession: null,
  findings: [],
  agentActivity: [],
  streamText: '',
  streamState: initialStreamReducerState,
  loading: false,
  error: null,
  wsConnected: false,
  totalSessions: 0,
  currentPage: 1,
  pageSize: 20,
  statusFilter: 'all',

  fetchSessions: async () => {
    set({ loading: true, error: null });
    try {
      const { currentPage, pageSize, statusFilter } = get();
      const result = await api.getSessions(currentPage, pageSize, statusFilter);
      set({
        sessions: result.sessions ?? [],
        totalSessions: result.total ?? 0,
        loading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch sessions',
        loading: false,
      });
    }
  },

  fetchSession: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const session = await api.getSession(id);
      set({
        currentSession: session,
        findings: session.findings ?? [],
        streamText: selectActiveStream(get().streamState, id)?.content ?? '',
        loading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch session',
        loading: false,
      });
    }
  },

  createSession: async (url, instructions?: string, maxTurns?: number, maxRetriesPerAction?: number, images?: string[], testType?: 'smoke' | 'confirmation' | 'acceptance' | 'full') => {
    set({ loading: true, error: null });
    try {
      const result = await api.createSession({
        targetUrl: url,
        instructions,
        maxTurns,
        maxRetriesPerAction,
        images,
        testType,
      });
      set({ loading: false });
      return result.id;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to create session',
        loading: false,
      });
      throw error;
    }
  },

  cancelSession: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await api.cancelSession(id);
      const { currentSession } = get();
      if (currentSession && currentSession.id === id) {
        set({ currentSession: { ...currentSession, status: 'cancelling' } });
      }
      set({ loading: false });
    } catch (error) {
      // The API remains authoritative. Reconcile optimistic state instead of
      // leaving the UI falsely stuck in cancelling after a failed request.
      await get().fetchSession(id);
      set({
        error: error instanceof Error ? error.message : 'Failed to cancel session',
        loading: false,
      });
    }
  },

  setPage: (page: number) => {
    set({ currentPage: page });
    get().fetchSessions();
  },

  setStatusFilter: (status: string) => {
    set({ statusFilter: status, currentPage: 1 });
    get().fetchSessions();
  },

  clearError: () => set({ error: null }),

  connectWebSocket: () => {
    console.log('[Store] connectWebSocket called');
    sessionWebSocket.connect();

    // Connection status handlers
    const onConnected = () => {
      console.log('[Store] WebSocket connected');
      set({ wsConnected: true });
    };
    const onDisconnected = () => {
      console.log('[Store] WebSocket disconnected');
      set({ wsConnected: false });
    };
    const onError = (data: unknown) => {
      console.error('[Store] WebSocket error:', data);
      set({ wsConnected: false });
    };

    sessionWebSocket.on('connected', onConnected);
    sessionWebSocket.on('disconnected', onDisconnected);
    sessionWebSocket.on('error', onError);

    const unsubStatus = sessionWebSocket.onSessionUpdate(({ sessionId, status }) => {
      const { currentSession, sessions } = get();
      if (currentSession && currentSession.id === sessionId) {
        set({ currentSession: { ...currentSession, status: status as Session['status'] } });
      }
      set({
        sessions: sessions.map((s) =>
          s.id === sessionId ? { ...s, status: status as Session['status'] } : s
        ),
      });
    });

    const unsubFinding = sessionWebSocket.onFinding((findings) => {
      set({ findings });
    });

    const unsubFinalCommit = sessionWebSocket.onFinalAssistantCommit((commit) => {
      set((state) => {
        const applied = applyFinalAssistantCommit(state.streamState, commit);
        if (!applied.result.accepted) return state;
        const active = selectActiveStream(applied.state, state.currentSession?.id ?? commit.sessionId);
        return {
          streamState: applied.state,
          // Final handoff is generation-bound and session-scoped. P4 1D does
          // not create session terminal status; it only makes final content
          // available as the authoritative presentation for that generation.
          streamText: active?.finalContent ?? active?.content ?? state.streamText,
        };
      });
    });

    const unsubActivity = sessionWebSocket.onAgentActivity((activity) => {
      if (activity.kind === 'stream' && activity.streamEnvelope) {
        const envelope = activity.streamEnvelope;
        set((state) => {
          const applied = applyAgentActivityToStreamState(
            state.streamState,
            activity,
            state.currentSession?.id ?? envelope.sessionId,
          );
          return {
            ...applied,
            agentActivity: [...state.agentActivity, activity],
          };
        });
        return;
      }

      // Legacy stream events remain compatibility-only until the v1 reducer
      // rollout is complete; they cannot mutate authoritative v1 stream state.
      if (activity.kind === 'stream') {
        set((state) => ({
          agentActivity: [...state.agentActivity, activity],
        }));
        return;
      }

      if (activity.kind === 'turn_started' || activity.kind === 'tool_call') {
        set((state) => ({
          streamText: selectActiveStream(state.streamState, activity.sessionId ?? '')?.content ?? '',
          agentActivity: [...state.agentActivity, activity],
        }));
        return;
      }

      set((state) => ({
        agentActivity: [...state.agentActivity, activity],
      }));
    });

    const unsubSessionStatus = sessionWebSocket.onSessionStatus(({ sessionId, status, message }) => {
      const { currentSession } = get();
      if (currentSession && currentSession.id === sessionId) {
        set({
          currentSession: {
            ...currentSession,
            status: status as Session['status'],
            phase: message ?? status,
          },
        });
      }
    });

    const unsubCompleted = sessionWebSocket.onSessionCompleted(({ sessionId, status, summary, findingCount }) => {
      const { currentSession } = get();
      if (currentSession && currentSession.id === sessionId) {
        set({
          currentSession: {
            ...currentSession,
            status: status as Session['status'],
            metadata: {
              ...currentSession.metadata,
              summary: summary ?? '',
              findingCount: findingCount ?? 0,
            },
          },
        });
      }
    });

    // Workflow state change
    const unsubWorkflow = sessionWebSocket.onWorkflowState(({ sessionId, newState, message }) => {
      const { currentSession } = get();
      if (currentSession && currentSession.id === sessionId) {
        set({
          currentSession: {
            ...currentSession,
            metadata: {
              ...currentSession.metadata,
              workflowState: newState,
              workflowMessage: message,
            },
          },
        });
      }
    });

    return () => {
      console.log('[Store] WebSocket cleanup');
      sessionWebSocket.off('connected', onConnected);
      sessionWebSocket.off('disconnected', onDisconnected);
      sessionWebSocket.off('error', onError);
      unsubStatus();
      unsubFinding();
      unsubActivity();
      unsubFinalCommit();
      unsubSessionStatus();
      unsubCompleted();
      unsubWorkflow();
      sessionWebSocket.disconnect();
      set({ wsConnected: false });
    };
  },
}));