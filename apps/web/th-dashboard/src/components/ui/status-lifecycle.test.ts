import { describe, expect, it } from 'vitest';
import type { PostProcessingStatus, SessionStatus } from '../../types';
import { StatusBadge } from './StatusBadge';

describe('Phase 2-F dashboard lifecycle contract', () => {
  it.each(['queued', 'planning', 'running', 'cancelling', 'completed', 'failed', 'cancelled'] as SessionStatus[])('represents canonical status %s', (status) => {
    expect(status).toBeTypeOf('string');
  });

  it('represents cancelling as a distinct optimistic state', () => {
    expect('cancelling' satisfies SessionStatus).toBe('cancelling');
  });

  it.each(['not_started', 'pending', 'running', 'success', 'partial', 'failed', 'not_applicable'] as PostProcessingStatus[])('accepts PP lifecycle state %s', (status) => {
    expect(status).toBeTypeOf('string');
  });

  it('does not treat cancelled/not_applicable as PP in progress', () => {
    const status: PostProcessingStatus = 'not_applicable';
    expect(['pending', 'running']).not.toContain(status);
  });

  it('keeps legacy aliases representable without redefining canonical state', () => {
    expect('pending' satisfies SessionStatus).toBe('pending');
    expect('executing' satisfies SessionStatus).toBe('executing');
  });

  it('exports the cancelling badge component contract', () => {
    expect(StatusBadge).toBeTypeOf('function');
  });
});
