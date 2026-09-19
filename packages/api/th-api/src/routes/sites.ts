/** SiteProfile and site-scoped Cognition routes. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { normalizeCanonicalOrigin, readLegacyHostname } from '@test-harness/th-core';
import type {
  CognitionAuthorityService,
  SiteProfileAuthorityRecord,
  SiteProfileAuthorityService,
} from '@test-harness/th-persistence/authority';
import { matchRoute, readJsonBody, sendJson } from '../http.js';

export interface SiteRouteDeps {
  cognition: CognitionAuthorityService;
  sites: SiteProfileAuthorityService;
}

function idempotencyKey(req: IncomingMessage, operation: string): string {
  const supplied = req.headers['idempotency-key'];
  const value = Array.isArray(supplied) ? supplied[0] : supplied;
  return value?.trim() || `api:${operation}:${randomUUID()}`;
}

function decodedRouteKey(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new TypeError('Site route key must use valid percent encoding');
  }
}

async function resolveSite(
  sites: SiteProfileAuthorityService,
  encodedKey: string,
  allowLegacyRead: boolean,
): Promise<{ site: SiteProfileAuthorityRecord | null; canonicalOrigin: string | null }> {
  const decoded = decodedRouteKey(encodedKey);
  try {
    const canonicalOrigin = normalizeCanonicalOrigin(decoded);
    return { site: await sites.findByOrigin(canonicalOrigin), canonicalOrigin };
  } catch (error) {
    if (!allowLegacyRead) throw error;
    const legacy = readLegacyHostname(decoded);
    if (!legacy) throw error;
    const matches = (await sites.list()).filter(row => row.baseUrl === legacy.hostname);
    if (matches.length > 1) throw new Error('Ambiguous legacy SiteProfile hostname');
    return { site: matches[0] ?? null, canonicalOrigin: matches[0]?.canonicalOriginKey ?? null };
  }
}

function locatorCache(site: SiteProfileAuthorityRecord): unknown[] {
  try {
    const parsed = JSON.parse(site.elementCache || '[]') as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function cognitionSummary(cognition: CognitionAuthorityService, siteId: string, limit: number) {
  const { episodes, knowledge, procedures, patterns } = await cognition.listBySite(siteId);
  return {
    episodes: episodes.length,
    knowledge: knowledge.length,
    procedures: procedures.length,
    patterns: patterns.length,
    recentEpisodes: episodes.slice(0, limit).map(episode => ({
      id: episode.id,
      type: episode.type,
      outcome: episode.outcome,
      description: episode.description,
      timestamp: episode.timestamp,
    })),
    recentKnowledge: knowledge.slice(0, limit).map(item => ({
      id: item.id,
      type: item.type,
      title: item.title,
      confidence: item.confidence,
    })),
  };
}

function siteView(site: SiteProfileAuthorityRecord) {
  const canonicalOriginKey = normalizeCanonicalOrigin(site.canonicalOriginKey ?? '');
  return {
    id: site.id,
    name: site.name,
    canonicalOriginKey,
    baseUrl: canonicalOriginKey,
    elementCache: locatorCache(site),
    testCount: site.testCount,
    lastTestedAt: site.lastTestedAt,
    updatedAt: site.updatedAt,
  };
}

async function handleListSites(_req: IncomingMessage, res: ServerResponse, deps: SiteRouteDeps): Promise<void> {
  const sites = await deps.sites.list();
  const enriched = await Promise.all(sites.map(async site => ({
    ...siteView(site),
    cognition: await cognitionSummary(deps.cognition, site.id, 5),
  })));
  sendJson(res, 200, { sites: enriched });
}

async function handleGetSite(
  _req: IncomingMessage,
  res: ServerResponse,
  routeKey: string,
  deps: SiteRouteDeps,
): Promise<void> {
  try {
    const { site } = await resolveSite(deps.sites, routeKey, true);
    if (!site) {
      sendJson(res, 404, { error: 'No site profile found' });
      return;
    }
    sendJson(res, 200, {
      site: siteView(site),
      cognition: await cognitionSummary(deps.cognition, site.id, 10),
    });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid site route key' });
  }
}

async function handleUpdateSite(
  req: IncomingMessage,
  res: ServerResponse,
  routeKey: string,
  deps: SiteRouteDeps,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody<Record<string, unknown>>(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }
  try {
    for (const key of Object.keys(body)) {
      if (!['name', 'baseUrl', 'clearCache'].includes(key)) throw new TypeError(`Unsupported SiteProfile field: ${key}`);
    }
    const canonicalOrigin = normalizeCanonicalOrigin(decodedRouteKey(routeKey));
    if (body.baseUrl !== undefined && (typeof body.baseUrl !== 'string'
      || normalizeCanonicalOrigin(body.baseUrl) !== canonicalOrigin)) {
      throw new TypeError('SiteProfile canonical origin cannot be changed by update');
    }
    let site = await deps.sites.findByOrigin(canonicalOrigin);
    const created = !site;
    if (!site) {
      const ensured = await deps.sites.ensure({
        canonicalOrigin,
        name: typeof body.name === 'string' ? body.name : new URL(canonicalOrigin).hostname,
        idempotency: { idempotencyKey: idempotencyKey(req, `ensure-site:${canonicalOrigin}`) },
      });
      site = ensured.result.record;
    } else if (typeof body.name === 'string') {
      site = (await deps.sites.update({
        scope: { kind: 'profile', profileId: site.id },
        name: body.name,
        idempotency: { idempotencyKey: idempotencyKey(req, `update-site:${site.id}`) },
      })).result;
    }
    if (body.clearCache === true) {
      site = (await deps.sites.replaceLocatorCache({
        scope: { kind: 'profile', profileId: site.id },
        entries: [],
        idempotency: { idempotencyKey: idempotencyKey(req, `clear-site-cache:${site.id}`) },
      })).result;
    }
    sendJson(res, created ? 201 : 200, { success: true, site: siteView(site) });
  } catch (error) {
    sendJson(res, error instanceof TypeError ? 400 : 409,
      { error: error instanceof Error ? error.message : 'Failed to update SiteProfile' });
  }
}

async function handleDeleteSite(
  req: IncomingMessage,
  res: ServerResponse,
  routeKey: string,
  deps: SiteRouteDeps,
): Promise<void> {
  try {
    const { site, canonicalOrigin } = await resolveSite(deps.sites, routeKey, false);
    if (!site) {
      sendJson(res, 404, { error: 'No site profile found' });
      return;
    }
    await deps.cognition.deleteBySite({ siteId: site.id,
      idempotency: { idempotencyKey: idempotencyKey(req, `delete-site-cognition:${site.id}`) } });
    await deps.sites.delete({ scope: { kind: 'profile', profileId: site.id },
      idempotency: { idempotencyKey: idempotencyKey(req, `delete-site:${site.id}`) } });
    sendJson(res, 200, { success: true, message: `SiteProfile ${canonicalOrigin} deleted` });
  } catch (error) {
    sendJson(res, error instanceof TypeError ? 400 : 409,
      { error: error instanceof Error ? error.message : 'Failed to delete SiteProfile' });
  }
}

async function handleGetCognition(
  _req: IncomingMessage,
  res: ServerResponse,
  routeKey: string,
  deps: SiteRouteDeps,
): Promise<void> {
  try {
    const { site } = await resolveSite(deps.sites, routeKey, true);
    if (!site) {
      sendJson(res, 404, { error: 'No site profile found' });
      return;
    }
    sendJson(res, 200, { siteId: site.id, siteName: site.name,
      cognition: await cognitionSummary(deps.cognition, site.id, 10) });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid site route key' });
  }
}

async function strictSite(routeKey: string, deps: SiteRouteDeps): Promise<SiteProfileAuthorityRecord | null> {
  return (await resolveSite(deps.sites, routeKey, false)).site;
}

async function handleClearCognition(
  req: IncomingMessage,
  res: ServerResponse,
  routeKey: string,
  deps: SiteRouteDeps,
): Promise<void> {
  try {
    const site = await strictSite(routeKey, deps);
    if (!site) {
      sendJson(res, 404, { error: 'No site profile found' });
      return;
    }
    await deps.cognition.deleteBySite({ siteId: site.id,
      idempotency: { idempotencyKey: idempotencyKey(req, `clear-cognition:${site.id}`) } });
    sendJson(res, 200, { success: true });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid site route key' });
  }
}

async function handleFlagKnowledge(
  req: IncomingMessage,
  res: ServerResponse,
  routeKey: string,
  deps: SiteRouteDeps,
): Promise<void> {
  let body: Record<string, unknown>;
  try { body = await readJsonBody<Record<string, unknown>>(req); }
  catch { sendJson(res, 400, { error: 'Invalid JSON body' }); return; }
  if (typeof body.knowledgeId !== 'string' || typeof body.reason !== 'string') {
    sendJson(res, 400, { error: 'Missing knowledgeId or reason' });
    return;
  }
  try {
    const site = await strictSite(routeKey, deps);
    if (!site) { sendJson(res, 404, { error: 'Knowledge not found' }); return; }
    const adjustment = await deps.cognition.adjustKnowledgeConfidence({ siteId: site.id, rowId: body.knowledgeId,
      delta: -0.3, idempotency: { idempotencyKey: idempotencyKey(req, `flag-knowledge:${body.knowledgeId}`) } });
    sendJson(res, 200, { success: true, confidence: adjustment.result.confidence });
  } catch (error) {
    sendJson(res, error instanceof TypeError ? 400 : 404,
      { error: error instanceof Error ? error.message : 'Knowledge not found' });
  }
}

async function handleAddManualExperience(
  req: IncomingMessage,
  res: ServerResponse,
  routeKey: string,
  deps: SiteRouteDeps,
): Promise<void> {
  let body: Record<string, unknown>;
  try { body = await readJsonBody<Record<string, unknown>>(req); }
  catch { sendJson(res, 400, { error: 'Invalid JSON body' }); return; }
  if (typeof body.description !== 'string' || typeof body.type !== 'string' || typeof body.outcome !== 'string') {
    sendJson(res, 400, { error: 'Missing required fields: description, type, outcome' });
    return;
  }
  try {
    const canonicalOrigin = normalizeCanonicalOrigin(decodedRouteKey(routeKey));
    const ensured = await deps.sites.ensure({
      canonicalOrigin,
      name: new URL(canonicalOrigin).hostname,
      idempotency: { idempotencyKey: idempotencyKey(req, `ensure-manual-site:${canonicalOrigin}`) },
    });
    const episode = await deps.cognition.createManualEpisode({ siteId: ensured.result.record.id,
      type: body.type, outcome: body.outcome, description: body.description,
      data: { findings: body.findings, source: 'manual' },
      idempotency: { idempotencyKey: idempotencyKey(req, `manual-episode:${ensured.result.record.id}`) } });
    sendJson(res, 201, { success: true, episodeId: episode.result.id });
  } catch (error) {
    sendJson(res, error instanceof TypeError ? 400 : 409,
      { error: error instanceof Error ? error.message : 'Failed to add manual experience' });
  }
}

async function handleAdjustWeight(
  req: IncomingMessage,
  res: ServerResponse,
  routeKey: string,
  knowledgeId: string,
  deps: SiteRouteDeps,
): Promise<void> {
  let body: Record<string, unknown>;
  try { body = await readJsonBody<Record<string, unknown>>(req); }
  catch { sendJson(res, 400, { error: 'Invalid JSON body' }); return; }
  if (typeof body.factor !== 'number') {
    sendJson(res, 400, { error: 'Missing or invalid factor' });
    return;
  }
  try {
    const site = await strictSite(routeKey, deps);
    if (!site) { sendJson(res, 404, { error: 'Knowledge not found' }); return; }
    const adjustment = await deps.cognition.adjustKnowledgeConfidence({ siteId: site.id, rowId: knowledgeId,
      delta: body.factor, idempotency: { idempotencyKey: idempotencyKey(req, `weight-knowledge:${knowledgeId}`) } });
    sendJson(res, 200, { success: true, confidence: adjustment.result.confidence });
  } catch (error) {
    sendJson(res, error instanceof TypeError ? 400 : 404,
      { error: error instanceof Error ? error.message : 'Knowledge not found' });
  }
}

export async function dispatchSiteRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: SiteRouteDeps,
  pathname: string,
): Promise<boolean> {
  if (req.method === 'GET' && pathname === '/api/v1/sites') {
    await handleListSites(req, res, deps);
    return true;
  }
  const routes: Array<[string, string, (params: Record<string, string>) => Promise<void>]> = [
    ['POST', '/api/v1/sites/:id/cognition/feedback', params => handleFlagKnowledge(req, res, params.id!, deps)],
    ['POST', '/api/v1/sites/:id/cognition/manual', params => handleAddManualExperience(req, res, params.id!, deps)],
    ['POST', '/api/v1/sites/:id/cognition/:knowledgeId/weight', params =>
      handleAdjustWeight(req, res, params.id!, params.knowledgeId!, deps)],
    ['GET', '/api/v1/sites/:id/cognition', params => handleGetCognition(req, res, params.id!, deps)],
    ['DELETE', '/api/v1/sites/:id/cognition', params => handleClearCognition(req, res, params.id!, deps)],
    ['GET', '/api/v1/sites/:id', params => handleGetSite(req, res, params.id!, deps)],
    ['PUT', '/api/v1/sites/:id', params => handleUpdateSite(req, res, params.id!, deps)],
    ['DELETE', '/api/v1/sites/:id', params => handleDeleteSite(req, res, params.id!, deps)],
  ];
  for (const [method, pattern, handler] of routes) {
    const match = matchRoute(pattern, pathname);
    if (req.method === method && match) {
      await handler(match);
      return true;
    }
  }
  return false;
}
