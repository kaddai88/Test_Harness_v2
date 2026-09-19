import { createHash } from 'node:crypto';

export type CognitionEntityKind = 'episode' | 'knowledge' | 'procedure' | 'pattern';

/** Explicit scope for a cognition identity. Session scope is never implicit. */
export type CognitionScope =
  | { readonly kind: 'site'; readonly siteId: string }
  | { readonly kind: 'global' }
  | { readonly kind: 'session'; readonly sessionId: string };

export interface CanonicalCognitionEntityIdentity {
  readonly kind: CognitionEntityKind;
  readonly canonicalId: string;
}

/** A producer event, kept separate from the logical entity identity. */
export interface CognitionSourceOccurrenceIdentity {
  readonly sourceOccurrenceId: string;
  readonly producerIdentity: string;
  readonly sessionId: string | null;
}

export interface LegacyCognitionId {
  readonly kind: 'legacy-cognition-id';
  readonly value: string;
}

/** Provenance may be attached to an entity without changing its canonical ID. */
export interface CognitionProvenance {
  readonly occurrence: CognitionSourceOccurrenceIdentity;
  readonly legacyId?: LegacyCognitionId;
}

export interface CognitionPatternIdentityInput {
  readonly scope: CognitionScope;
  readonly type: string;
  readonly description: string;
  /** Canonically serialized tags; array order remains semantically significant. */
  readonly tagsKey: string;
}

export type CognitionIdentityInput =
  | {
      readonly kind: 'episode';
      readonly scope: CognitionScope;
      readonly occurrenceId: string;
    }
  | {
      readonly kind: 'knowledge';
      readonly scope: CognitionScope;
      readonly subject: string;
      readonly contentKey: string;
    }
  | {
      readonly kind: 'procedure';
      readonly scope: CognitionScope;
      readonly subject: string;
      readonly stepKey: string;
    }
  | {
      readonly kind: 'pattern';
      readonly scope: CognitionScope;
      readonly patternKey: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requiredToken(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function encodePatternTuple(fields: readonly string[]): string {
  return `pattern:v1:${fields.map((field) => `${field.length}:${field}`).join('')}`;
}

/** Validate and copy a scope so callers cannot smuggle an implicit target. */
export function validateCognitionScope(input: unknown): CognitionScope {
  if (!isRecord(input) || typeof input.kind !== 'string') {
    throw new TypeError('Cognition scope must declare a kind');
  }

  switch (input.kind) {
    case 'site':
      return { kind: 'site', siteId: requiredToken(input.siteId, 'siteId') };
    case 'global':
      return { kind: 'global' };
    case 'session':
      return { kind: 'session', sessionId: requiredToken(input.sessionId, 'sessionId') };
    default:
      throw new TypeError(`Unsupported cognition scope: ${input.kind}`);
  }
}

/** Validate untrusted identity input before deriving a canonical ID. */
export function validateCognitionIdentityInput(input: unknown): CognitionIdentityInput {
  if (!isRecord(input) || typeof input.kind !== 'string') {
    throw new TypeError('Cognition identity input must declare a kind');
  }

  const scope = validateCognitionScope(input.scope);
  switch (input.kind) {
    case 'episode':
      return {
        kind: 'episode',
        scope,
        occurrenceId: requiredToken(input.occurrenceId, 'occurrenceId'),
      };
    case 'knowledge':
      return {
        kind: 'knowledge',
        scope,
        subject: requiredToken(input.subject, 'subject'),
        contentKey: requiredToken(input.contentKey, 'contentKey'),
      };
    case 'procedure':
      return {
        kind: 'procedure',
        scope,
        subject: requiredToken(input.subject, 'subject'),
        stepKey: requiredToken(input.stepKey, 'stepKey'),
      };
    case 'pattern':
      return {
        kind: 'pattern',
        scope,
        patternKey: requiredToken(input.patternKey, 'patternKey'),
      };
    default:
      throw new TypeError(`Unsupported cognition entity kind: ${input.kind}`);
  }
}

function identityPayload(input: CognitionIdentityInput): Record<string, unknown> {
  switch (input.kind) {
    case 'episode':
      return { kind: input.kind, scope: input.scope, occurrenceId: input.occurrenceId };
    case 'knowledge':
      return {
        kind: input.kind,
        scope: input.scope,
        subject: input.subject,
        contentKey: input.contentKey,
      };
    case 'procedure':
      return {
        kind: input.kind,
        scope: input.scope,
        subject: input.subject,
        stepKey: input.stepKey,
      };
    case 'pattern':
      return { kind: input.kind, scope: input.scope, patternKey: input.patternKey };
  }
}

/**
 * Derive a deterministic identity from logical entity inputs only.
 * Producer/session provenance is deliberately excluded from this payload.
 */
export function createCognitionEntityIdentity(
  input: CognitionIdentityInput,
): CanonicalCognitionEntityIdentity {
  const valid = validateCognitionIdentityInput(input);
  const payload = JSON.stringify(identityPayload(valid));
  const digest = createHash('sha256').update(payload, 'utf8').digest('hex');
  return {
    kind: valid.kind,
    canonicalId: `cognition:v1:${valid.kind}:${digest}`,
  };
}

/** Build the canonical pattern key from its normalized logical fields. */
export function createCognitionPatternIdentity(
  input: CognitionPatternIdentityInput,
): CanonicalCognitionEntityIdentity {
  const scope = validateCognitionScope(input.scope);
  const type = requiredToken(input.type, 'pattern type');
  const description = requiredToken(input.description, 'pattern description');
  const tagsKey = requiredToken(input.tagsKey, 'pattern tags');

  return createCognitionEntityIdentity({
    kind: 'pattern',
    scope,
    patternKey: encodePatternTuple([type, description, tagsKey]),
  });
}

/** Read a legacy ID as source identity; never reinterpret it as a canonical ID. */
export function readLegacyCognitionId(raw: unknown): LegacyCognitionId | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  return { kind: 'legacy-cognition-id', value: raw.trim() };
}

/** Validate provenance independently from the entity identity. */
export function validateCognitionProvenance(input: unknown): CognitionProvenance {
  if (!isRecord(input) || !isRecord(input.occurrence)) {
    throw new TypeError('Cognition provenance must include an occurrence');
  }

  const occurrence = input.occurrence;
  const sessionId = occurrence.sessionId === null
    ? null
    : requiredToken(occurrence.sessionId, 'sessionId');
  const result: CognitionProvenance = {
    occurrence: {
      sourceOccurrenceId: requiredToken(occurrence.sourceOccurrenceId, 'sourceOccurrenceId'),
      producerIdentity: requiredToken(occurrence.producerIdentity, 'producerIdentity'),
      sessionId,
    },
  };

  if (input.legacyId !== undefined) {
    const legacyId = readLegacyCognitionId(input.legacyId);
    if (!legacyId) throw new TypeError('legacyId must be a non-empty string');
    return { ...result, legacyId };
  }

  return result;
}
