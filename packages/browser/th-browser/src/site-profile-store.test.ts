import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readSiteProfileProjection,
  siteProfileProjectionFileName,
  writeSiteProfileProjection,
} from './site-profile-store.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('2-D SiteProfile derived projection store', () => {
  it('derives distinct names from complete canonical origins', () => {
    const names = [
      'http://example.com',
      'https://example.com',
      'https://www.example.com',
      'https://example.com:8443',
    ].map(siteProfileProjectionFileName);
    expect(new Set(names).size).toBe(names.length);
    expect(siteProfileProjectionFileName('HTTPS://WWW.Example.COM:443/path'))
      .toBe(siteProfileProjectionFileName('https://www.example.com'));
  });

  it('round-trips only canonical authority-derived fields at a stable path', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'th-p6-d-projection-'));
    directories.push(directory);
    const projection = {
      canonicalOriginKey: 'https://www.example.com:8443',
      name: 'Example',
      elementCache: [{ hint: 'login', selector: '#login', timestamp: 1, hitCount: 2, lastVerified: 3 }],
      projectedAt: '2026-09-17T02:00:00.000Z',
    };
    writeSiteProfileProjection(projection, directory);
    writeSiteProfileProjection(projection, directory);

    expect(fs.readdirSync(directory)).toEqual([siteProfileProjectionFileName(projection.canonicalOriginKey)]);
    expect(readSiteProfileProjection('https://www.example.com:8443/other', directory)).toEqual(projection);
    expect(readSiteProfileProjection('https://example.com:8443', directory)).toBeNull();
  });

  it('fails closed for invalid origins and mismatched projection identity', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'th-p6-d-projection-invalid-'));
    directories.push(directory);
    expect(() => siteProfileProjectionFileName('example.com')).toThrow();
    const requested = 'https://example.com';
    fs.writeFileSync(path.join(directory, siteProfileProjectionFileName(requested)), JSON.stringify({
      canonicalOriginKey: 'http://example.com',
      name: 'Wrong origin',
      elementCache: [],
      projectedAt: '2026-09-17T02:00:00.000Z',
    }));
    expect(readSiteProfileProjection(requested, directory)).toBeNull();
  });
});
