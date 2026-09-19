import { describe, expect, it } from 'vitest';
import type { PersistedSessionState } from './identity-semantics.js';
import {
  DurableSessionPersistenceStore,
  type P2ESessionMetadataCapability,
} from './durable-session-persistence.js';

function state(sessionId = 'session-1'): PersistedSessionState {
  return {
    sessionId,
    semantics: { mode: 'P2E', pinnedAt: 1, semanticsVersion: 'p2e-v1' },
    lastDecisionProvenance: 'LEGACY_UNAVAILABLE',
    lastCurrentObservation: { kind: 'none' },
    occurrenceCounter: 3,
    recordVersion: 'record-v1',
    persistedAt: 2,
  };
}

function capability(legacy: PersistedSessionState | null = null) {
  let owner: PersistedSessionState | null | undefined;
  let exists = true;
  const otherOwner = { summary: 'retain' };
  const port: P2ESessionMetadataCapability = {
    async read() {
      if (!exists) return null;
      return { persistedSessionState: owner === undefined ? legacy : owner };
    },
    async replace(input) {
      if (!exists) throw new Error('Session not found');
      owner = structuredClone(input.fields.persistedSessionState);
      return { persistedSessionState: structuredClone(owner) };
    },
    async clear() {
      if (!exists) throw new Error('Session not found');
      owner = null;
    },
  };
  return { port, otherOwner, removeSession: () => { exists = false; } };
}

describe('2-E P2E owner durable session store', () => {
  it('publishes and reloads the complete persisted state through the owner capability', async () => {
    const fixture = capability();
    const store = new DurableSessionPersistenceStore(fixture.port);
    const value = state();
    await store.publishOccurrence(value);
    expect(await store.load(value.sessionId)).toEqual(value);
    expect(store.capabilities.p2eAtomicSessionPublication).toBe('supported');
    expect(fixture.otherOwner).toEqual({ summary: 'retain' });
  });

  it('reads legacy state but clear records owner absence and prevents resurrection', async () => {
    const legacy = state();
    const store = new DurableSessionPersistenceStore(capability(legacy).port);
    expect(await store.load(legacy.sessionId)).toEqual(legacy);
    await store.delete(legacy.sessionId);
    expect(await store.load(legacy.sessionId)).toBeNull();
    expect(await store.exists(legacy.sessionId)).toBe(true);
  });

  it('preserves missing-session behavior without a generic repository dependency', async () => {
    const fixture = capability();
    fixture.removeSession();
    const store = new DurableSessionPersistenceStore(fixture.port);
    expect(await store.exists('missing')).toBe(false);
    await expect(store.save(state('missing'))).rejects.toThrow('Session missing not found in repository');
    await expect(store.delete('missing')).resolves.toBeUndefined();
  });
});
