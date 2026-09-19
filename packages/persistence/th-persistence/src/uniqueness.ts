export class CanonicalUniquenessError extends Error {
  readonly key: string;
  readonly sourceIds: readonly string[];

  constructor(key: string, sourceIds: readonly string[]) {
    super(`Canonical key ${key} is not unique for source rows: ${sourceIds.join(', ')}`);
    this.name = 'CanonicalUniquenessError';
    this.key = key;
    this.sourceIds = sourceIds;
  }
}

/** Enforce the post-backfill uniqueness invariant; nullish values remain legacy-compatible. */
export function assertUniqueCanonicalValues<T>(
  rows: readonly T[],
  getKey: (row: T) => string | null | undefined,
  getSourceId: (row: T) => string,
): void {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const key = getKey(row);
    if (key === null || key === undefined) continue;
    const sourceIds = groups.get(key) ?? [];
    sourceIds.push(getSourceId(row));
    groups.set(key, sourceIds);
  }

  for (const [key, sourceIds] of groups) {
    if (sourceIds.length > 1) {
      throw new CanonicalUniquenessError(key, [...sourceIds].sort());
    }
  }
}
