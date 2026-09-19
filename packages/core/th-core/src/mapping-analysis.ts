export type MappingClassification =
  | 'zero-collision'
  | 'one-to-one'
  | 'many-to-one'
  | 'ambiguous';

export interface CanonicalMappingCandidate {
  readonly sourceId: string;
  readonly canonicalKey: string | null;
  readonly candidates?: readonly string[];
}

export interface MappingCollisionGroup {
  readonly canonicalKey: string;
  readonly sourceIds: readonly string[];
}

export interface MappingDiagnostic {
  readonly code: 'duplicate-source' | 'unresolved' | 'collision';
  readonly sourceIds: readonly string[];
  readonly message: string;
}

export interface MappingAnalysis {
  readonly classification: MappingClassification;
  readonly blocked: boolean;
  readonly collisionGroups: readonly MappingCollisionGroup[];
  readonly unresolvedSourceIds: readonly string[];
  readonly diagnostics: readonly MappingDiagnostic[];
}

/** Classify mappings without choosing a winner or mutating any source data. */
export function analyzeCanonicalMappings(
  input: readonly CanonicalMappingCandidate[],
): MappingAnalysis {
  const mappings = [...input].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  const sourceGroups = new Map<string, string[]>();
  const canonicalGroups = new Map<string, string[]>();
  const unresolvedSourceIds: string[] = [];

  for (const mapping of mappings) {
    const sourceIds = sourceGroups.get(mapping.sourceId) ?? [];
    sourceIds.push(mapping.sourceId);
    sourceGroups.set(mapping.sourceId, sourceIds);

    if (!mapping.canonicalKey) {
      unresolvedSourceIds.push(mapping.sourceId);
      continue;
    }

    const canonicalSourceIds = canonicalGroups.get(mapping.canonicalKey) ?? [];
    canonicalSourceIds.push(mapping.sourceId);
    canonicalGroups.set(mapping.canonicalKey, canonicalSourceIds);
  }

  const duplicateSourceIds = [...sourceGroups.entries()]
    .filter(([, sourceIds]) => sourceIds.length > 1)
    .map(([sourceId]) => sourceId)
    .sort();

  const collisionGroups = [...canonicalGroups.entries()]
    .filter(([, sourceIds]) => sourceIds.length > 1)
    .map(([canonicalKey, sourceIds]) => ({
      canonicalKey,
      sourceIds: [...sourceIds].sort(),
    }))
    .sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey));

  const diagnostics: MappingDiagnostic[] = [];
  if (duplicateSourceIds.length > 0) {
    diagnostics.push({
      code: 'duplicate-source',
      sourceIds: duplicateSourceIds,
      message: 'A source record appears more than once in the mapping input',
    });
  }
  for (const sourceId of unresolvedSourceIds) {
    const mapping = mappings.find((candidate) => candidate.sourceId === sourceId);
    diagnostics.push({
      code: 'unresolved',
      sourceIds: [sourceId],
      message: mapping?.candidates && mapping.candidates.length > 0
        ? `Canonical mapping requires explicit resolution among: ${mapping.candidates.join(', ')}`
        : 'Canonical mapping could not be derived from the existing record',
    });
  }
  for (const group of collisionGroups) {
    diagnostics.push({
      code: 'collision',
      sourceIds: group.sourceIds,
      message: `Multiple source records map to canonical key ${group.canonicalKey}`,
    });
  }

  let classification: MappingClassification;
  if (mappings.length === 0) {
    classification = 'zero-collision';
  } else if (duplicateSourceIds.length > 0 || unresolvedSourceIds.length > 0) {
    classification = 'ambiguous';
  } else if (collisionGroups.length > 0) {
    classification = 'many-to-one';
  } else {
    classification = 'one-to-one';
  }

  return {
    classification,
    blocked: classification !== 'zero-collision' && classification !== 'one-to-one',
    collisionGroups,
    unresolvedSourceIds: [...unresolvedSourceIds].sort(),
    diagnostics,
  };
}
