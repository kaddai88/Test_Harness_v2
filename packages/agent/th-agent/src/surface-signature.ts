/**
 * Surface Signature - Observation and Surface Detection
 *
 * Core principle: This module only handles "observe and determine what Surface we're on",
 * NOT "decide whether to test".
 *
 * Architecture:
 *   snapshot → normalizeSnapshot() → extractSurfaceSignature() → hashSurfaceSignature() → compareSurfaceSignature()
 *
 * Key rules:
 *   1. NEVER hash raw snapshot - must normalize first
 *   2. Signature represents page STRUCTURE, not current data
 *   3. Detection is fast (every snapshot), planning can wait for stabilization
 */

import * as crypto from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Surface Signature - represents the structural identity of a page/view.
 * Contains normalized structural information, not dynamic data.
 */
export interface SurfaceSignature {
  /** Current URL */
  url: string;
  /** Page title (first heading or document title) */
  title?: string;
  /** Active tab name (for SPA tab views) */
  activeTab?: string;
  /** All heading texts on the page */
  headings: string[];
  /** Unique interactive roles (button, link, textbox, etc.) */
  interactiveRoles: string[];
  /** Form field labels (textbox, combobox, checkbox, radio) */
  formFields: string[];
  /** Table column headers */
  tableHeaders: string[];
  /** Button labels (major actions) */
  majorActions: string[];
  /** Landmark roles (navigation, main, banner, etc.) */
  landmarkRoles?: string[];
  /** Feature labels extracted from structure */
  featureLabels?: string[];
  /** Hash of all structural elements for quick comparison */
  hash: string;
}

/**
 * Result of comparing two surface signatures.
 * - 'same': No significant change (data may have changed, but structure is same)
 * - 'minor': Small change (modal opened, dropdown expanded, etc.)
 * - 'major': Significant change (navigated to different page, tab switched, etc.)
 */
export type SurfaceChange = 'same' | 'minor' | 'major';

// ─── Normalization Rules ─────────────────────────────────────────────────────

/**
 * Patterns that match dynamic content that should be removed before hashing.
 * These represent data that changes but doesn't indicate a structural change.
 */
const DYNAMIC_PATTERNS: RegExp[] = [
  // Timestamps and dates
  /\d{1,2}:\d{2}(:\d{2})?/g,                    // 10:32:41, 10:32
  /\d{4}[-/]\d{1,2}[-/]\d{1,2}/g,               // 2024-01-15, 2024/1/15
  /\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/g,             // 1/15/2024, 15-01-2024
  /\d+ (seconds?|minutes?|hours?|days?) ago/gi,  // 5 minutes ago
  
  // Numbers that look like counts/quantities
  /:\s*\d+/g,                                    // Orders: 128
  /\b\d+\s*(个|条|项|件|次|遍)/g,                 // 128 个, 50 条
  
  // UUIDs and random IDs
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
  /[0-9a-f]{24,}/gi,                             // Long hex strings
  
  // Session tokens and auth strings
  /session[_-]?id[:\s=]+\S+/gi,
  /token[:\s=]+\S+/gi,
  
  // Loading states
  /loading\.{0,3}/gi,
  /加载中\.{0,3}/g,
  /please wait/gi,
  
  // User names after common patterns (keep the label, remove the value)
  /(welcome|你好|欢迎)[,:\s]+[^,\n]+/gi,
  
  // Prices and currency
  /[$¥€£]\s*[\d,.]+/g,
  /[\d,.]+\s*(元|美元|欧元|英镑)/g,
];

/**
 * Normalize a snapshot by removing dynamic content.
 * Keeps structural information (roles, labels, headings) intact.
 */
export function normalizeSnapshot(snapshot: string): string {
  if (!snapshot) return '';
  
  let normalized = snapshot;
  
  // Apply all dynamic patterns
  for (const pattern of DYNAMIC_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    normalized = normalized.replace(pattern, (match) => {
      // Replace with placeholder of same length to preserve structure
      return '_'.repeat(Math.min(match.length, 20));
    });
  }
  
  return normalized;
}

// ─── Aria Snapshot Parsing ───────────────────────────────────────────────────

/**
 * Parsed element from aria snapshot.
 */
interface ParsedElement {
  ref?: string;
  role: string;
  label: string;
  level?: number;  // heading level
  checked?: boolean;
  selected?: boolean;
  expanded?: boolean;
}

/**
 * Parse aria snapshot into structured elements.
 * Format: [ref=e3] button "提交"
 *         heading "项目管理" [level=1]
 */
function parseAriaSnapshot(snapshot: string): ParsedElement[] {
  const elements: ParsedElement[] = [];
  if (!snapshot) return elements;
  
  const lines = snapshot.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 3) continue;
    
    // Pattern 1: [ref=e3] role "label"
    const refMatch = trimmed.match(/\[ref=(\w+)\]\s*(\w+)\s+"([^"]+)"/);
    if (refMatch) {
      const ref = refMatch[1];
      const role = refMatch[2];
      const label = refMatch[3];
      if (ref && role && label) {
        elements.push({ ref, role: role.toLowerCase(), label: label.trim() });
      }
      continue;
    }
    
    // Pattern 2: role "label" (without ref)
    const roleMatch = trimmed.match(/^(\w+)\s+"([^"]+)"/);
    if (roleMatch) {
      const role = roleMatch[1];
      const label = roleMatch[2];
      if (role && label) {
        elements.push({ role: role.toLowerCase(), label: label.trim() });
      }
      continue;
    }
    
    // Pattern 3: heading with level
    const headingMatch = trimmed.match(/heading\s+"([^"]+)"\s*\[level=(\d+)\]/i);
    if (headingMatch) {
      const label = headingMatch[1];
      const level = headingMatch[2];
      if (label && level) {
        elements.push({ role: 'heading', label: label.trim(), level: parseInt(level, 10) });
      }
      continue;
    }
    
    // Pattern 4: checkbox/radio with state
    const stateMatch = trimmed.match(/\[ref=(\w+)\]\s*(checkbox|radio)\s+"([^"]+)"\s*\[(checked|unchecked|selected)\]/i);
    if (stateMatch) {
      const ref = stateMatch[1];
      const role = stateMatch[2];
      const label = stateMatch[3];
      const state = stateMatch[4];
      if (ref && role && label && state) {
        elements.push({
          ref,
          role: role.toLowerCase(),
          label: label.trim(),
          checked: state === 'checked' || state === 'selected',
        });
      }
      continue;
    }
    
    // Pattern 5: tab with selected state
    const tabMatch = trimmed.match(/\[ref=(\w+)\]\s*tab\s+"([^"]+)"\s*\[(selected|unselected)\]/i);
    if (tabMatch) {
      const ref = tabMatch[1];
      const label = tabMatch[2];
      const state = tabMatch[3];
      if (ref && label && state) {
        elements.push({
          ref,
          role: 'tab',
          label: label.trim(),
          selected: state === 'selected',
        });
      }
      continue;
    }
  }
  
  return elements;
}

// ─── Signature Extraction ────────────────────────────────────────────────────

/**
 * Extract surface signature from an aria snapshot.
 * 
 * This function:
 *   1. Parses the snapshot into structured elements
 *   2. Extracts structural information (roles, labels, headings)
 *   3. Computes a hash for quick comparison
 * 
 * The signature represents page STRUCTURE, not current data.
 */
export function extractSurfaceSignature(
  snapshot: string,
  url: string
): SurfaceSignature {
  // Normalize first to remove dynamic content
  const normalized = normalizeSnapshot(snapshot);
  
  // Parse into structured elements
  const elements = parseAriaSnapshot(normalized);
  
  // Extract structural components
  const headings: string[] = [];
  const interactiveRoles = new Set<string>();
  const formFields: string[] = [];
  const tableHeaders: string[] = [];
  const majorActions: string[] = [];
  const landmarkRoles = new Set<string>();
  const featureLabels: string[] = [];
  let title: string | undefined;
  let activeTab: string | undefined;
  
  // Interactive roles we care about
  const interactiveRoleSet = new Set([
    'button', 'link', 'textbox', 'combobox', 'checkbox', 'radio',
    'tab', 'menuitem', 'menu', 'listbox', 'option', 'switch',
    'slider', 'spinbutton', 'searchbox', 'datepicker',
  ]);
  
  // Form field roles
  const formFieldRoles = new Set([
    'textbox', 'combobox', 'checkbox', 'radio', 'switch',
    'slider', 'spinbutton', 'searchbox', 'datepicker',
  ]);
  
  // Landmark roles
  const landmarkRoleSet = new Set([
    'navigation', 'main', 'banner', 'contentinfo', 'complementary',
    'form', 'region', 'search',
  ]);
  
  for (const el of elements) {
    // Track title (first heading)
    if (el.role === 'heading' && !title) {
      title = el.label;
    }
    
    // Collect all headings
    if (el.role === 'heading') {
      headings.push(el.label);
    }
    
    // Track interactive roles
    if (interactiveRoleSet.has(el.role)) {
      interactiveRoles.add(el.role);
    }
    
    // Track form fields
    if (formFieldRoles.has(el.role)) {
      formFields.push(el.label);
    }
    
    // Track table headers
    if (el.role === 'columnheader') {
      tableHeaders.push(el.label);
    }
    
    // Track major actions (buttons)
    if (el.role === 'button') {
      majorActions.push(el.label);
    }
    
    // Track landmarks
    if (landmarkRoleSet.has(el.role)) {
      landmarkRoles.add(el.role);
    }
    
    // Track active tab
    if (el.role === 'tab' && el.selected) {
      activeTab = el.label;
    }
    
    // Track feature labels (meaningful text content)
    if (el.label && el.label.length > 2 && el.label.length < 50) {
      featureLabels.push(el.label);
    }
  }
  
  // Build signature
  const signature: SurfaceSignature = {
    url,
    title,
    activeTab,
    headings: [...new Set(headings)],  // Deduplicate
    interactiveRoles: [...interactiveRoles].sort(),
    formFields: [...new Set(formFields)],
    tableHeaders: [...new Set(tableHeaders)],
    majorActions: [...new Set(majorActions)],
    landmarkRoles: [...landmarkRoles].sort(),
    featureLabels: [...new Set(featureLabels)].slice(0, 50),  // Limit for hash stability
    hash: '',  // Will be computed below
  };
  
  // Compute hash
  signature.hash = hashSurfaceSignature(signature);
  
  return signature;
}

// ─── Hashing ─────────────────────────────────────────────────────────────────

/**
 * Compute a stable hash for a surface signature.
 * The hash represents the structural identity of the page.
 */
export function hashSurfaceSignature(signature: SurfaceSignature): string {
  // Build a stable string representation
  const parts: string[] = [
    `url:${signature.url}`,
    `title:${signature.title ?? ''}`,
    `tab:${signature.activeTab ?? ''}`,
    `headings:${signature.headings.sort().join('|')}`,
    `roles:${signature.interactiveRoles.sort().join(',')}`,
    `forms:${signature.formFields.sort().join('|')}`,
    `tables:${signature.tableHeaders.sort().join('|')}`,
    `actions:${signature.majorActions.sort().join('|')}`,
  ];
  
  if (signature.landmarkRoles && signature.landmarkRoles.length > 0) {
    parts.push(`landmarks:${signature.landmarkRoles.sort().join(',')}`);
  }
  
  const content = parts.join('\n');
  
  // Use SHA-256 for stable hash
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// ─── Comparison ──────────────────────────────────────────────────────────────

/**
 * Compare two surface signatures and determine the type of change.
 * 
 * Returns:
 *   - 'same': No significant structural change
 *   - 'minor': Small change (modal, dropdown, etc.)
 *   - 'major': Significant change (navigation, tab switch, etc.)
 */
export function compareSurfaceSignature(
  previous: SurfaceSignature,
  current: SurfaceSignature
): SurfaceChange {
  // Fast path: same hash means same surface
  if (previous.hash === current.hash) {
    return 'same';
  }
  
  // URL changed = major change
  if (previous.url !== current.url) {
    return 'major';
  }
  
  // Active tab changed = major change (different business context)
  if (previous.activeTab !== current.activeTab && 
      previous.activeTab !== undefined && 
      current.activeTab !== undefined) {
    return 'major';
  }
  
  // Check for structural changes
  const changes = {
    headingsChanged: !arraysEqual(previous.headings, current.headings),
    rolesChanged: !arraysEqual(previous.interactiveRoles, current.interactiveRoles),
    formsChanged: !arraysEqual(previous.formFields, current.formFields),
    tablesChanged: !arraysEqual(previous.tableHeaders, current.tableHeaders),
    actionsChanged: !arraysEqual(previous.majorActions, current.majorActions),
  };
  
  // Count significant changes
  const significantChanges = Object.values(changes).filter(Boolean).length;
  
  // Major: multiple structural elements changed
  if (significantChanges >= 2) {
    return 'major';
  }
  
  // Minor: single structural element changed (e.g., new button appeared)
  if (significantChanges === 1) {
    // Check if it's a "major" single change (like all buttons changed)
    if (changes.actionsChanged && previous.majorActions.length > 3) {
      return 'major';
    }
    return 'minor';
  }
  
  // Hash differs but no structural change detected
  // This might be due to feature labels or other minor differences
  return 'minor';
}

/**
 * Helper: Compare two arrays for equality (order-independent for some).
 */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, idx) => val === sortedB[idx]);
}

// ─── Surface Key Generation ──────────────────────────────────────────────────

/**
 * Generate a stable surface key for caching and identification.
 * This is different from hash - it's meant to be human-readable and stable
 * across sessions.
 */
export function generateSurfaceKey(signature: SurfaceSignature): string {
  const parts: string[] = [];
  
  // Extract domain from URL
  try {
    const urlObj = new URL(signature.url);
    parts.push(urlObj.hostname.replace(/\./g, '_'));
    
    // Extract path without query params
    const pathPart = urlObj.pathname
      .replace(/^\//, '')
      .replace(/\/$/, '')
      .replace(/\//g, '_')
      .replace(/[^a-zA-Z0-9_]/g, '')
      .slice(0, 50);
    if (pathPart) {
      parts.push(pathPart);
    }
  } catch {
    // Invalid URL, use raw URL
    parts.push(signature.url.slice(0, 30).replace(/[^a-zA-Z0-9]/g, '_'));
  }
  
  // Add active tab if present
  if (signature.activeTab) {
    parts.push(signature.activeTab.replace(/\s+/g, '_').slice(0, 20));
  }
  
  return parts.join('::').toLowerCase();
}

// ─── Module Key Generation ───────────────────────────────────────────────────

/**
 * Generate a module key from a surface signature.
 * Groups related surfaces under the same module.
 */
export function generateModuleKey(signature: SurfaceSignature): string {
  try {
    const urlObj = new URL(signature.url);
    const pathSegments = urlObj.pathname
      .replace(/^\//, '')
      .split('/');
    const firstSegment = pathSegments[0] ?? '';
    const pathPart = firstSegment
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 30);
    
    return `${urlObj.hostname.replace(/\./g, '_')}_${pathPart}`.toLowerCase();
  } catch {
    return signature.url.slice(0, 30).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  }
}

/**
 * Generate a module name from a surface signature.
 * Uses the first heading or title as the human-readable name.
 */
export function generateModuleName(signature: SurfaceSignature): string {
  // Prefer first heading
  if (signature.headings.length > 0) {
    return signature.headings[0] ?? 'Unknown Module';
  }
  
  // Fall back to title
  if (signature.title) {
    return signature.title;
  }
  
  // Fall back to URL
  try {
    const urlObj = new URL(signature.url);
    const pathSegments = urlObj.pathname
      .replace(/^\//, '')
      .split('/');
    const firstSegment = pathSegments[0] ?? '';
    const pathPart = firstSegment.replace(/[-_]/g, ' ');
    return pathPart || urlObj.hostname;
  } catch {
    return 'Unknown Module';
  }
}
