/**
 * SiteProfile projection store — derived, rebuildable SmartLocator cache.
 *
 * Files are not SiteProfile authority. Their names derive from complete
 * canonical origins and they may be deleted/rebuilt without changing authority.
 *
 * Phase 2 of the generalization layer: the SmartLocator auto-learns
 * selectors during a session. This store persists them across sessions
 * so the next run starts with Level 1 cache hits instead of cold starts.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { normalizeCanonicalOrigin } from '@test-harness/th-core';
import type { CachedElement } from "./site-profile.js";

/** Default directory for site profile storage */
const DEFAULT_DIR = ".site-profiles";

/** On-disk format for a site profile cache */
export interface SiteProfileData {
  name: string;
  baseUrl: string;
  elementCache: CachedElement[];
  updatedAt: number;
  canonicalOriginKey?: string;
}

export interface SiteProfileProjection {
  readonly canonicalOriginKey: string;
  readonly name: string;
  readonly elementCache: readonly CachedElement[];
  readonly projectedAt: string;
}

/** Complete canonical origins are encoded as one deterministic file segment. */
export function siteProfileProjectionFileName(rawOrigin: string): string {
  return `${encodeURIComponent(normalizeCanonicalOrigin(rawOrigin))}.json`;
}

export function readSiteProfileProjection(rawOrigin: string, baseDir?: string): SiteProfileProjection | null {
  const canonicalOriginKey = normalizeCanonicalOrigin(rawOrigin);
  const filePath = join(baseDir ?? DEFAULT_DIR, siteProfileProjectionFileName(canonicalOriginKey));
  if (!existsSync(filePath)) return null;
  try {
    const value = JSON.parse(readFileSync(filePath, 'utf8')) as SiteProfileProjection;
    if (normalizeCanonicalOrigin(value.canonicalOriginKey) !== canonicalOriginKey
      || !Array.isArray(value.elementCache) || typeof value.name !== 'string'
      || typeof value.projectedAt !== 'string' || !Number.isFinite(Date.parse(value.projectedAt))) return null;
    return value;
  } catch {
    return null;
  }
}

/** One-way authority-derived projection/cache writer. It never reads or mutates authority. */
export function writeSiteProfileProjection(data: SiteProfileProjection, baseDir?: string): void {
  const canonicalOriginKey = normalizeCanonicalOrigin(data.canonicalOriginKey);
  if (!Array.isArray(data.elementCache) || typeof data.name !== 'string' || !data.name.trim()
    || !Number.isFinite(Date.parse(data.projectedAt))) {
    throw new TypeError('Invalid SiteProfile projection');
  }
  const dir = baseDir ?? DEFAULT_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const projection: SiteProfileProjection = {
    canonicalOriginKey,
    name: data.name,
    elementCache: structuredClone(data.elementCache),
    projectedAt: data.projectedAt,
  };
  writeFileSync(join(dir, siteProfileProjectionFileName(canonicalOriginKey)), JSON.stringify(projection, null, 2), 'utf8');
}

/**
 * Load a site profile cache from disk.
 * Returns null if no cache exists for this URL.
 */
export function loadSiteProfile(
  targetUrl: string,
  baseDir?: string
): SiteProfileData | null {
  const projection = readSiteProfileProjection(targetUrl, baseDir);
  return projection ? {
    name: projection.name,
    baseUrl: projection.canonicalOriginKey,
    canonicalOriginKey: projection.canonicalOriginKey,
    elementCache: [...projection.elementCache],
    updatedAt: Date.parse(projection.projectedAt),
  } : null;
}

/**
 * Save a site profile cache to disk.
 * Creates the directory if it doesn't exist.
 */
export function saveSiteProfile(
  data: SiteProfileData,
  baseDir?: string
): void {
  const canonicalOriginKey = normalizeCanonicalOrigin(data.canonicalOriginKey ?? data.baseUrl);
  writeSiteProfileProjection({
    canonicalOriginKey,
    name: data.name,
    elementCache: data.elementCache,
    projectedAt: new Date(data.updatedAt).toISOString(),
  }, baseDir);
}

/**
 * Extract the element cache from a browser provider and save it.
 * Called after a session completes to persist learned selectors.
 */
export function persistSiteCache(
  targetUrl: string,
  cache: CachedElement[],
  baseDir?: string
): void {
  if (cache.length === 0) return;

  const existing = loadSiteProfile(targetUrl, baseDir);
  const data: SiteProfileData = {
    name: existing?.name ?? new URL(normalizeCanonicalOrigin(targetUrl)).hostname,
    baseUrl: normalizeCanonicalOrigin(targetUrl),
    canonicalOriginKey: normalizeCanonicalOrigin(targetUrl),
    elementCache: cache,
    updatedAt: Date.now(),
  };
  saveSiteProfile(data, baseDir);
}

/**
 * Load the element cache for a target URL.
 * Returns the CachedElement array (empty if no prior cache).
 */
export function loadSiteCache(
  targetUrl: string,
  baseDir?: string
): CachedElement[] {
  const data = loadSiteProfile(targetUrl, baseDir);
  return data?.elementCache ?? [];
}
