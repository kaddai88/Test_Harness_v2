/**
 * Regression tests for P2: log level layering.
 *
 * Principle: never delete diagnostic capability, only lower default visibility.
 *   - INFO (default): core 7 categories [STATE][SURFACE][TARGET][PLAN][ACTION][COVERAGE][EXIT]
 *   - DEBUG (TH_LOG_LEVEL=debug): raw snapshots, prompts, planner internals
 *
 * These tests verify the default logger respects TH_LOG_LEVEL.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('P2: agent logger level filtering', () => {
  const logLines: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    logLines.length = 0;
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logLines.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      logLines.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.TH_LOG_LEVEL;
  });

  it('INFO level (default): debug() output is suppressed, info() is emitted', async () => {
    delete process.env.TH_LOG_LEVEL;
    const { defaultLogger } = await import('./loop.js');

    defaultLogger.info('[TARGET] feat_13 "搜索框" intent=0.80');
    defaultLogger.debug('[PLAN]   - raw step detail that should be hidden');
    defaultLogger.warn('[STATE] something warnings-worthy');

    const joined = logLines.join('\n');
    expect(joined).toContain('[TARGET]');
    expect(joined).toContain('[STATE]');
    expect(joined).not.toContain('raw step detail');
  });

  it('DEBUG level (TH_LOG_LEVEL=debug): debug() output is emitted', async () => {
    process.env.TH_LOG_LEVEL = 'debug';
    const { defaultLogger } = await import('./loop.js');

    defaultLogger.debug('[COVERAGE] raw snapshot diagnostics');
    defaultLogger.info('[ACTION] browser_click → feat_1');

    const joined = logLines.join('\n');
    expect(joined).toContain('raw snapshot diagnostics');
    expect(joined).toContain('[ACTION]');
  });

  it('debug capability is never deleted — same logger object handles both levels', async () => {
    delete process.env.TH_LOG_LEVEL;
    const { defaultLogger } = await import('./loop.js');

    // Both methods exist (API not removed, only visibility filtered)
    expect(typeof defaultLogger.debug).toBe('function');
    expect(typeof defaultLogger.info).toBe('function');
    expect(typeof defaultLogger.warn).toBe('function');
    expect(typeof defaultLogger.error).toBe('function');
  });
});
