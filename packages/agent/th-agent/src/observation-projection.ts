/**
 * P2-E Observation Content Projection (I2)
 *
 * Implements the normative observation projection contract from P2-E-IDENTITY-SEMANTICS.md.
 *
 * Core invariant: Hash input == normative observation projection
 * - The observation projection and its identity are one artifact with two representations
 * - What the model sees MUST be what the hash reflects
 * - No hidden normalization that differs from model-visible content
 *
 * This is a new implementation that replaces the legacy normalizeSnapshot/computeSnapshotHash
 * approach. The old approach used regex-based normalization which doesn't distinguish field
 * semantics and may remove content still visible to the model.
 *
 * Phase 1a scope:
 * - Observation envelope construction
 * - Field-aware observation projection (initial version)
 * - Observation normalization contract v1
 * - Observation content hash
 * - ObservationContentIdentity construction
 * - Observation-domain comparison
 * - C2 conformance coverage
 *
 * NOT in scope (deferred to later tasks):
 * - Occurrence allocation (I4)
 * - Current observation transitions (I4/I7)
 * - Structural evidence computation (I3)
 * - Decision provenance capture (I6)
 */

import { createHash } from 'node:crypto';
import type { ObservationContentIdentity } from './identity-semantics.js';

// ─── Observation Envelope ────────────────────────────────────────────────────

/**
 * Observation envelope - the canonical model-visible payload
 *
 * Contains all fields that the model can see. The hash is computed from
 * this envelope to ensure identity reflects model-visible content.
 */
export interface ObservationEnvelope {
  /** Typed outcome: 'complete', 'empty', or 'partial' */
  outcome: 'complete' | 'empty' | 'partial';
  /** Canonical snapshot body (including action-addressing refs) */
  snapshotBody: string;
  /** Canonical effective document location (origin + path + semantic query/fragment) */
  effectiveLocation: string;
  /** Browsing context identity (page/tab/frame scope) */
  browsingContext: string;
  /** Ref namespace metadata (for interpreting action addresses) */
  refNamespace: string;
  /** Completeness metadata (for partial observations) */
  completenessMetadata?: string;
}

// ─── Field Classification ────────────────────────────────────────────────────

/**
 * Field class for schema/field-semantic classification
 *
 * Determines how a field is handled in observation vs structural projection.
 * This is the foundation for field-aware normalization.
 */
export type FieldClass =
  | 'canonical_origin'
  | 'url_path'
  | 'semantic_query'
  | 'tracking_query'
  | 'semantic_fragment'
  | 'non_semantic_fragment'
  | 'unknown_url_component'
  | 'action_ref'
  | 'semantic_entity_id'
  | 'ordinary_record_id'
  | 'framework_runtime_id'
  | 'session_transport_id'
  | 'unknown_identifier'
  | 'identity_bearing_label'
  | 'ordinary_body_text'
  | 'user_input_value'
  | 'business_data'
  | 'business_state_date'
  | 'generated_timestamp'
  | 'unknown_visible_value'
  | 'semantic_order'
  | 'unordered_collection'
  | 'paint_order'
  | 'unknown_order';

/**
 * Observation projection policy for a field class
 */
export type ObservationProjectionPolicy =
  | 'include_exactly'      // Include exactly as-is
  | 'include_canonical'    // Include with canonical form
  | 'remove'               // Remove from observation
  | 'include_conservative'; // Include conservatively (prevent false equality)

/**
 * Field classification result
 */
export interface FieldClassification {
  fieldClass: FieldClass;
  policy: ObservationProjectionPolicy;
  confidence: 'high' | 'medium' | 'low';
}

// ─── Field Classifier ────────────────────────────────────────────────────────

/**
 * Classify a field based on schema/field-semantic rules
 *
 * This is the foundation for field-aware observation projection.
 * Uses conservative defaults to prevent false equality.
 *
 * Phase 1a: Initial implementation with basic heuristics.
 * Future phases will integrate with the full schema-driven classifier.
 */
export function classifyField(
  fieldName: string,
  fieldValue: string,
  context: { inUrl?: boolean; inSnapshot?: boolean }
): FieldClassification {
  // Action-addressing refs (e.g., [ref=e37])
  // Observation: include exactly
  // Structural: exclude
  if (fieldName === 'ref' || /\[ref=[^\]]+\]/.test(fieldValue)) {
    return {
      fieldClass: 'action_ref',
      policy: 'include_exactly',
      confidence: 'high',
    };
  }

  // URL fields
  if (context.inUrl) {
    // Tracking/telemetry query parameters
    if (fieldName.startsWith('utm_') || fieldName === 'fbclid' || fieldName === 'gclid') {
      return {
        fieldClass: 'tracking_query',
        policy: 'remove',
        confidence: 'high',
      };
    }

    // Session/transport identifiers
    if (fieldName === 'session_id' || fieldName === 'sessionId' || fieldName === 'token') {
      return {
        fieldClass: 'session_transport_id',
        policy: 'remove',
        confidence: 'high',
      };
    }

    // Semantic query parameters (default for unknown)
    return {
      fieldClass: 'semantic_query',
      policy: 'include_exactly',
      confidence: 'medium',
    };
  }

  // Snapshot fields
  if (context.inSnapshot) {
    // Identity-bearing labels (roles, headings, tabs, forms, actions)
    if (
      fieldName === 'role' ||
      fieldName === 'heading' ||
      fieldName === 'tab' ||
      fieldName === 'label' ||
      fieldName === 'action'
    ) {
      return {
        fieldClass: 'identity_bearing_label',
        policy: 'include_exactly',
        confidence: 'high',
      };
    }

    // Generated timestamps (e.g., generatedAt, createdAt)
    if (fieldName === 'generatedAt' || fieldName === 'createdAt' || fieldName === 'updatedAt') {
      return {
        fieldClass: 'generated_timestamp',
        policy: 'remove',
        confidence: 'high',
      };
    }

    // Framework/runtime identifiers (e.g., data-reactid, data-v-)
    if (fieldName.startsWith('data-reactid') || fieldName.startsWith('data-v-')) {
      return {
        fieldClass: 'framework_runtime_id',
        policy: 'remove',
        confidence: 'high',
      };
    }

    // Unknown fields: include conservatively to prevent false equality
    return {
      fieldClass: 'unknown_visible_value',
      policy: 'include_conservative',
      confidence: 'low',
    };
  }

  // Default: include conservatively
  return {
    fieldClass: 'unknown_visible_value',
    policy: 'include_conservative',
    confidence: 'low',
  };
}

// ─── Observation Projection ──────────────────────────────────────────────────

/**
 * Construct observation envelope from raw observation
 *
 * This is the authoritative P2E observation projection. The hash is computed from
 * this envelope to ensure identity reflects the projection.
 *
 * IMPORTANT: This establishes the normative P2E projection. All future P2E model-visible
 * serialization MUST derive from this projection without semantic divergence.
 *
 * Runtime model-request equivalence is deferred to the consumer cutover milestone.
 * The runtime invariant "hash input == what the model actually receives" will be
 * established when model-request consumers migrate to use this projection.
 *
 * Phase 1a: Initial implementation with basic envelope construction.
 * Future phases will integrate with the full field-aware classifier.
 */
export function constructObservationEnvelope(
  rawSnapshot: string,
  url: string,
  outcome: 'complete' | 'empty' | 'partial',
  browsingContext: string = 'default'
): ObservationEnvelope {
  // Parse URL to extract canonical effective location
  const effectiveLocation = canonicalizeUrl(url);

  // Extract ref namespace (for now, use a simple heuristic)
  const refNamespace = extractRefNamespace(rawSnapshot);

  // Snapshot body is the raw snapshot (including refs)
  // IMPORTANT: No modification is applied to snapshotBody. The field-aware classifier
  // (classifyField) is defined but not applied to snapshotBody in Phase 1a.
  // This ensures there is no hash-only normalization that differs from what the model sees.
  // Future phases will apply field-aware projection when the full schema-driven classifier
  // is integrated, but any transformation will simultaneously update the model-visible
  // projection to maintain the invariant: hash input == model-visible content.
  const snapshotBody = rawSnapshot;

  return {
    outcome,
    snapshotBody,
    effectiveLocation,
    browsingContext,
    refNamespace,
  };
}

/**
 * Canonicalize URL for observation envelope
 *
 * Removes tracking/telemetry parameters while preserving semantic query/fragment.
 * Uses conservative approach: unknown parameters are preserved.
 *
 * URL query parameter order is preserved (not sorted) per conservative policy.
 * The approved URL policy does not explicitly classify query parameter order as non-semantic,
 * so the current implementation preserves insertion order to prevent false equality.
 * If future policy revision classifies query order as non-semantic, this function should
 * be updated to sort query parameters.
 */
export function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);

    // Remove tracking/telemetry parameters
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'];
    trackingParams.forEach(param => parsed.searchParams.delete(param));

    // Reconstruct URL with canonical form
    // Note: URL.toString() preserves query parameter insertion order
    // This is consistent with conservative policy (preserve order unless explicitly non-semantic)
    return parsed.toString();
  } catch {
    // If URL parsing fails, return as-is
    return url;
  }
}

/**
 * Extract ref namespace from snapshot
 *
 * Phase 1a: Simple heuristic to detect ref format.
 * Future phases will integrate with the full ref namespace tracking.
 */
export function extractRefNamespace(snapshot: string): string {
  // Detect if snapshot uses Playwright-style refs (e.g., [ref=e37])
  if (/\[ref=[^\]]+\]/.test(snapshot)) {
    return 'playwright';
  }
  return 'unknown';
}

// ─── Observation Content Hash ────────────────────────────────────────────────

/**
 * Compute observation content hash from envelope
 *
 * The hash is computed from the canonical envelope to ensure identity reflects
 * what the model sees. This is the core invariant of P2-E observation projection.
 *
 * Phase 1a: Hash the entire envelope as JSON.
 * Future phases may optimize with field-specific hashing.
 */
export function computeObservationContentHash(envelope: ObservationEnvelope): string {
  // Serialize envelope to canonical JSON
  const canonical = JSON.stringify(envelope, Object.keys(envelope).sort());

  // Compute SHA-256 hash
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 12);
}

// ─── ObservationContentIdentity Construction ─────────────────────────────────

/**
 * Construct ObservationContentIdentity from envelope
 *
 * This is the authoritative construction that produces the observation content identity.
 * The identity reflects what the model sees, not some hidden normalization.
 */
export function constructObservationContentIdentity(
  envelope: ObservationEnvelope,
  contractVersion: string = 'v1'
): ObservationContentIdentity {
  const contentHash = computeObservationContentHash(envelope);

  return {
    contractVersion,
    contentHash,
  };
}

// ─── Observation-Domain Comparison ───────────────────────────────────────────

/**
 * Compare two observation content identities
 *
 * Three-valued comparison:
 * - SAME: same contract + same hash
 * - DIFFERENT: same contract + different hash
 * - NOT_COMPARABLE: different/unknown contract
 *
 * Contract version must participate in identity semantics.
 * Different contracts cannot be compared even if hashes match.
 */
export function compareObservationContentIdentities(
  a: ObservationContentIdentity,
  b: ObservationContentIdentity
): { result: 'SAME' | 'DIFFERENT' | 'NOT_COMPARABLE'; reason?: 'contract' } {
  // Check contract compatibility first
  if (a.contractVersion !== b.contractVersion) {
    return {
      result: 'NOT_COMPARABLE',
      reason: 'contract',
    };
  }

  // Same contract: compare hashes
  if (a.contentHash === b.contentHash) {
    return { result: 'SAME' };
  }

  return { result: 'DIFFERENT' };
}

// ─── C2 Conformance Helpers ──────────────────────────────────────────────────

/**
 * Helper for C2 conformance test: construct identity from raw observation
 *
 * This is a convenience function for testing. Production code should use
 * constructObservationEnvelope + constructObservationContentIdentity.
 */
export function constructObservationContentIdentityFromRaw(
  rawSnapshot: string,
  url: string,
  outcome: 'complete' | 'empty' | 'partial' = 'complete',
  contractVersion: string = 'v1'
): ObservationContentIdentity {
  const envelope = constructObservationEnvelope(rawSnapshot, url, outcome);
  return constructObservationContentIdentity(envelope, contractVersion);
}
