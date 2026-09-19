import { describe, expect, it, vi } from 'vitest';
import { THContainer, valueProvider } from '@test-harness/th-core';
import { SiteProfileCapabilityDefinition, type SiteProfileCapabilityRecord } from '@test-harness/th-browser';
import { createConfigureSiteTool } from './configure-site.js';

function setup() {
  let profile: SiteProfileCapabilityRecord = {
    id: 'site-1',
    canonicalOrigin: 'https://www.example.com:8443',
    name: 'Example',
    elementCache: [{ hint: 'login', selector: '#login', timestamp: 1, hitCount: 1, lastVerified: 1 }],
    testCount: 1,
    lastTestedAt: '2026-09-17T01:00:00.000Z',
    updatedAt: '2026-09-17T01:00:00.000Z',
  };
  const updateName = vi.fn(async (name: string) => (profile = { ...profile, name }));
  const replaceLocatorCache = vi.fn(async (entries: readonly never[]) =>
    (profile = { ...profile, elementCache: entries }));
  const container = new THContainer();
  container.register(SiteProfileCapabilityDefinition, valueProvider({
    binding: { profileId: profile.id, canonicalOrigin: profile.canonicalOrigin, sessionId: 'session-1' },
    read: async () => profile,
    updateName,
    replaceLocatorCache,
  }));
  return { tool: createConfigureSiteTool(container), updateName, replaceLocatorCache };
}

const context = { sessionId: 'session-1', abortSignal: new AbortController().signal };

describe('2-D configure_site explicit scope', () => {
  it('routes modeled profile mutations through the bound capability', async () => {
    const { tool, updateName, replaceLocatorCache } = setup();
    expect((await tool.execute({ scope: 'profile', action: 'set', name: 'Renamed' }, context)).success).toBe(true);
    expect(updateName).toHaveBeenCalledWith('Renamed', expect.stringContaining('session-1'));
    expect((await tool.execute({ scope: 'profile', action: 'clear' }, context)).success).toBe(true);
    expect(replaceLocatorCache).toHaveBeenCalledWith([], expect.stringContaining('session-1'));
  });

  it('keeps session configuration local and rejects unmodeled durable fields', async () => {
    const { tool, updateName } = setup();
    const session = await tool.execute({ scope: 'session', action: 'set',
      auth: { usernameHint: 'email' }, constraints: { captcha: true } }, context);
    expect(session).toMatchObject({ success: true, data: { scope: 'session', sessionId: 'session-1' } });
    expect(updateName).not.toHaveBeenCalled();
    const rejected = await tool.execute({ scope: 'profile', action: 'set', auth: { usernameHint: 'email' } }, context);
    expect(rejected).toMatchObject({ success: false });
    expect(rejected.error).toContain('session-local');
  });

  it('rejects inferred scope and mismatched execution sessions', async () => {
    const { tool } = setup();
    expect((await tool.execute({ action: 'get' }, context)).success).toBe(false);
    expect((await tool.execute({ scope: 'profile', action: 'get' },
      { ...context, sessionId: 'other-session' })).success).toBe(false);
  });
});
