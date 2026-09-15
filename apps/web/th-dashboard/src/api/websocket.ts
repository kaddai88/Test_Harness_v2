import type { Finding, AgentActivity, StreamEnvelope } from '../types';

type EventHandler = (data: unknown) => void;

/** Normalize a generation-bound final assistant commit at transport boundary. */
export function normalizeFinalAssistantCommit(value: unknown, outerSessionId?: string): import('../types').FinalAssistantCommit | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const commit = value as Record<string, unknown>;
  if (commit.streamContractVersion !== 1
    || typeof commit.sessionId !== 'string'
    || (outerSessionId !== undefined && commit.sessionId !== outerSessionId)
    || typeof commit.logicalTurn !== 'string' || !/^T\d+$/.test(commit.logicalTurn)
    || typeof commit.generationId !== 'string' || commit.generationId.length === 0
    || typeof commit.generationOrdinal !== 'number' || !Number.isInteger(commit.generationOrdinal) || commit.generationOrdinal < 1
    || typeof commit.finalSeq !== 'number' || !Number.isInteger(commit.finalSeq) || commit.finalSeq < 1
    || typeof commit.content !== 'string') return undefined;
  return commit as unknown as import('../types').FinalAssistantCommit;
}

export function normalizeStreamEnvelope(value: unknown, outerSessionId?: string): StreamEnvelope | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.streamContractVersion !== 1
    || typeof candidate.sessionId !== 'string'
    || candidate.sessionId.length === 0
    || (outerSessionId !== undefined && candidate.sessionId !== outerSessionId)
    || typeof candidate.logicalTurn !== 'string'
    || !/^T\d+$/.test(candidate.logicalTurn)
    || typeof candidate.generationId !== 'string'
    || candidate.generationId.length === 0
    || typeof candidate.generationOrdinal !== 'number'
    || !Number.isInteger(candidate.generationOrdinal)
    || candidate.generationOrdinal < 1
    || typeof candidate.seq !== 'number'
    || !Number.isInteger(candidate.seq)
    || candidate.seq <= 0
    || candidate.payloadMode !== 'accumulated'
    || typeof candidate.content !== 'string'
    || !['streaming', 'completed', 'errored', 'cancelled'].includes(candidate.status as string)) {
    return undefined;
  }
  return candidate as unknown as StreamEnvelope;
}

export class SessionWebSocket {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, EventHandler[]>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000;

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    // Use relative path - Vite proxy will forward to backend
    const wsUrl = `ws://${window.location.host}/ws`;
    console.log('[WebSocket] Connecting to', wsUrl);

    // Reset reconnect attempts when manually connecting
    this.reconnectAttempts = 0;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[WebSocket] ✅ Connected');
        this.reconnectAttempts = 0;
        this.emit('connected', { connected: true });
      };

      this.ws.onmessage = (event) => {
        console.log('[WebSocket] 📩 Raw message:', (event.data as string).slice(0, 120));
        try {
          const message = JSON.parse(event.data as string);
          console.log('[WebSocket] 📩 Event:', message.type, message.sessionId?.slice(0,8));
          // Server sends flat messages (no `payload` wrapper) — emit entire message
          this.emit(message.type, message);
        } catch (err) {
          console.warn('[WebSocket] Failed to parse message:', event.data, err);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[WebSocket] ❌ Error:', error);
        this.emit('error', { error: 'WebSocket connection error' });
      };

      this.ws.onclose = () => {
        console.log('[WebSocket] 🔌 Disconnected, will reconnect');
        this.emit('disconnected', { connected: false });
        this.scheduleReconnect();
      };
    } catch (error) {
      console.error('[WebSocket] Failed to create WebSocket:', error);
      this.scheduleReconnect();
    }
  }

  on(event: string, handler: EventHandler): void {
    const handlers = this.listeners.get(event) ?? [];
    handlers.push(handler);
    this.listeners.set(event, handlers);
  }

  off(event: string, handler: EventHandler): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    this.listeners.set(
      event,
      handlers.filter((h) => h !== handler)
    );
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = this.maxReconnectAttempts;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.listeners.clear();
  }

  /** session:update — status change notification */
  onSessionUpdate(
    handler: (data: { sessionId: string; status: string }) => void
  ): () => void {
    const wrapped = (data: unknown) => {
      const msg = data as { sessionId?: string; status?: string };
      if (msg.sessionId && msg.status) handler({ sessionId: msg.sessionId, status: msg.status });
    };
    this.on('session:update', wrapped);
    return () => this.off('session:update', wrapped);
  }

  /** session:finding — batch of findings from completed session */
  onFinding(handler: (findings: Finding[]) => void): () => void {
    const wrapped = (data: unknown) => {
      const msg = data as { findings?: Finding[] };
      if (msg.findings) handler(msg.findings);
    };
    this.on('session:finding', wrapped);
    return () => this.off('session:finding', wrapped);
  }

  private normalizeStreamEnvelope(value: unknown, outerSessionId?: string): StreamEnvelope | undefined {
    return normalizeStreamEnvelope(value, outerSessionId);
  }


  onAgentActivity(handler: (activity: AgentActivity) => void): () => void {
    const wrapped = (data: unknown) => {
      const msg = data as Record<string, unknown>;
      // Build AgentActivity from flat server message
      const activity: AgentActivity = {
        id: `act_${msg.timestamp ?? Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        sessionId: msg.sessionId as string | undefined,
        turn: (msg.turn as number) ?? 0,
        kind: (msg.kind as AgentActivity['kind']) ?? 'turn_started',
        tool: msg.tool as string | undefined,
        input: msg.input as Record<string, unknown> | undefined,
        success: msg.success as boolean | undefined,
        partial: msg.partial as string | undefined,
        done: msg.done as boolean | undefined,
        streamEnvelope: this.normalizeStreamEnvelope(msg.streamEnvelope, msg.sessionId as string | undefined),
        timestamp: msg.timestamp as number ?? Date.now(),
      };
      handler(activity);
    };
    this.on('agent:activity', wrapped);
    return () => this.off('agent:activity', wrapped);
  }

  /** Generation-bound final assistant commit */
  onFinalAssistantCommit(handler: (commit: import('../types').FinalAssistantCommit) => void): () => void {
    const wrapped = (data: unknown) => {
      const msg = data as { sessionId?: string; commit?: unknown };
      if (!msg.commit || !msg.sessionId) return;
      const normalized = normalizeFinalAssistantCommit(msg.commit, msg.sessionId);
      if (!normalized) return;
      handler(normalized);
    };
    this.on('agent:final_assistant_commit', wrapped);
    return () => this.off('agent:final_assistant_commit', wrapped);
  }


  onWorkflowState(
    handler: (data: { sessionId: string; previousState: string; newState: string; message: string }) => void
  ): () => void {
    const wrapped = (data: unknown) => {
      const msg = data as { sessionId?: string; previousState?: string; newState?: string; message?: string };
      if (msg.sessionId && msg.newState) {
        handler({
          sessionId: msg.sessionId,
          previousState: msg.previousState ?? '',
          newState: msg.newState,
          message: msg.message ?? '',
        });
      }
    };
    this.on('agent:workflow_state', wrapped);
    return () => this.off('agent:workflow_state', wrapped);
  }

  /** session:status — phase transition (planning → executing → etc.) */
  onSessionStatus(
    handler: (data: { sessionId: string; status: string; message?: string }) => void
  ): () => void {
    const wrapped = (data: unknown) => {
      const msg = data as { sessionId?: string; status?: string; message?: string };
      if (msg.sessionId && msg.status) {
        handler({ sessionId: msg.sessionId, status: msg.status, message: msg.message });
      }
    };
    this.on('session:status', wrapped);
    return () => this.off('session:status', wrapped);
  }

  /** session:completed — final summary */
  onSessionCompleted(
    handler: (data: { sessionId: string; status: string; summary?: string; findingCount?: number }) => void
  ): () => void {
    const wrapped = (data: unknown) => {
      const msg = data as { sessionId?: string; status?: string; summary?: string; findingCount?: number };
      if (msg.sessionId && msg.status) {
        handler({ sessionId: msg.sessionId, status: msg.status, summary: msg.summary, findingCount: msg.findingCount });
      }
    };
    this.on('session:completed', wrapped);
    return () => this.off('session:completed', wrapped);
  }

  private emit(event: string, data: unknown): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in ${event} handler:`, error);
        }
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    if (this.reconnectTimer) return;

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

export const sessionWebSocket = new SessionWebSocket();
