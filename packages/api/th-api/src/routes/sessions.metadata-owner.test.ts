import { describe, expect, it, vi } from 'vitest';
import { handleGetSession, handleListSessions } from './sessions.js';
import type { SessionRow } from '@test-harness/th-persistence';

function response() {
  const state: { status?: number; body?: unknown } = {};
  return {
    state,
    res: {
      writeHead(status: number) { state.status = status; },
      end(body: string) { state.body = JSON.parse(body); },
    } as any,
  };
}

const session: SessionRow = {
  id: 'session-1', targetUrl: 'https://example.com', targetConfig: {}, scanConfig: {}, status: 'completed',
  createdAt: '2026-09-17T00:00:00.000Z', startedAt: null, completedAt: null,
  cancelRequestedAt: null, terminalAt: null, statusReason: null,
  postProcessingStatus: 'success', postProcessingError: null, createdBy: null,
  metadata: { summary: 'legacy', score: 1, legacyExtension: { retain: true } },
  metadataByOwner: { workerResult: {
    summary: 'owned', score: 100, findings: [{ title: 'finding' }], activities: [], turns: 2,
  } },
};

function deps() {
  return {
    repos: { sessions: {
      findAll: vi.fn(async () => [structuredClone(session)]),
      findById: vi.fn(async () => structuredClone(session)),
      count: vi.fn(async () => 1),
    } },
    queue: {},
  } as any;
}

describe('2-E owner-first session read projection', () => {
  it('projects owner values over legacy fields and preserves unrelated metadata in lists', async () => {
    const out = response();
    await handleListSessions({ url: '/api/v1/sessions' } as any, out.res, deps());
    const row = (out.state.body as any).sessions[0];
    expect(row).toMatchObject({ summary: 'owned', score: 100, findings: [{ title: 'finding' }] });
    expect(row.metadata).toMatchObject({ summary: 'owned', score: 100, legacyExtension: { retain: true } });
  });

  it('uses the same mutation-free projection for detail reads', async () => {
    const d = deps();
    const out = response();
    await handleGetSession({} as any, out.res, d, { id: session.id });
    expect(out.state.body).toMatchObject({
      summary: 'owned', score: 100, findings: [{ title: 'finding' }],
      metadata: { legacyExtension: { retain: true } },
    });
    expect(d.repos.sessions.findById).toHaveBeenCalledTimes(1);
  });
});
