import { describe, expect, it } from 'vitest';
import {
  normalizeCanonicalOrigin,
  readLegacyHostname,
  readLegacySiteProfileFilename,
  tryNormalizeCanonicalOrigin,
} from './canonical-origin.js';

describe('canonical SiteProfile origin', () => {
  it('normalizes scheme, host, default port, and URL suffixes', () => {
    expect(normalizeCanonicalOrigin('HTTP://Example.COM:80/path?q=1#section'))
      .toBe('http://example.com');
    expect(normalizeCanonicalOrigin('https://example.com:443/'))
      .toBe('https://example.com');
    expect(normalizeCanonicalOrigin('https://example.com:8443/path'))
      .toBe('https://example.com:8443');
  });

  it('preserves www and distinguishes schemes', () => {
    expect(normalizeCanonicalOrigin('https://www.example.com'))
      .toBe('https://www.example.com');
    expect(normalizeCanonicalOrigin('http://example.com'))
      .not.toBe(normalizeCanonicalOrigin('https://example.com'));
  });

  it('normalizes IDNA and one trailing hostname dot', () => {
    expect(normalizeCanonicalOrigin('https://münich.example./search'))
      .toBe('https://xn--mnich-kva.example');
    expect(normalizeCanonicalOrigin('https://xn--mnich-kva.example'))
      .toBe('https://xn--mnich-kva.example');
  });

  it('fails closed for invalid or unsupported origins', () => {
    expect(tryNormalizeCanonicalOrigin('example.com')).toBeNull();
    expect(tryNormalizeCanonicalOrigin('ftp://example.com')).toBeNull();
    expect(tryNormalizeCanonicalOrigin('https://user@example.com')).toBeNull();
    expect(tryNormalizeCanonicalOrigin('https://_example.com')).toBeNull();
    expect(tryNormalizeCanonicalOrigin('https://example_.com')).toBeNull();
    expect(tryNormalizeCanonicalOrigin('https://example..com')).toBeNull();
    expect(tryNormalizeCanonicalOrigin('https://-example.com')).toBeNull();
    expect(tryNormalizeCanonicalOrigin('https://example-.com')).toBeNull();
    expect(() => normalizeCanonicalOrigin('')).toThrow(TypeError);
  });
});

describe('legacy SiteProfile hostname compatibility', () => {
  it('reads legacy values without converting them into canonical origins', () => {
    expect(readLegacyHostname('WWW.Example.COM')).toEqual({
      kind: 'legacy-hostname',
      hostname: 'www.example.com',
      source: 'value',
    });
    expect(readLegacyHostname('https://example.com/path')).toBeNull();
  });

  it('reads the old hostname filename convention', () => {
    expect(readLegacySiteProfileFilename('example.com.json')).toEqual({
      kind: 'legacy-hostname',
      hostname: 'example.com',
      source: 'site-profile-filename',
    });
    expect(readLegacySiteProfileFilename('example.com.txt')).toBeNull();
  });
});
