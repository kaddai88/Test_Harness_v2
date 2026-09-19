import { normalizeCanonicalOrigin, readLegacyHostname } from '@test-harness/th-core';
import type { DefaultSiteProfileAuthorityService } from './site-profile.js';
import type {
  AuthorityExportCommand,
  ExplicitAuthorityCommandBoundary,
  LegacyImportCommand,
} from './commands.js';

export interface LegacySiteProfileImportRow {
  readonly sourceId: string;
  readonly profileId: string;
  readonly legacyHostname: string;
  readonly resolvedCanonicalOrigin: string;
  readonly name: string;
  readonly elementCache?: readonly unknown[];
  readonly resolutionBasis: string;
  readonly approvedBy: string;
}

export interface SiteProfileImportDiagnostic {
  readonly sourceId: string;
  readonly status: 'inserted' | 'skipped-existing' | 'conflict' | 'invalid';
  readonly canonicalOrigin?: string;
  readonly detail?: string;
}

export interface SiteProfileImportReport {
  readonly diagnostics: readonly SiteProfileImportDiagnostic[];
  readonly inserted: number;
  readonly skipped: number;
  readonly blocked: number;
}

export interface SiteProfileExportProjection {
  readonly canonicalOriginKey: string;
  readonly name: string;
  readonly elementCache: readonly unknown[];
  readonly projectedAt: string;
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be explicit`);
  return value.trim();
}

/** Explicit bounded executor. It accepts resolved rows and has no file or GET registration. */
export class SiteProfileLegacyImporter {
  constructor(
    private readonly sites: Pick<DefaultSiteProfileAuthorityService, 'importInsertOnly'>,
    private readonly commands: ExplicitAuthorityCommandBoundary,
    private readonly maximumRows: number = 10_000,
  ) {}

  async run(command: LegacyImportCommand, rows: readonly LegacySiteProfileImportRow[]): Promise<SiteProfileImportReport> {
    const prepared = await this.commands.prepare(command);
    if (prepared.command !== 'legacy-import' || prepared.domain !== 'site-profile') {
      throw new TypeError('SiteProfile importer requires an explicit site-profile legacy-import command');
    }
    if (!Number.isSafeInteger(this.maximumRows) || this.maximumRows < 1 || rows.length > this.maximumRows) {
      throw new RangeError(`SiteProfile import exceeds bounded row limit: ${this.maximumRows}`);
    }
    const diagnostics: SiteProfileImportDiagnostic[] = [];
    for (const row of rows.map(value => structuredClone(value))) {
      try {
        if (!readLegacyHostname(row.legacyHostname)) throw new TypeError('Invalid legacy bare hostname');
        const canonicalOrigin = normalizeCanonicalOrigin(row.resolvedCanonicalOrigin);
        required(row.resolutionBasis, 'resolutionBasis');
        required(row.approvedBy, 'approvedBy');
        const result = await this.sites.importInsertOnly({
          profileId: row.profileId,
          canonicalOrigin,
          name: row.name,
          elementCache: row.elementCache,
          idempotency: { idempotencyKey: `site-profile-import:${row.sourceId}` },
        });
        diagnostics.push({
          sourceId: row.sourceId,
          canonicalOrigin,
          status: result.result.inserted ? 'inserted' : 'skipped-existing',
          ...(!result.result.inserted ? { detail: 'Existing authority retained unchanged' } : {}),
        });
      } catch (error) {
        diagnostics.push({
          sourceId: row.sourceId,
          status: error instanceof TypeError ? 'invalid' : 'conflict',
          detail: error instanceof Error ? error.message : 'Import conflict',
        });
      }
    }
    return {
      diagnostics,
      inserted: diagnostics.filter(value => value.status === 'inserted').length,
      skipped: diagnostics.filter(value => value.status === 'skipped-existing').length,
      blocked: diagnostics.filter(value => value.status === 'invalid' || value.status === 'conflict').length,
    };
  }
}

/** Prepares one-way projections. Writing them is a separate explicit boundary. */
export class SiteProfileAuthorityExporter {
  constructor(
    private readonly sites: Pick<DefaultSiteProfileAuthorityService, 'list'>,
    private readonly commands: ExplicitAuthorityCommandBoundary,
  ) {}

  async prepare(command: AuthorityExportCommand, projectedAt: string): Promise<readonly SiteProfileExportProjection[]> {
    const prepared = await this.commands.prepare(command);
    if (prepared.command !== 'authority-export' || prepared.domain !== 'site-profile') {
      throw new TypeError('SiteProfile exporter requires an explicit site-profile authority-export command');
    }
    if (!Number.isFinite(Date.parse(projectedAt))) throw new TypeError('projectedAt must be an ISO timestamp');
    return (await this.sites.list()).map(row => {
      if (!row.canonicalOriginKey) throw new Error(`SiteProfile ${row.id} has no canonical origin`);
      const elementCache = JSON.parse(row.elementCache || '[]') as unknown;
      if (!Array.isArray(elementCache)) throw new TypeError(`SiteProfile ${row.id} has an invalid locator cache`);
      return {
        canonicalOriginKey: normalizeCanonicalOrigin(row.canonicalOriginKey),
        name: row.name,
        elementCache,
        projectedAt,
      };
    });
  }
}
