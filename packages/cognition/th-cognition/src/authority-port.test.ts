import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CognitiveEngine } from './cognitive-engine.js';
import type { CognitionLearnedEntityPort } from './authority-port.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('2-C learned-entity/control-state partition', () => {
  it('uses the authority port without reading or writing learned-entity files', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'th-p6-c-cognition-'));
    directories.push(directory);
    const port: CognitionLearnedEntityPort = {
      retrieveForSession: vi.fn(async () => ({
        relevantEpisodes: [], relevantKnowledge: [], relevantProcedures: [], summary: 'authority experience',
      })),
      recordSession: vi.fn(async () => {}),
    };
    const engine = new CognitiveEngine({ storagePath: directory, learnedEntityPort: port,
      siteId: 'site-1', sessionId: 'session-1', sessionTimestamp: 1 });

    expect((await engine.onSessionStart('https://example.com', 'smoke')).prompt).toContain('authority experience');
    engine.onAfterAction('click', {}, true, {});
    await engine.onSessionEnd('https://example.com', 'success', [], []);

    expect(port.retrieveForSession).toHaveBeenCalledWith(expect.objectContaining({ siteId: 'site-1', sessionId: 'session-1' }));
    expect(port.recordSession).toHaveBeenCalledWith(expect.objectContaining({ siteId: 'site-1', sessionId: 'session-1' }));
    for (const learned of ['episodes.json', 'semantic.json', 'procedures.json']) {
      expect(fs.existsSync(path.join(directory, learned))).toBe(false);
    }
    expect(fs.existsSync(path.join(directory, 'q-values.json'))).toBe(true);
  });

  it('requires explicit site and session scope for an authority port', () => {
    const port = { retrieveForSession: vi.fn(), recordSession: vi.fn() } as CognitionLearnedEntityPort;
    expect(() => new CognitiveEngine({ learnedEntityPort: port })).toThrow('explicit siteId, sessionId, and sessionTimestamp');
  });
});
