import type { CanonicalOriginKey } from './canonical-origin.js';
import {
  normalizeCanonicalOrigin,
  readLegacyHostname,
  tryNormalizeCanonicalOrigin,
} from './canonical-origin.js';
import {
  analyzeCanonicalMappings,
  type CanonicalMappingCandidate,
  type MappingAnalysis,
} from './mapping-analysis.js';

export interface LegacySiteProfileOriginInput {
  readonly legacyId: string;
  readonly rawOrigin: string;
}

export interface SiteProfileOriginMapping extends CanonicalMappingCandidate {
  readonly legacyId: string;
  readonly rawOrigin: string;
  readonly candidates: readonly CanonicalOriginKey[];
  readonly canonicalOrigin: CanonicalOriginKey | null;
}

export interface SiteProfileOriginMappingReport {
  readonly mappings: readonly SiteProfileOriginMapping[];
  readonly analysis: MappingAnalysis;
}

function candidatesForLegacyHostname(rawOrigin: string): CanonicalOriginKey[] {
  const legacy = readLegacyHostname(rawOrigin);
  if (!legacy) return [];

  return ['http', 'https']
    .map((scheme) => tryNormalizeCanonicalOrigin(`${scheme}://${legacy.hostname}`))
    .filter((candidate): candidate is CanonicalOriginKey => candidate !== null);
}

/** Map existing profile values without selecting an origin for ambiguous hostnames. */
export function mapLegacySiteProfileOrigins(
  rows: readonly LegacySiteProfileOriginInput[],
): SiteProfileOriginMappingReport {
  const mappings = rows.map((row): SiteProfileOriginMapping => {
    const canonicalOrigin = tryNormalizeCanonicalOrigin(row.rawOrigin);
    const candidates = canonicalOrigin
      ? [canonicalOrigin]
      : candidatesForLegacyHostname(row.rawOrigin);

    return {
      sourceId: row.legacyId,
      legacyId: row.legacyId,
      rawOrigin: row.rawOrigin,
      canonicalKey: canonicalOrigin,
      candidates,
      canonicalOrigin,
    };
  });

  return {
    mappings,
    analysis: analyzeCanonicalMappings(mappings),
  };
}

export interface ExplicitSiteProfileOriginResolution {
  readonly legacyId: string;
  readonly canonicalOrigin: string;
}

/** Apply only explicit in-memory choices; this performs no persistence or merge. */
export function applyExplicitSiteProfileOriginResolutions(
  report: SiteProfileOriginMappingReport,
  resolutions: readonly ExplicitSiteProfileOriginResolution[],
): SiteProfileOriginMappingReport {
  const knownIds = new Set(report.mappings.map((mapping) => mapping.legacyId));
  const resolutionById = new Map<string, ExplicitSiteProfileOriginResolution>();
  for (const resolution of resolutions) {
    if (!knownIds.has(resolution.legacyId)) {
      throw new TypeError(`Resolution references unknown legacy SiteProfile ${resolution.legacyId}`);
    }
    if (resolutionById.has(resolution.legacyId)) {
      throw new TypeError(`Multiple resolutions supplied for ${resolution.legacyId}`);
    }
    resolutionById.set(resolution.legacyId, resolution);
  }

  const mappings = report.mappings.map((mapping) => {
    const resolution = resolutionById.get(mapping.legacyId);
    if (!resolution) return mapping;

    // Generated candidates describe the ambiguity found in legacy input; they
    // are not an allowlist for an evidence-backed operator decision. The
    // shared normalizer remains the authority for whether that decision is a
    // valid canonical origin, including non-default ports and preserved hosts.
    const canonicalOrigin = normalizeCanonicalOrigin(resolution.canonicalOrigin);

    return {
      ...mapping,
      canonicalKey: canonicalOrigin,
      canonicalOrigin,
    };
  });

  return { mappings, analysis: analyzeCanonicalMappings(mappings) };
}
