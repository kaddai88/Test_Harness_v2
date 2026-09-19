import { describe, expect, it } from 'vitest';
import { analyzeCanonicalMappings } from './mapping-analysis.js';
import {
  applyExplicitSiteProfileOriginResolutions,
  mapLegacySiteProfileOrigins,
} from './origin-mapping.js';

describe('P6 2-A1 canonical mapping analysis', () => {
  it('classifies zero, one-to-one, and many-to-one mappings', () => {
    expect(analyzeCanonicalMappings([]).classification).toBe('zero-collision');
    expect(analyzeCanonicalMappings([]).blocked).toBe(false);
    expect(analyzeCanonicalMappings([
      { sourceId: 'a', canonicalKey: 'canonical-a' },
      { sourceId: 'b', canonicalKey: 'canonical-b' },
    ]).blocked).toBe(false);
    const collision = analyzeCanonicalMappings([
      { sourceId: 'a', canonicalKey: 'canonical-a' },
      { sourceId: 'b', canonicalKey: 'canonical-a' },
    ]);
    expect(collision.classification).toBe('many-to-one');
    expect(collision.blocked).toBe(true);
    expect(collision.collisionGroups).toEqual([
      { canonicalKey: 'canonical-a', sourceIds: ['a', 'b'] },
    ]);
  });

  it('classifies unresolved mappings as ambiguous without choosing a winner', () => {
    const analysis = analyzeCanonicalMappings([{
      sourceId: 'legacy-site',
      canonicalKey: null,
      candidates: ['http://example.com', 'https://example.com'],
    }]);
    expect(analysis.classification).toBe('ambiguous');
    expect(analysis.blocked).toBe(true);
    expect(analysis.unresolvedSourceIds).toEqual(['legacy-site']);
    expect(analysis.diagnostics[0]?.code).toBe('unresolved');
  });
});

describe('P6 2-A1 SiteProfile origin mapping', () => {
  it('surfaces legacy hostname scheme ambiguity', () => {
    const report = mapLegacySiteProfileOrigins([
      { legacyId: 'site-1', rawOrigin: 'example.com' },
    ]);
    expect(report.analysis.classification).toBe('ambiguous');
    expect(report.mappings[0]?.canonicalOrigin).toBeNull();
    expect(report.mappings[0]?.candidates).toEqual([
      'http://example.com',
      'https://example.com',
    ]);
  });

  it('requires explicit resolution and keeps the result in memory', () => {
    const report = mapLegacySiteProfileOrigins([
      { legacyId: 'site-1', rawOrigin: 'example.com' },
    ]);
    const resolved = applyExplicitSiteProfileOriginResolutions(report, [{
      legacyId: 'site-1',
      canonicalOrigin: 'https://example.com',
    }]);

    expect(resolved.analysis.classification).toBe('one-to-one');
    expect(resolved.analysis.blocked).toBe(false);
    expect(resolved.mappings[0]?.canonicalOrigin).toBe('https://example.com');
    expect(report.mappings[0]?.canonicalOrigin).toBeNull();
  });

  it('accepts normalized operator resolutions beyond scheme-only legacy candidates', () => {
    const report = mapLegacySiteProfileOrigins([
      { legacyId: 'ip-site', rawOrigin: '185.200.65.4' },
      { legacyId: 'baidu-site', rawOrigin: 'baidu.com' },
    ]);

    expect(report.mappings[0]?.candidates).toEqual([
      'http://185.200.65.4',
      'https://185.200.65.4',
    ]);
    expect(report.mappings[1]?.candidates).toEqual([
      'http://baidu.com',
      'https://baidu.com',
    ]);

    const resolved = applyExplicitSiteProfileOriginResolutions(report, [
      { legacyId: 'ip-site', canonicalOrigin: 'http://185.200.65.4:82' },
      { legacyId: 'baidu-site', canonicalOrigin: 'https://www.baidu.com' },
    ]);

    expect(resolved.analysis.blocked).toBe(false);
    expect(resolved.mappings[0]?.canonicalOrigin).toBe('http://185.200.65.4:82');
    expect(resolved.mappings[1]?.canonicalOrigin).toBe('https://www.baidu.com');
  });

  it('still rejects an explicit resolution that is not a valid canonical origin', () => {
    const report = mapLegacySiteProfileOrigins([
      { legacyId: 'site-1', rawOrigin: 'example.com' },
    ]);

    expect(() => applyExplicitSiteProfileOriginResolutions(report, [{
      legacyId: 'site-1',
      canonicalOrigin: 'https://example..com',
    }])).toThrow('Origin must contain a valid hostname');
  });

  it('blocks invalid origins and N-to-1 origin collisions', () => {
    expect(mapLegacySiteProfileOrigins([
      { legacyId: 'bad', rawOrigin: 'https://example..com' },
    ]).analysis.classification).toBe('ambiguous');
    expect(mapLegacySiteProfileOrigins([
      { legacyId: 'a', rawOrigin: 'https://example.com/a' },
      { legacyId: 'b', rawOrigin: 'https://example.com/b' },
    ]).analysis.classification).toBe('many-to-one');
  });
});
