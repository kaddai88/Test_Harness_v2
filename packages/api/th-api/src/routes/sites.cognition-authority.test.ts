import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createInMemoryDatabase } from '@test-harness/th-persistence';
import { dispatchSiteRoute } from './sites.js';

function response() {
  const state: { status?: number; body?: unknown } = {};
  return {
    state,
    value: {
      writeHead(status: number) { state.status = status; },
      end(body: string) { state.body = JSON.parse(body); },
    } as never,
  };
}

function request(method: string, body?: unknown, idempotencyKey?: string) {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  return Object.assign(stream, {
    method,
    headers: idempotencyKey ? { 'idempotency-key': idempotencyKey } : {},
  }) as never;
}

describe('2-C Site Cognition authority routes', () => {
  it('keeps GET mutation-free and replays manual writes through the authority capability', async () => {
    const runtime = createInMemoryDatabase();
    await runtime.authority.sites.create({ scope: { kind: 'profile', profileId: 'site-1' },
      name: 'Example', canonicalOrigin: 'https://example.com', idempotency: { idempotencyKey: 'site-1' } });
    const deps = { cognition: runtime.authority.cognition, sites: runtime.authority.sites };
    const routeKey = encodeURIComponent('https://example.com');

    const beforeGet = await runtime.authority.cognition.listBySite('site-1');
    const get = response();
    expect(await dispatchSiteRoute(request('GET'), get.value, deps,
      `/api/v1/sites/${routeKey}/cognition`)).toBe(true);
    expect(get.state.status).toBe(200);
    expect(await runtime.authority.cognition.listBySite('site-1')).toEqual(beforeGet);

    const body = { description: 'Operator observation', type: 'manual', outcome: 'neutral', findings: [] };
    const first = response();
    await dispatchSiteRoute(request('POST', body, 'manual-request-1'), first.value, deps,
      `/api/v1/sites/${routeKey}/cognition/manual`);
    const replay = response();
    await dispatchSiteRoute(request('POST', body, 'manual-request-1'), replay.value, deps,
      `/api/v1/sites/${routeKey}/cognition/manual`);

    expect(first.state.status).toBe(201);
    expect(replay.state.body).toEqual(first.state.body);
    expect((await runtime.authority.cognition.listBySite('site-1')).episodes).toHaveLength(1);
  });

  it('keeps bare-hostname compatibility read-only and rejects mutation without a scheme', async () => {
    const runtime = createInMemoryDatabase();
    await runtime.authority.sites.create({ scope: { kind: 'profile', profileId: 'site-1' },
      name: 'Example', canonicalOrigin: 'https://example.com', idempotency: { idempotencyKey: 'site-1' } });
    const deps = { cognition: runtime.authority.cognition, sites: runtime.authority.sites };
    const get = response();
    await dispatchSiteRoute(request('GET'), get.value, deps, '/api/v1/sites/example.com');
    expect(get.state.status).toBe(200);
    const update = response();
    await dispatchSiteRoute(request('PUT', { name: 'Forbidden' }), update.value, deps, '/api/v1/sites/example.com');
    expect(update.state.status).toBe(400);
    expect((await runtime.authority.sites.findByOrigin('https://example.com'))?.name).toBe('Example');
  });
});
