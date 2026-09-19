import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const persistence = 'packages/persistence/th-persistence/';
// Existing callers are grandfathered by exact imported symbol, not a directory wildcard.
const legacyImports: Record<string, string[]> = {
  'apps/server/th-server/src/app.ts': ['DatabaseRuntime', 'createDatabase', 'createInMemoryDatabase'],
  'packages/api/th-api/src/server.ts': ['DatabaseRepositories'],
  'packages/api/th-api/src/routes/health.ts': ['DatabaseRepositories'],
  'packages/api/th-api/src/routes/reports.ts': ['DatabaseRepositories'],
  'packages/api/th-api/src/routes/sessions.ts': ['DatabaseRepositories', 'projectSessionMetadata'],
  'packages/worker/th-worker/src/bootstrap.ts': ['DatabaseRepositories'],
  'packages/worker/th-worker/src/processors/test-session.ts': ['DatabaseRepositories'],
};

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', 'dist', '.turbo', '.git', 'data', '.cognition'].includes(entry.name)) return [];
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : /\.(ts|tsx)$/.test(entry.name)
      && !/\.(test|spec)\./.test(entry.name) ? [path] : [];
  });
}
function imports(source: string, file: string) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const result: { specifier: string; names: string[] }[] = [];
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const bindings = node.importClause?.namedBindings;
      result.push({ specifier: node.moduleSpecifier.text,
        names: bindings && ts.isNamedImports(bindings)
          ? bindings.elements.map(element => element.propertyName?.text ?? element.name.text).sort()
          : ['*'] });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      result.push({ specifier: node.moduleSpecifier.text, names: ['re-export'] });
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) result.push({ specifier: argument.text, names: ['dynamic'] });
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
      && ts.isStringLiteral(node.argument.literal)) {
      result.push({ specifier: node.argument.literal.text, names: ['import-type'] });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return result;
}

describe('2-B dependency boundary', () => {
  it('permits only frozen legacy raw-adapter imports; new consumers use the authority surface', () => {
    const found: Record<string, string[]> = {};
    const violations: string[] = [];
    for (const path of [...files(resolve(root, 'apps')), ...files(resolve(root, 'packages'))]) {
      const name = relative(root, path).replaceAll('\\', '/');
      if (name.startsWith(persistence)) continue;
      for (const dependency of imports(readFileSync(path, 'utf8'), path)) {
        const resolved = dependency.specifier.startsWith('.')
          ? relative(root, resolve(dirname(path), dependency.specifier)).replaceAll('\\', '/') : dependency.specifier;
        if (resolved === '@test-harness/th-persistence/authority') continue;
        if (resolved === '@test-harness/th-persistence') {
          found[name] = [...(found[name] ?? []), ...dependency.names].sort();
        } else if (resolved.includes('th-persistence/') || resolved.startsWith(persistence)) {
          violations.push(name + ' -> ' + resolved);
        }
      }
    }
    expect(violations).toEqual([]);
    expect(found).toEqual(legacyImports);
  });

  it('keeps adapters out of the public authority entry and legacy exports available', () => {
    const entry = readFileSync(resolve(root, persistence, 'src/authority/index.ts'), 'utf8');
    const ast = ts.createSourceFile('index.ts', entry, ts.ScriptTarget.Latest, true);
    expect(ast.statements.every(node => ts.isTypeAliasDeclaration(node)
      || ts.isExportDeclaration(node) && node.isTypeOnly)).toBe(true);
    expect(entry).not.toMatch(/export.*(?:AuthorityStorage|SnapshotAuthorityStorage|Repository)/);
    const pkg = JSON.parse(readFileSync(resolve(root, persistence, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.exports).sort()).toEqual(['.', './authority']);
    const legacy = readFileSync(resolve(root, persistence, 'src/index.ts'), 'utf8');
    expect(legacy).toContain('createDatabase');
    expect(legacy).toContain('InMemoryCognitionRepository');
    expect(legacy).toContain('SessionRepository');
  });

  it('keeps authority modules free of runtime app/provider imports and the package graph acyclic', () => {
    for (const path of files(resolve(root, persistence, 'src/authority'))) {
      for (const dependency of imports(readFileSync(path, 'utf8'), path)) {
        expect(dependency.specifier).not.toMatch(/providers\/|@test-harness\/th-(?:api|worker|agent|browser|tools)|node:fs/);
      }
    }
    const locations: Record<string, string> = {
      '@test-harness/th-persistence': persistence,
      '@test-harness/th-cognition': 'packages/cognition/th-cognition',
      '@test-harness/th-core': 'packages/core/th-core',
      '@test-harness/th-protocol': 'packages/protocol/th-protocol',
    };
    function visit(name: string, ancestors: string[]) {
      expect(ancestors).not.toContain(name);
      const pkg = JSON.parse(readFileSync(resolve(root, locations[name]!, 'package.json'), 'utf8'));
      for (const dependency of Object.keys(pkg.dependencies ?? {})) {
        if (dependency.startsWith('@test-harness/')) {
          expect(locations).toHaveProperty(dependency);
          visit(dependency, [...ancestors, name]);
        }
      }
    }
    visit('@test-harness/th-persistence', []);
  });

  it('routes production Cognition callers through capabilities with no read-triggered importer', () => {
    const api = readFileSync(resolve(root, 'packages/api/th-api/src/routes/sites.ts'), 'utf8');
    const worker = readFileSync(resolve(root, 'packages/worker/th-worker/src/processors/test-session.ts'), 'utf8');
    const agent = readFileSync(resolve(root, 'packages/agent/th-agent/src/loop.ts'), 'utf8');
    expect(api).not.toContain('repos.cognition');
    expect(worker).not.toContain('repos.cognition');
    expect(api).not.toContain('syncCognitionFromFiles');
    expect(worker).not.toContain('syncCognitionFilesToDB');
    expect(api).toContain('cognition.listBySite');
    expect(worker).toContain('learnedEntities: this.authority.cognition');
    expect(agent).toContain('CognitionLearnedEntityPort');
    expect(agent).not.toContain('@test-harness/th-persistence');
  });

  it('routes production SiteProfile callers through canonical authority capabilities', () => {
    const api = readFileSync(resolve(root, 'packages/api/th-api/src/routes/sites.ts'), 'utf8');
    const worker = readFileSync(resolve(root, 'packages/worker/th-worker/src/processors/test-session.ts'), 'utf8');
    const tool = readFileSync(resolve(root, 'packages/tools/th-tools/src/builtins/configure-site.ts'), 'utf8');
    const store = readFileSync(resolve(root, 'packages/browser/th-browser/src/site-profile-store.ts'), 'utf8');
    const client = readFileSync(resolve(root, 'apps/web/th-dashboard/src/api/client.ts'), 'utf8');
    for (const source of [api, worker]) expect(source).not.toContain('repos.sites');
    expect(api).not.toContain('syncSiteProfilesFromFiles');
    expect(api).not.toContain('normalizeToHostname');
    expect(api).toContain('normalizeCanonicalOrigin');
    expect(api).toContain('deps.sites');
    expect(worker).not.toMatch(/(?:load|save)SiteProfile/);
    expect(worker).not.toContain('normalizeToHostname');
    expect(worker).toContain('this.authority.sites');
    expect(tool).not.toContain('current-session');
    expect(tool).not.toMatch(/(?:load|save)SiteProfile/);
    expect(tool).toContain('SiteProfileCapabilityDefinition');
    expect(store).toContain('normalizeCanonicalOrigin');
    expect(store).toContain('writeSiteProfileProjection');
    expect(client.match(/sites\/\$\{encodeURIComponent\(/g)?.length).toBeGreaterThanOrEqual(7);
  });
});
