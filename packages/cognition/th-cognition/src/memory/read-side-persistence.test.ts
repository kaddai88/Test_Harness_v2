import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EpisodicMemory } from './episodic-memory.js';
import { SemanticMemory } from './semantic-memory.js';
import { ProceduralMemory } from './procedural-memory.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function file(name: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `th-p6-e-${name}-`));
  directories.push(directory);
  return path.join(directory, `${name}.json`);
}

describe('2-E Cognition read-side persistence', () => {
  it('keeps episodic recall/search statistics derived without saving them', () => {
    const storage = file('episodes');
    const memory = new EpisodicMemory(storage);
    const id = memory.store({
      type: 'session_summary', timestamp: 1, sessionId: 'session-1', targetUrl: 'https://example.com',
      description: 'done', actions: [], outcome: 'success', tags: [], confidence: 1,
    });
    const before = fs.readFileSync(storage, 'utf8');
    expect(memory.recall(id)?.accessCount).toBe(1);
    expect(memory.search({ targetUrl: 'https://example.com' })).toHaveLength(1);
    expect(fs.readFileSync(storage, 'utf8')).toBe(before);
  });

  it('keeps semantic get usage statistics derived without saving them', () => {
    const storage = file('semantic');
    const memory = new SemanticMemory(storage);
    const id = memory.store({
      type: 'best_practice', timestamp: 1, title: 'Title', description: 'Description', content: {},
      sourceEpisodes: [], confidence: 1, verificationCount: 0, tags: [],
    });
    const before = fs.readFileSync(storage, 'utf8');
    expect(memory.get(id)?.useCount).toBe(1);
    expect(fs.readFileSync(storage, 'utf8')).toBe(before);
  });

  it('keeps procedural search free of durable writes', () => {
    const storage = file('procedures');
    const memory = new ProceduralMemory(storage);
    memory.store({
      type: 'testing_strategy', timestamp: 1, name: 'Test', description: 'Description', steps: [],
      preconditions: [], triggers: [], tags: [], confidence: 1,
    });
    const before = fs.readFileSync(storage, 'utf8');
    expect(memory.search({ type: 'testing_strategy' })).toHaveLength(1);
    expect(fs.readFileSync(storage, 'utf8')).toBe(before);
  });
});
