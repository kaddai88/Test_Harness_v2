import { defineService } from '@test-harness/th-core';
import type { CachedElement } from './site-profile.js';

export interface SiteProfileCapabilityRecord {
  readonly id: string;
  readonly canonicalOrigin: string;
  readonly name: string;
  readonly elementCache: readonly CachedElement[];
  readonly testCount: number;
  readonly lastTestedAt: string | null;
  readonly updatedAt: string;
}

export interface SiteProfileCapabilityBinding {
  readonly profileId: string;
  readonly canonicalOrigin: string;
  readonly sessionId: string;
}

/** Session-bound capability; persistence remains behind privileged composition. */
export interface SiteProfileCapability {
  readonly binding: SiteProfileCapabilityBinding;
  read(): Promise<SiteProfileCapabilityRecord>;
  updateName(name: string, idempotencyKey: string): Promise<SiteProfileCapabilityRecord>;
  replaceLocatorCache(entries: readonly CachedElement[], idempotencyKey: string): Promise<SiteProfileCapabilityRecord>;
}

export const SiteProfileCapabilityDefinition =
  defineService<SiteProfileCapability>('SiteProfileCapability');
