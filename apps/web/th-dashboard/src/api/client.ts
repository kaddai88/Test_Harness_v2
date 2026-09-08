import type {
  Session,
  SessionCreateRequest,
  SessionCreateResponse,
  HealthStatus,
  PaginatedResponse,
  SiteProfile,
} from '../types';

const API_BASE = '/api/v1';

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`API error ${response.status}: ${body || response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  getSessions: (page = 1, pageSize = 20, status?: string): Promise<PaginatedResponse<Session>> => {
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String((page - 1) * pageSize),
    });
    if (status && status !== 'all') {
      params.set('status', status);
    }
    return fetch(`${API_BASE}/sessions?${params}`).then(handleResponse<PaginatedResponse<Session>>);
  },

  getSession: (id: string): Promise<Session> =>
    fetch(`${API_BASE}/sessions/${id}`).then(handleResponse<Session>),

  createSession: (data: SessionCreateRequest): Promise<SessionCreateResponse> =>
    fetch(`${API_BASE}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUrl: data.targetUrl ?? data.url,
        scanConfig: {
          instructions: data.instructions,
          images: data.images,
          maxTurns: data.maxTurns,
          maxRetriesPerAction: data.maxRetriesPerAction,
          testType: data.testType,
        },
      }),
    }).then(handleResponse<SessionCreateResponse>),

  cancelSession: (id: string): Promise<void> =>
    fetch(`${API_BASE}/sessions/${id}/cancel`, { method: 'POST' }).then((r) => {
      if (!r.ok) throw new Error(`Failed to cancel session: ${r.statusText}`);
    }),

  getReport: (id: string, format: string): Promise<{ content: string; raw?: string }> =>
    fetch(`${API_BASE}/sessions/${id}/report?format=${format}`).then(async (r) => {
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(`API error ${r.status}: ${text || r.statusText}`);
      }
      const contentType = r.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        return r.json() as Promise<{ content: string }>;
      }
      // Markdown or HTML — return raw text
      const text = await r.text();
      return { content: text, raw: text };
    }),

  getHealth: (): Promise<HealthStatus> =>
    fetch(`${API_BASE}/health`).then(handleResponse<HealthStatus>),

  // Site profile endpoints
  getSites: (): Promise<{ sites: SiteProfile[] }> =>
    fetch(`${API_BASE}/sites`).then(handleResponse<{ sites: SiteProfile[] }>),

  getSite: (id: string): Promise<{ site: SiteProfile }> =>
    fetch(`${API_BASE}/sites/${id}`).then(handleResponse<{ site: SiteProfile }>),

  updateSite: (id: string, data: { name?: string; baseUrl?: string; clearCache?: boolean }): Promise<{ success: boolean; site: SiteProfile }> =>
    fetch(`${API_BASE}/sites/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(handleResponse<{ success: boolean; site: SiteProfile }>),

  deleteSite: (id: string): Promise<{ success: boolean }> =>
    fetch(`${API_BASE}/sites/${id}`, { method: 'DELETE' }).then(handleResponse<{ success: boolean }>),

  clearSiteCognition: (id: string): Promise<{ success: boolean }> =>
    fetch(`${API_BASE}/sites/${encodeURIComponent(id)}/cognition`, { method: 'DELETE' }).then(handleResponse<{ success: boolean }>),

  // Cognition feedback endpoints
  flagKnowledge: (siteId: string, knowledgeId: string, reason: string): Promise<{ success: boolean; message: string }> =>
    fetch(`${API_BASE}/sites/${encodeURIComponent(siteId)}/cognition/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ knowledgeId, reason }),
    }).then(handleResponse<{ success: boolean; message: string }>),

  addManualExperience: (siteId: string, data: {
    description: string;
    type: 'session_summary' | 'bug_found' | 'recovery_success' | 'site_discovery';
    outcome: 'success' | 'failure' | 'partial' | 'neutral';
    findings?: Array<{ severity: string; title: string; description: string }>;
  }): Promise<{ success: boolean; episodeId: string; message: string }> =>
    fetch(`${API_BASE}/sites/${encodeURIComponent(siteId)}/cognition/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(handleResponse<{ success: boolean; episodeId: string; message: string }>),

  adjustKnowledgeWeight: (siteId: string, knowledgeId: string, factor: number): Promise<{ success: boolean; message: string }> =>
    fetch(`${API_BASE}/sites/${encodeURIComponent(siteId)}/cognition/${encodeURIComponent(knowledgeId)}/weight`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ factor }),
    }).then(handleResponse<{ success: boolean; message: string }>),
};
