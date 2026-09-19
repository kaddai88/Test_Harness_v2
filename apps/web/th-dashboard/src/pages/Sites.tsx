import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { api } from '../api/client';
import type { SiteProfile } from '../types';

export const Sites: React.FC = () => {
  const [sites, setSites] = useState<SiteProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingSite, setEditingSite] = useState<SiteProfile | null>(null);
  const [editName, setEditName] = useState('');

  useEffect(() => {
    loadSites();
  }, []);

  const loadSites = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getSites();
      setSites(data.sites);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sites');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (site: SiteProfile) => {
    setEditingSite(site);
    setEditName(site.name);
  };

  const handleSave = async () => {
    if (!editingSite) return;
    try {
      await api.updateSite(editingSite.baseUrl, {
        name: editName,
      });
      setEditingSite(null);
      loadSites();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update site');
    }
  };

  const handleClearCache = async (site: SiteProfile) => {
    if (!confirm(`Clear all cached elements for "${site.name}"?`)) return;
    try {
      await api.updateSite(site.baseUrl, { clearCache: true });
      loadSites();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear cache');
    }
  };

  const handleDelete = async (site: SiteProfile) => {
    if (!confirm(`Delete site profile "${site.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteSite(site.baseUrl);
      loadSites();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete site');
    }
  };

  const handleClearCognition = async (site: SiteProfile) => {
    if (!confirm(`Clear all cognition memory for "${site.name}"? This will remove learned episodes, knowledge, and procedures.`)) return;
    try {
      await api.clearSiteCognition(site.baseUrl);
      loadSites();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear cognition data');
    }
  };

  const handleFlagKnowledge = async (site: SiteProfile, knowledgeId: string) => {
    const reason = prompt('Why is this knowledge inaccurate?');
    if (!reason) return;
    try {
      await api.flagKnowledge(site.baseUrl, knowledgeId, reason);
      loadSites();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to flag knowledge');
    }
  };

  const handleBoostKnowledge = async (site: SiteProfile, knowledgeId: string) => {
    try {
      await api.adjustKnowledgeWeight(site.baseUrl, knowledgeId, 0.1);
      loadSites();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to boost knowledge');
    }
  };

  const handleAddExperience = async (site: SiteProfile) => {
    const description = prompt('Describe the experience (e.g., "Login requires email + password, no CAPTCHA"):');
    if (!description) return;
    const type = prompt('Type (session_summary, bug_found, recovery_success, site_discovery):', 'site_discovery');
    if (!type) return;
    const outcome = prompt('Outcome (success, failure, partial, neutral):', 'success');
    if (!outcome) return;
    try {
      await api.addManualExperience(site.baseUrl, {
        description,
        type: type as any,
        outcome: outcome as any,
      });
      loadSites();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add experience');
    }
  };

  const formatDate = (ts: number | string | null) => {
    if (!ts) return 'Never';
    return new Date(ts).toLocaleString();
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Site Profiles</h1>
          <p className="text-sm text-slate-400">
            Learned knowledge about target websites. Auto-learned from test sessions.
          </p>
        </div>
        <Button onClick={loadSites} variant="secondary">
          Refresh
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        </div>
      ) : sites.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center py-12 text-center">
            <svg className="mb-4 h-12 w-12 text-slate-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
            </svg>
            <h3 className="text-lg font-medium text-slate-300">No Site Profiles</h3>
            <p className="mt-1 text-sm text-slate-400">
              Site profiles are automatically learned when you run test sessions.
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4">
          {sites.map((site) => (
            <Card key={site.baseUrl}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold text-slate-100">{site.name}</h3>
                    <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-xs text-blue-400">
                      {site.elementCache.length} cached elements
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-400">{site.baseUrl}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Last updated: {formatDate(site.updatedAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => handleEdit(site)} variant="secondary" size="sm">
                    Edit
                  </Button>
                  <Button onClick={() => handleClearCache(site)} variant="secondary" size="sm">
                    Clear Cache
                  </Button>
                  <Button onClick={() => handleDelete(site)} variant="danger" size="sm">
                    Delete
                  </Button>
                </div>
              </div>

              {/* Element cache preview */}
              {site.elementCache.length > 0 && (
                <div className="mt-4 border-t border-slate-700 pt-4">
                  <h4 className="mb-2 text-sm font-medium text-slate-300">Cached Elements</h4>
                  <div className="max-h-40 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-slate-800">
                        <tr className="text-left text-xs text-slate-400">
                          <th className="pb-2 pr-4">Hint</th>
                          <th className="pb-2 pr-4">Selector</th>
                          <th className="pb-2 pr-4">Hits</th>
                          <th className="pb-2">Last Used</th>
                        </tr>
                      </thead>
                      <tbody>
                        {site.elementCache.slice(0, 10).map((el, i) => (
                          <tr key={i} className="border-t border-slate-700/50">
                            <td className="py-2 pr-4 text-slate-300">{el.hint}</td>
                            <td className="py-2 pr-4 font-mono text-xs text-slate-400">{el.selector}</td>
                            <td className="py-2 pr-4 text-slate-400">{el.hitCount}</td>
                            <td className="py-2 text-xs text-slate-500">{formatDate(el.lastVerified)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {site.elementCache.length > 10 && (
                      <p className="mt-2 text-xs text-slate-500">
                        Showing 10 of {site.elementCache.length} cached elements
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Cognition stats — always show to indicate the system exists */}
              {site.cognition && (
                <div className="mt-4 border-t border-slate-700 pt-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-medium text-slate-300">Cognition Memory</h4>
                      {(site.cognition.episodes === 0 && site.cognition.knowledge === 0) && (
                        <span className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-400">
                          No data yet — will populate after test sessions
                        </span>
                      )}
                    </div>
                    {(site.cognition.episodes > 0 || site.cognition.knowledge > 0) && (
                      <Button
                        onClick={() => handleClearCognition(site)}
                        variant="secondary"
                        size="sm"
                      >
                        Clear Memory
                      </Button>
                    )}
                  </div>
                  <div className="mb-3 grid grid-cols-4 gap-2">
                    <div className="rounded bg-slate-800 p-2 text-center">
                      <div className={`text-lg font-bold ${site.cognition.episodes > 0 ? 'text-blue-400' : 'text-slate-600'}`}>{site.cognition.episodes}</div>
                      <div className="text-xs text-slate-400">Episodes</div>
                    </div>
                    <div className="rounded bg-slate-800 p-2 text-center">
                      <div className={`text-lg font-bold ${site.cognition.knowledge > 0 ? 'text-green-400' : 'text-slate-600'}`}>{site.cognition.knowledge}</div>
                      <div className="text-xs text-slate-400">Knowledge</div>
                    </div>
                    <div className="rounded bg-slate-800 p-2 text-center">
                      <div className={`text-lg font-bold ${site.cognition.procedures > 0 ? 'text-purple-400' : 'text-slate-600'}`}>{site.cognition.procedures}</div>
                      <div className="text-xs text-slate-400">Procedures</div>
                    </div>
                    <div className="rounded bg-slate-800 p-2 text-center">
                      <div className={`text-lg font-bold ${site.cognition.patterns > 0 ? 'text-orange-400' : 'text-slate-600'}`}>{site.cognition.patterns}</div>
                      <div className="text-xs text-slate-400">Patterns</div>
                    </div>
                  </div>

                  {/* Recent episodes */}
                  {site.cognition.recentEpisodes.length > 0 && (
                    <div className="mb-3">
                      <h5 className="mb-1 text-xs font-medium text-slate-400">Recent Episodes</h5>
                      <div className="max-h-32 overflow-y-auto">
                        {site.cognition.recentEpisodes.map((ep) => (
                          <div key={ep.id} className="flex items-center gap-2 border-b border-slate-700/50 py-1 text-xs">
                            <span className={`rounded px-1 ${
                              ep.outcome === 'success' ? 'bg-green-500/20 text-green-400' :
                              ep.outcome === 'failure' ? 'bg-red-500/20 text-red-400' :
                              'bg-slate-500/20 text-slate-400'
                            }`}>
                              {ep.outcome}
                            </span>
                            <span className="flex-1 truncate text-slate-300">{ep.description}</span>
                            <span className="text-slate-500">{formatDate(ep.timestamp)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recent knowledge */}
                  {site.cognition.recentKnowledge.length > 0 && (
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <h5 className="text-xs font-medium text-slate-400">Learned Knowledge</h5>
                        <Button
                          onClick={() => handleAddExperience(site)}
                          variant="secondary"
                          size="sm"
                        >
                          + Add Experience
                        </Button>
                      </div>
                      <div className="max-h-32 overflow-y-auto">
                        {site.cognition.recentKnowledge.map((k) => (
                          <div key={k.id} className="flex items-center gap-2 border-b border-slate-700/50 py-1 text-xs">
                            <span className="rounded bg-blue-500/20 px-1 text-blue-400">{k.type}</span>
                            <span className="flex-1 truncate text-slate-300">{k.title}</span>
                            <span className="text-slate-500">{(k.confidence * 100).toFixed(0)}%</span>
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleBoostKnowledge(site, k.id)}
                                className="rounded bg-green-500/20 px-1 py-0.5 text-green-400 hover:bg-green-500/30"
                                title="Boost confidence"
                              >
                                ▲
                              </button>
                              <button
                                onClick={() => handleFlagKnowledge(site, k.id)}
                                className="rounded bg-red-500/20 px-1 py-0.5 text-red-400 hover:bg-red-500/30"
                                title="Flag as inaccurate"
                              >
                                ▼
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Edit modal */}
      {editingSite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md">
            <h2 className="mb-4 text-lg font-semibold text-slate-100">Edit Site Profile</h2>
            <div className="space-y-4">
              <Input
                label="Site Name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
              <Input label="Canonical origin" value={editingSite.canonicalOriginKey} disabled />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button onClick={() => setEditingSite(null)} variant="secondary">
                Cancel
              </Button>
              <Button onClick={handleSave}>
                Save
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};
