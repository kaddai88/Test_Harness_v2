/**
 * Shared SiteProfile origin identity contract.
 *
 * This module is intentionally additive. Existing callers are migrated to it
 * in a later phase so this gate does not change current writer behavior.
 */

declare const canonicalOriginBrand: unique symbol;

/** A validated, canonical `scheme://host[:non-default-port]` key. */
export type CanonicalOriginKey = string & {
  readonly [canonicalOriginBrand]: true;
};

export interface LegacyHostnameReference {
  readonly kind: 'legacy-hostname';
  readonly hostname: string;
  readonly source: 'value' | 'site-profile-filename';
}

const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);

function normalizeHostname(parsed: URL): string {
  let hostname = parsed.hostname.toLowerCase();
  if (hostname.endsWith('.') && !hostname.endsWith('].')) {
    hostname = hostname.slice(0, -1);
  }

  if (!hostname) {
    throw new TypeError('Origin must contain a hostname');
  }

  // URL implementations differ on whether IPv6 hostnames include brackets.
  if (hostname.includes(':') && !hostname.startsWith('[')) {
    hostname = `[${hostname}]`;
  }

  if (!isValidHostname(hostname)) {
    throw new TypeError('Origin must contain a valid hostname');
  }

  return hostname;
}

function isValidHostname(hostname: string): boolean {
  // WHATWG URL has already validated bracketed IP literals at this point.
  if (hostname.startsWith('[')) {
    return hostname.endsWith(']') && hostname.length > 2;
  }

  if (hostname.length > 253) return false;
  const labels = hostname.split('.');
  return labels.every((label) => {
    if (label.length === 0 || label.length > 63) return false;
    if (label.startsWith('-') || label.endsWith('-')) return false;
    return /^[a-z0-9-]+$/.test(label);
  });
}

/**
 * Normalize an HTTP(S) URL to its canonical origin key.
 * Paths, queries, and fragments are intentionally discarded.
 */
export function normalizeCanonicalOrigin(raw: string): CanonicalOriginKey {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new TypeError('Origin must be a non-empty URL string');
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TypeError('Origin must be a valid URL');
  }

  if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
    throw new TypeError('Origin protocol must be http or https');
  }
  if (parsed.username || parsed.password) {
    throw new TypeError('Origin must not contain credentials');
  }

  const hostname = normalizeHostname(parsed);
  const port = parsed.port ? `:${parsed.port}` : '';
  return `${parsed.protocol}//${hostname}${port}` as CanonicalOriginKey;
}

/** Fail-closed variant for untrusted input and compatibility readers. */
export function tryNormalizeCanonicalOrigin(raw: unknown): CanonicalOriginKey | null {
  if (typeof raw !== 'string') return null;

  try {
    return normalizeCanonicalOrigin(raw);
  } catch {
    return null;
  }
}

function parseLegacyHostname(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || /[\\/?#@]/.test(value)) return null;

  try {
    const parsed = new URL(`http://${value}`);
    if (parsed.port || parsed.username || parsed.password) return null;

    let hostname = parsed.hostname.toLowerCase();
    if (hostname.endsWith('.')) hostname = hostname.slice(0, -1);
    return isValidHostname(hostname) ? hostname : null;
  } catch {
    return null;
  }
}

/** Read an old hostname value without treating it as a canonical origin. */
export function readLegacyHostname(raw: unknown): LegacyHostnameReference | null {
  const hostname = parseLegacyHostname(raw);
  return hostname
    ? { kind: 'legacy-hostname', hostname, source: 'value' }
    : null;
}

/** Read the old `<hostname>.json` SiteProfile filename convention. */
export function readLegacySiteProfileFilename(
  raw: unknown,
): LegacyHostnameReference | null {
  if (typeof raw !== 'string' || /[\\/]/.test(raw)) return null;
  if (!raw.toLowerCase().endsWith('.json')) return null;

  const hostname = parseLegacyHostname(raw.slice(0, -'.json'.length));
  return hostname
    ? { kind: 'legacy-hostname', hostname, source: 'site-profile-filename' }
    : null;
}
