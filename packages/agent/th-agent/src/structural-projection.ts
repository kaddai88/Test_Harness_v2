/**
 * P2-E Structural Projection (I3)
 *
 * Implements the normative structural projection contract from P2-E-IDENTITY-SEMANTICS.md.
 *
 * Core invariants:
 * - Structural projection is INDEPENDENT from observation projection (both fork from raw evidence)
 * - Structural normalization is schema/field-aware, not regex-based
 * - Structural identity is just the hash (not including scope or contract)
 * - StructuralEvidence = contractVersion + completenessScope + structuralIdentity
 * - completenessScope is NOT folded into structural hash or contract version
 * - Observation outcome labels do NOT directly determine structural hash
 *
 * Phase 1a scope:
 * - StructuralProjection construction
 * - StructuralIdentity (hash only)
 * - StructuralEvidence (contract + scope + identity)
 * - C3-C7 conformance coverage
 *
 * NOT in scope (deferred to I5):
 * - StructuralEvidence comparison authority
 * - SAME/DIFFERENT/NOT_COMPARABLE decision logic
 * - scope compatibility predicate
 * - contract incompatibility diagnostics
 */

import { createHash } from 'node:crypto';
import type { StructuralIdentity, StructuralEvidence } from './identity-semantics.js';

// ─── Structural Projection ───────────────────────────────────────────────────

/**
 * Structural projection - the identity-bearing semantic/actionable structure
 *
 * Contains only information whose change can alter the semantic or actionable view:
 * - Interactive roles and availability
 * - Visible/hidden, enabled/disabled, selected/expanded states
 * - Addition or removal of actionable elements
 * - Identity-bearing headings, tabs, navigation landmarks, form labels, table headers, action labels
 * - Semantic route/view state
 * - Order where order communicates workflow, priority, hierarchy, navigation, or relationship
 *
 * Excludes:
 * - Action-addressing refs (observation-only)
 * - Schema-classified framework, session, transport, telemetry, or debug identifiers
 * - Schema-classified generated timestamps and ordinary record values
 * - Explicitly classified tracking or non-semantic URL fields
 * - Presentation-only differences not represented in accessibility/visibility/role/state/order/interaction
 */
export interface StructuralProjection {
  /**
   * Identity-bearing roles (button, link, textbox, etc.) with labels
   * Order: PRESERVED - DOM/accessibility order is structural semantics
   */
  roles: Array<{ role: string; label: string }>;
  /**
   * Identity-bearing headings
   * Order: PRESERVED - document structure order is structural semantics
   */
  headings: string[];
  /**
   * Identity-bearing form fields
   * Order: PRESERVED - tab order/form flow is structural semantics
   */
  formFields: Array<{ field: string; label: string }>;
  /**
   * Identity-bearing table headers
   * Order: PRESERVED - column order is structural semantics
   */
  tableHeaders: string[];
  /**
   * Identity-bearing navigation landmarks
   * Order: PRESERVED - document structure order is structural semantics
   */
  landmarks: string[];
  /**
   * Identity-bearing tabs
   * Order: PRESERVED - tab navigation order is structural semantics
   */
  tabs: string[];
  /** Semantic route/view state (e.g., URL path, semantic query params) */
  semanticViewState: string;
}

// ─── Structural Field Classification ─────────────────────────────────────────

/**
 * Structural field class for schema/field-semantic classification
 *
 * Determines whether a field is included in structural projection.
 * Key distinction from observation classification:
 * - Refs are EXCLUDED from structural (included in observation)
 * - "Looks like timestamp/ID" is NOT sufficient for exclusion
 * - Must be schema-classified as non-structural
 */
export type StructuralFieldClass =
  | 'identity_bearing_role'      // Include
  | 'identity_bearing_label'     // Include
  | 'identity_bearing_heading'   // Include
  | 'identity_bearing_form'      // Include
  | 'identity_bearing_table'     // Include
  | 'identity_bearing_landmark'  // Include
  | 'identity_bearing_tab'       // Include
  | 'semantic_view_state'        // Include
  | 'action_ref'                 // EXCLUDE (observation-only)
  | 'framework_runtime_id'       // EXCLUDE (schema-classified)
  | 'generated_timestamp'        // EXCLUDE (schema-classified)
  | 'session_transport_id'       // EXCLUDE (schema-classified)
  | 'tracking_query'             // EXCLUDE (schema-classified)
  | 'ordinary_record_value'      // EXCLUDE (schema-classified, not structural)
  | 'unknown_field';             // INCLUDE conservatively (prevent false equality)

/**
 * Structural projection policy for a field class
 */
export type StructuralProjectionPolicy =
  | 'include'     // Include in structural projection
  | 'exclude';    // Exclude from structural projection

/**
 * Structural field classification result
 */
export interface StructuralFieldClassification {
  fieldClass: StructuralFieldClass;
  policy: StructuralProjectionPolicy;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Classify a field for structural projection based on schema/field-semantic rules
 *
 * IMPORTANT: "Looks like timestamp/ID" is NOT sufficient for exclusion.
 * Must be schema-classified as non-structural.
 *
 * Examples:
 * - generatedAt timestamp → potentially non-structural (schema-classified)
 * - bookingDate → potentially structural (schema-classified)
 * - framework runtime ID → potentially non-structural (schema-classified)
 * - product SKU → potentially structural (schema-classified)
 *
 * Unknown fields default to INCLUDE to prevent false equality.
 */
export function classifyStructuralField(
  fieldName: string,
  fieldValue: string,
  context: { inSnapshot?: boolean; inUrl?: boolean }
): StructuralFieldClassification {
  // Action-addressing refs are EXCLUDED from structural projection
  // (they are observation-only, used for action alignment)
  if (fieldName === 'ref' || /\[ref=[^\]]+\]/.test(fieldValue)) {
    return {
      fieldClass: 'action_ref',
      policy: 'exclude',
      confidence: 'high',
    };
  }

  // Identity-bearing elements are INCLUDED
  if (context.inSnapshot) {
    // Roles (button, link, textbox, etc.)
    if (['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'tab'].includes(fieldName)) {
      return {
        fieldClass: 'identity_bearing_role',
        policy: 'include',
        confidence: 'high',
      };
    }

    // Headings, labels, tabs, landmarks
    if (['heading', 'label', 'tab', 'landmark'].includes(fieldName)) {
      return {
        fieldClass: `identity_bearing_${fieldName}` as StructuralFieldClass,
        policy: 'include',
        confidence: 'high',
      };
    }

    // Form fields, table headers
    if (['form', 'table'].includes(fieldName)) {
      return {
        fieldClass: `identity_bearing_${fieldName}` as StructuralFieldClass,
        policy: 'include',
        confidence: 'high',
      };
    }

    // Schema-classified non-structural fields
    // IMPORTANT: These must be schema-classified, not just "looks like timestamp/ID"
    if (fieldName === 'generatedAt' || fieldName === 'createdAt' || fieldName === 'updatedAt') {
      return {
        fieldClass: 'generated_timestamp',
        policy: 'exclude',
        confidence: 'high',
      };
    }

    if (fieldName.startsWith('data-reactid') || fieldName.startsWith('data-v-')) {
      return {
        fieldClass: 'framework_runtime_id',
        policy: 'exclude',
        confidence: 'high',
      };
    }

    if (fieldName === 'session_id' || fieldName === 'sessionId' || fieldName === 'token') {
      return {
        fieldClass: 'session_transport_id',
        policy: 'exclude',
        confidence: 'high',
      };
    }
  }

  // URL fields
  if (context.inUrl) {
    // Tracking query parameters are EXCLUDED
    if (fieldName.startsWith('utm_') || fieldName === 'fbclid' || fieldName === 'gclid') {
      return {
        fieldClass: 'tracking_query',
        policy: 'exclude',
        confidence: 'high',
      };
    }

    // Semantic view state is INCLUDED
    return {
      fieldClass: 'semantic_view_state',
      policy: 'include',
      confidence: 'medium',
    };
  }

  // Unknown fields: INCLUDE conservatively to prevent false equality
  // "Looks like timestamp/ID" is NOT sufficient for exclusion
  return {
    fieldClass: 'unknown_field',
    policy: 'include',
    confidence: 'low',
  };
}

// ─── Structural Projection Construction ──────────────────────────────────────

/**
 * Construct structural projection from raw evidence
 *
 * IMPORTANT: Structural projection is built from raw evidence INDEPENDENTLY from
 * observation projection. It is NOT derived from observation projection.
 *
 * This ensures that observation-level decisions (e.g., whether to include a field
 * in the model-visible payload) do not incorrectly determine structural semantics.
 */
export function constructStructuralProjection(
  rawSnapshot: string,
  url: string
): StructuralProjection {
  // Parse snapshot to extract structural elements
  // Phase 1a: Simple heuristic extraction
  // Future phases will integrate with full schema-driven classifier
  const roles = extractStructuralRoles(rawSnapshot);
  const headings = extractStructuralHeadings(rawSnapshot);
  const formFields = extractStructuralFormFields(rawSnapshot);
  const tableHeaders = extractStructuralTableHeaders(rawSnapshot);
  const landmarks = extractStructuralLandmarks(rawSnapshot);
  const tabs = extractStructuralTabs(rawSnapshot);
  const semanticViewState = extractSemanticViewState(url);

  return {
    roles,
    headings,
    formFields,
    tableHeaders,
    landmarks,
    tabs,
    semanticViewState,
  };
}

/**
 * Extract identity-bearing roles from snapshot
 * Excludes refs (observation-only)
 */
function extractStructuralRoles(snapshot: string): Array<{ role: string; label: string }> {
  const roles: Array<{ role: string; label: string }> = [];

  // Match patterns like: button "Submit" [ref=e37]
  // Extract role and label, but NOT the ref
  const rolePattern = /(button|link|textbox|combobox|checkbox|radio|tab)\s+"([^"]+)"/gi;
  let match;
  while ((match = rolePattern.exec(snapshot)) !== null) {
    roles.push({
      role: match[1]!.toLowerCase(),
      label: match[2]!,
    });
  }

  return roles;
}

/**
 * Extract identity-bearing headings from snapshot
 */
function extractStructuralHeadings(snapshot: string): string[] {
  const headings: string[] = [];

  // Match heading patterns (simplified for Phase 1a)
  const headingPattern = /heading\s+"([^"]+)"/gi;
  let match;
  while ((match = headingPattern.exec(snapshot)) !== null) {
    headings.push(match[1]!);
  }

  return headings;
}

/**
 * Extract identity-bearing form fields from snapshot
 */
function extractStructuralFormFields(snapshot: string): Array<{ field: string; label: string }> {
  const fields: Array<{ field: string; label: string }> = [];

  // Match form field patterns
  const fieldPattern = /(textbox|combobox|checkbox|radio)\s+"([^"]+)"/gi;
  let match;
  while ((match = fieldPattern.exec(snapshot)) !== null) {
    fields.push({
      field: match[1]!.toLowerCase(),
      label: match[2]!,
    });
  }

  return fields;
}

/**
 * Extract identity-bearing table headers from snapshot
 */
function extractStructuralTableHeaders(snapshot: string): string[] {
  const headers: string[] = [];

  // Match table header patterns (simplified)
  const headerPattern = /columnheader\s+"([^"]+)"/gi;
  let match;
  while ((match = headerPattern.exec(snapshot)) !== null) {
    headers.push(match[1]!);
  }

  return headers;
}

/**
 * Extract identity-bearing navigation landmarks from snapshot
 */
function extractStructuralLandmarks(snapshot: string): string[] {
  const landmarks: string[] = [];

  // Match landmark patterns
  const landmarkPattern = /(navigation|main|banner|contentinfo)\s*(?:"([^"]+)")?/gi;
  let match;
  while ((match = landmarkPattern.exec(snapshot)) !== null) {
    landmarks.push(match[1]!.toLowerCase());
  }

  return landmarks;
}

/**
 * Extract identity-bearing tabs from snapshot
 */
function extractStructuralTabs(snapshot: string): string[] {
  const tabs: string[] = [];

  // Match tab patterns
  const tabPattern = /tab\s+"([^"]+)"/gi;
  let match;
  while ((match = tabPattern.exec(snapshot)) !== null) {
    tabs.push(match[1]!);
  }

  return tabs;
}

/**
 * Extract semantic view state from URL
 * Includes origin + path + semantic query params (excludes tracking params)
 */
function extractSemanticViewState(url: string): string {
  try {
    const parsed = new URL(url);

    // Remove tracking parameters
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'];
    trackingParams.forEach(param => parsed.searchParams.delete(param));

    // Return canonical semantic view state
    return parsed.toString();
  } catch {
    return url;
  }
}

// ─── Structural Identity (Hash Only) ─────────────────────────────────────────

/**
 * Compute structural identity hash from projection
 *
 * IMPORTANT: The hash includes ONLY the structural projection content.
 * It does NOT include:
 * - completenessScope (that's comparison provenance, not content)
 * - contractVersion (that's tracked separately)
 *
 * This ensures that structural identity reflects only the structural content,
 * not metadata about scope or contract.
 */
export function computeStructuralIdentityHash(projection: StructuralProjection): string {
  // Serialize projection to canonical JSON with deterministic key ordering
  // Use custom replacer function to sort keys at all levels
  const canonical = JSON.stringify(projection, (key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Sort object keys for deterministic serialization
      return Object.keys(value)
        .sort()
        .reduce((sorted: any, k) => {
          sorted[k] = (value as any)[k];
          return sorted;
        }, {});
    }
    return value;
  });

  // Compute SHA-256 hash
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 12);
}

/**
 * Construct StructuralIdentity from projection
 */
export function constructStructuralIdentity(projection: StructuralProjection): StructuralIdentity {
  return {
    structuralHash: computeStructuralIdentityHash(projection),
  };
}

// ─── Structural Evidence ─────────────────────────────────────────────────────

/**
 * Construct StructuralEvidence from projection, contract version, and completeness scope
 *
 * IMPORTANT:
 * - completenessScope is comparison provenance, NOT part of structural hash
 * - contractVersion is tracked separately, NOT part of structural hash
 * - StructuralEvidence = contractVersion + completenessScope + structuralIdentity
 */
export function constructStructuralEvidence(
  projection: StructuralProjection,
  contractVersion: string = 'v1',
  completenessScope: string = 'complete'
): StructuralEvidence {
  const structuralIdentity = constructStructuralIdentity(projection);

  return {
    contractVersion,
    completenessScope,
    structuralIdentity,
  };
}

// ─── C3-C7 Conformance Helpers ───────────────────────────────────────────────

/**
 * Helper for C3-C7 conformance tests: construct evidence from raw evidence
 */
export function constructStructuralEvidenceFromRaw(
  rawSnapshot: string,
  url: string,
  contractVersion: string = 'v1',
  completenessScope: string = 'complete'
): StructuralEvidence {
  const projection = constructStructuralProjection(rawSnapshot, url);
  return constructStructuralEvidence(projection, contractVersion, completenessScope);
}
