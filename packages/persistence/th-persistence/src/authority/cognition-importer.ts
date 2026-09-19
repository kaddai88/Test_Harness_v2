import { mapLegacyCognitionRows, type LegacyCognitionInput } from '@test-harness/th-cognition';
import type { CognitionAuthorityCreateInput, DefaultCognitionAuthorityService } from './cognition.js';
import type { ExplicitAuthorityCommandBoundary, LegacyImportCommand } from './commands.js';

export interface CognitionImportDiagnostic {
  readonly sourceId: string;
  readonly status: 'inserted' | 'skipped-existing' | 'conflict' | 'invalid';
  readonly canonicalId?: string;
  readonly detail?: string;
}

export interface CognitionImportReport {
  readonly diagnostics: readonly CognitionImportDiagnostic[];
  readonly inserted: number;
  readonly skipped: number;
  readonly blocked: number;
}

/** Explicit, bounded executor. It has no file/GET/runtime registration. */
export class CognitionLegacyImporter {
  constructor(
    private readonly cognition: Pick<DefaultCognitionAuthorityService, 'importInsertOnly'>,
    private readonly commands: ExplicitAuthorityCommandBoundary,
    private readonly maximumRows: number = 10_000,
  ) {}

  async run(command: LegacyImportCommand, rows: readonly CognitionAuthorityCreateInput[]): Promise<CognitionImportReport> {
    const prepared = await this.commands.prepare(command);
    if (prepared.command !== 'legacy-import' || prepared.domain !== 'cognition') {
      throw new TypeError('Cognition importer requires an explicit cognition legacy-import command');
    }
    if (!Number.isSafeInteger(this.maximumRows) || this.maximumRows < 1 || rows.length > this.maximumRows) {
      throw new RangeError(`Cognition import exceeds bounded row limit: ${this.maximumRows}`);
    }
    const diagnostics: CognitionImportDiagnostic[] = [];
    for (const input of rows.map(row => structuredClone(row))) {
      const mapping = mapLegacyCognitionRows([{ ...input.row, kind: input.kind } as LegacyCognitionInput]).mappings[0];
      if (!mapping?.canonicalKey) {
        diagnostics.push({ sourceId: input.row.id, status: 'invalid', detail: mapping?.diagnostic ?? 'No canonical mapping' });
        continue;
      }
      try {
        if (input.scope.kind !== 'site' || input.scope.siteId !== prepared.scopeReference) {
          throw new TypeError('Import row is outside the explicitly verified site scope');
        }
        const result = await this.cognition.importInsertOnly(input);
        diagnostics.push({ sourceId: input.row.id, status: result.result.inserted ? 'inserted' : 'skipped-existing',
          canonicalId: mapping.canonicalKey,
          ...(!result.result.inserted ? { detail: 'Existing authority retained; importer did not attach or overwrite provenance' } : {}) });
      } catch (error) {
        diagnostics.push({ sourceId: input.row.id, status: 'conflict', canonicalId: mapping.canonicalKey,
          detail: error instanceof Error ? error.message : 'Import conflict' });
      }
    }
    return {
      diagnostics,
      inserted: diagnostics.filter(value => value.status === 'inserted').length,
      skipped: diagnostics.filter(value => value.status === 'skipped-existing').length,
      blocked: diagnostics.filter(value => value.status === 'conflict' || value.status === 'invalid').length,
    };
  }
}
