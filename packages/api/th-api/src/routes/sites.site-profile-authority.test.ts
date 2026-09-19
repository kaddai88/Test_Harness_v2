import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createInMemoryDatabase } from '@test-harness/th-persistence';
import { dispatchSiteRoute } from './sites.js';

function response() {
  const state: { status?: number; body?: any } = {};
  return { state, value: {
    writeHead(status: number) { state.status = status; },
    end(body: string) { state.body = JSON.parse(body); },
  } as never };
}

function request(method: string, body?: unknown, key?: string) {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  return Object.assign(stream, { method, headers: key ? { 'idempotency-key': key } : {} }) as never;
}

function deps(runtime: ReturnType<typeof createInMemoryDatabase>) {
  return { cognition: runtime.authority.cognition, sites: runtime.authority.sites };
}

describe('2-D SiteProfile authority routes', () => {
  it('keeps scheme, www, and non-default-port origins distinct through encoded route keys', async () => {
    const runtime = createInMemoryDatabase();
    const origins = ['http://example.com', 'https://example.com', 'https://www.example.com', 'https://example.com:8443'];
    for (const [index, origin] of origins.entries()) {
      await runtime.authority.sites.ensure({ canonicalOrigin: origin, name: `Site ${index}`,
        idempotency: { idempotencyKey: `ensure-${index}` } });
    }
    for (const [index, origin] of origins.entries()) {
      const res = response();
      await dispatchSiteRoute(request('GET'), res.value, deps(runtime),
        `/api/v1/sites/${encodeURIComponent(origin)}`);
      expect(res.state.status).toBe(200);
      expect(res.state.body.site).toMatchObject({ name: `Site ${index}`, canonicalOriginKey: origin });
    }
    expect(await runtime.authority.sites.list()).toHaveLength(4);
  });

  it('updates modeled fields and cache without erasing canonical identity or metrics', async () => {
    const runtime = createInMemoryDatabase();
    const created = await runtime.authority.sites.ensure({ canonicalOrigin: 'https://example.com', name: 'Before',
      idempotency: { idempotencyKey: 'ensure' } });
    const profileId = created.result.record.id;
    await runtime.authority.sites.replaceLocatorCache({ scope: { kind: 'profile', profileId },
      entries: [{ selector: '#before' }], idempotency: { idempotencyKey: 'cache-before' } });
    const session = await runtime.sessions.create({ id: 'completed-session', targetUrl: 'https://example.com/path',
      targetConfig: {}, scanConfig: {} });
    await runtime.sessions.transitionStatus(session.id, { expected: ['queued'], target: 'planning', reason: 'lifecycle_start' });
    await runtime.sessions.transitionStatus(session.id, { expected: ['planning'], target: 'running', reason: 'lifecycle_start' });
    await runtime.sessions.transitionStatus(session.id, { expected: ['running'], target: 'completed',
      reason: 'completion_success', sideEffects: { terminalAt: '2026-09-17T03:00:00.000Z',
        postProcessingStatus: 'pending' } });
    await runtime.authority.sites.incrementMetric({ scope: { kind: 'session', profileId, sessionId: session.id } });

    const res = response();
    await dispatchSiteRoute(request('PUT', { name: 'After', clearCache: true }, 'update-profile'), res.value,
      deps(runtime), `/api/v1/sites/${encodeURIComponent('https://example.com')}`);
    expect(res.state.status).toBe(200);
    expect(res.state.body.site).toMatchObject({ name: 'After', canonicalOriginKey: 'https://example.com',
      testCount: 1, lastTestedAt: '2026-09-17T03:00:00.000Z', elementCache: [] });
  });

  it('does not mutate authority on GET or on invalid/double-encoded route keys', async () => {
    const runtime = createInMemoryDatabase();
    await runtime.authority.sites.ensure({ canonicalOrigin: 'https://example.com', name: 'Example',
      idempotency: { idempotencyKey: 'ensure' } });
    const before = await runtime.authority.sites.list();
    const get = response();
    await dispatchSiteRoute(request('GET'), get.value, deps(runtime),
      `/api/v1/sites/${encodeURIComponent('https://example.com')}`);
    const invalid = response();
    await dispatchSiteRoute(request('PUT', { name: 'Wrong' }), invalid.value, deps(runtime),
      `/api/v1/sites/${encodeURIComponent(encodeURIComponent('https://example.com'))}`);
    expect(get.state.status).toBe(200);
    expect(invalid.state.status).toBe(400);
    expect(await runtime.authority.sites.list()).toEqual(before);
  });
});
