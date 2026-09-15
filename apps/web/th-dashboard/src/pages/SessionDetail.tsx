import React, { useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { SeverityBadge } from '../components/ui/SeverityBadge';
import { Spinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import type { AgentActivity, Finding } from '../types';

export const SessionDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    currentSession,
    findings,
    agentActivity,
    streamText,
    loading,
    wsConnected,
    fetchSession,
    cancelSession,
    connectWebSocket,
  } = useSessionStore();

  const streamEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (id) {
      void fetchSession(id);
    }
  }, [id, fetchSession]);

  const isActive: boolean = !!(currentSession?.status === 'running' || currentSession?.status === 'pending' || currentSession?.status === 'planning' || currentSession?.status === 'executing' || currentSession?.status === 'cancelling');

  // Load activities from metadata for completed sessions
  const historicalActivities: AgentActivity[] = useMemo(() => {
    const acts = (currentSession?.metadata?.activities as Record<string, unknown>[] | undefined) ?? [];
    return acts.map((a, i) => ({
      id: `hist_${i}`,
      sessionId: currentSession?.id,
      turn: (a.turn as number) ?? 0,
      kind: (a.kind as AgentActivity['kind']) ?? 'turn_started',
      tool: a.tool as string | undefined,
      input: a.input as Record<string, unknown> | undefined,
      success: a.success as boolean | undefined,
      partial: a.partial as string | undefined,
      done: a.done as boolean | undefined,
      timestamp: (a.timestamp as number) ?? Date.now(),
    }));
  }, [currentSession?.id, currentSession?.metadata?.activities]);

  // Use historical activities for completed sessions, live for active
  const displayActivities = !isActive ? historicalActivities : agentActivity;
  const groupedSteps = useMemo(() => groupActivitiesByTurn(displayActivities), [displayActivities]);

  // Auto-scroll to latest activity (must come after displayActivities declaration)
  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayActivities.length, streamText]);

  useEffect(() => {
    if (!currentSession || currentSession.status === 'completed' || currentSession.status === 'failed' || currentSession.status === 'cancelled') {
      return;
    }
    const disconnect = connectWebSocket();
    return disconnect;
  }, [currentSession?.status, connectWebSocket]);

  const phase: string = currentSession ? ((currentSession.phase as string) || (currentSession.status as string) || '') : '';

  if (loading && !currentSession) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!currentSession) {
    return (
      <EmptyState
        title="Session not found"
        description="The session you're looking for doesn't exist."
        action={
          <Button variant="secondary" onClick={() => navigate('/')}>
            Back to Dashboard
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-100">Test Session</h1>
            <StatusBadge status={currentSession.status} />
          </div>
          <p className="mt-1 text-sm text-slate-400">{currentSession.targetUrl}</p>
          {currentSession.startedAt && (
            <p className="mt-0.5 text-xs text-slate-500">
              Started {new Date(currentSession.startedAt).toLocaleTimeString()}
              {currentSession.completedAt && (
                <> · Duration {Math.round((new Date(currentSession.completedAt).getTime() - new Date(currentSession.startedAt).getTime()) / 1000)}s</>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isActive && currentSession.status !== 'cancelling' && (
            <Button variant="danger" onClick={() => id && cancelSession(id)}>
              Cancel
            </Button>
          )}
          {!isActive && currentSession.status === 'completed' && id && (
            <Button variant="secondary" onClick={() => navigate(`/sessions/${id}/report`)}>
              View Report
            </Button>
          )}
        </div>
      </div>

      {isActive && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2.5">
          {currentSession.status === 'cancelling' ? (
            <span className="text-sm font-medium text-orange-300">Cancelling…</span>
          ) : (
            <>
              <Spinner size="sm" />
              <span className="text-sm font-medium text-blue-300">
                {phase === 'planning' ? ' AI is generating test plan...' :
                 phase === 'executing' ? '🔧 Running browser tests...' :
                 `⏳ ${phase}`}
              </span>
            </>
          )}
          <span className="ml-auto text-xs">
            {wsConnected ? (
              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-emerald-400"> WS connected</span>
            ) : (
              <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-red-400"> WS disconnected</span>
            )}
          </span>
        </div>
      )}

      {Boolean(currentSession.metadata?.workflowState) && (() => {
        const wfState = String(currentSession.metadata?.workflowState ?? '');
        const wfMessage = currentSession.metadata?.workflowMessage ? String(currentSession.metadata.workflowMessage) : null;
        return (
          <div className="flex items-center gap-2 rounded-lg border border-purple-500/30 bg-purple-500/10 px-4 py-2">
            <span className="text-sm font-medium text-purple-300">
              状态机：{wfState}
            </span>
            {wfMessage && (
              <span className="text-xs text-purple-400">
                — {wfMessage}
              </span>
            )}
          </div>
        );
      })()}

      {currentSession.postProcessingStatus && currentSession.postProcessingStatus !== 'not_started' && currentSession.postProcessingStatus !== 'not_applicable' && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/40 px-4 py-2 text-sm text-slate-300">
          Enrichment: {currentSession.postProcessingStatus}
          {currentSession.postProcessingError && ` — ${currentSession.postProcessingError}`}
        </div>
      )}

      {/* ── Main Chat Stream ── */}
      <Card className="min-h-[400px] max-h-[70vh] overflow-y-auto scrollbar-thin">
        {displayActivities.length === 0 && !streamText ? (
          <div className="flex flex-col items-center justify-center py-16">
            {wsConnected ? (
              <>
                <Spinner size="lg" />
                <p className="mt-4 text-sm text-slate-400">Connecting to agent...</p>
                <p className="mt-1 text-xs text-slate-500">WebSocket connected, waiting for events</p>
              </>
            ) : (
              <EmptyState
                title="WebSocket disconnected"
                description="Unable to connect to the real-time event stream. Check your network connection and try refreshing the page."
              />
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {groupedSteps.map((group, gi) => (
              <TurnGroup key={gi} turn={group.turn} activities={group.activities} />
            ))}

            {/* Live stream text (AI thinking/speaking) */}
            {streamText && (
              <div className="flex gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-blue-500 text-xs text-white">

                </div>
                <div className="flex-1 rounded-xl rounded-tl-none bg-slate-800/80 px-4 py-3">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300 font-mono">
                    {streamText}
                    <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded bg-blue-400" />
                  </p>
                </div>
              </div>
            )}

            <div ref={streamEndRef} />
          </div>
        )}
      </Card>

      {/* ── Findings ─ */}
      {findings.length > 0 && (
        <Card>
          <h2 className="mb-3 text-lg font-semibold text-slate-100">
            Findings
            <span className="ml-2 rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
              {findings.length}
            </span>
          </h2>
          <div className="space-y-2">
            {[...findings]
              .sort((a, b) => {
                const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
                return (order[a.severity] ?? 5) - (order[b.severity] ?? 5);
              })
              .map((finding) => (
                <FindingCard key={finding.id} finding={finding} />
              ))}
          </div>
        </Card>
      )}

      {/* ── Execution Summary ── */}
      {currentSession.metadata?.executionSummary && (
        <Card>
          <h2 className="mb-3 text-lg font-semibold text-slate-100">Execution Summary</h2>
          <div className="space-y-4">
            {/* Overview */}
            {currentSession.metadata.executionSummary.overview && (
              <div>
                <p className="text-sm font-medium text-slate-200">Overview</p>
                <p className="mt-1 text-sm text-slate-300">{currentSession.metadata.executionSummary.overview}</p>
              </div>
            )}

            {/* Test Cases Table */}
            {currentSession.metadata.executionSummary.testCases && currentSession.metadata.executionSummary.testCases.length > 0 && (
              <div>
                <p className="text-sm font-medium text-slate-200 mb-2">Test Cases ({currentSession.metadata.executionSummary.testCases.length})</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700">
                        <th className="px-3 py-2 text-left text-xs font-medium text-slate-400 uppercase">#</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-slate-400 uppercase">Action</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-slate-400 uppercase">Result</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-slate-400 uppercase">Screenshot</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentSession.metadata.executionSummary.testCases.map((tc, i) => (
                        <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                          <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                          <td className="px-3 py-2 text-slate-200">{tc.action}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${
                              tc.result === 'success' ? 'bg-emerald-500/20 text-emerald-400' :
                              tc.result === 'failed' ? 'bg-red-500/20 text-red-400' :
                              'bg-slate-600/20 text-slate-400'
                            }`}>
                              {tc.result === 'success' ? '✓ Pass' : tc.result === 'failed' ? '✗ Fail' : '— Pending'}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            {tc.screenshot ? (
                              <img
                                src={`data:${tc.screenshotMimeType ?? 'image/png'};base64,${tc.screenshot}`}
                                alt={`Screenshot for ${tc.action}`}
                                className="max-h-20 rounded border border-slate-700 cursor-pointer hover:border-slate-500 transition-colors"
                                onClick={() => {
                                  const w = window.open('', '_blank');
                                  if (w) {
                                    w.document.write(`<img src="data:${tc.screenshotMimeType ?? 'image/png'};base64,${tc.screenshot}" style="max-width:100%" />`);
                                  }
                                }}
                              />
                            ) : (
                              <span className="text-xs text-slate-600">No screenshot</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Conclusion */}
            {currentSession.metadata.executionSummary.conclusion && (
              <div>
                <p className="text-sm font-medium text-slate-200">Conclusion</p>
                <p className="mt-1 text-sm text-slate-300">{currentSession.metadata.executionSummary.conclusion}</p>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ── AI Summary ── */}
      {typeof currentSession.metadata?.summary === 'string' && currentSession.metadata.summary && (
        <Card>
          <h2 className="mb-3 text-lg font-semibold text-slate-100">AI Summary</h2>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
            {currentSession.metadata.summary}
          </div>
        </Card>
      )}
    </div>
  );
};

// ── Turn Group (groups activities by turn number) ──
interface TurnGroupProps {
  turn: number;
  activities: AgentActivity[];
}

const TurnGroup: React.FC<TurnGroupProps> = ({ turn, activities }) => {
  return (
    <div className="space-y-2">
      {/* Turn header */}
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 text-xs font-bold text-slate-300">
          {turn}
        </span>
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Turn {turn}
        </span>
        <div className="flex-1 border-t border-slate-700/50" />
      </div>

      {/* Activities in this turn */}
      {activities.map((activity) => (
        <ActivityRow key={activity.id} activity={activity} />
      ))}
    </div>
  );
};

// ── Activity Row (renders different kinds of steps) ──
interface ActivityRowProps {
  activity: AgentActivity;
}

const ActivityRow: React.FC<ActivityRowProps> = ({ activity }) => {
  switch (activity.kind) {
    case 'turn_started':
      return (
        <div className="flex items-center gap-2 pl-9 text-xs text-slate-500">
          <span className="animate-pulse">●</span>
          <span>Thinking...</span>
        </div>
      );

    case 'tool_call': {
      const tool = activity.tool ?? 'unknown';
      const input = activity.input ?? {};
      const description = describeToolCall(tool, input);

      return (
        <div className="flex items-start gap-3 pl-9">
          <div className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-blue-500/20 text-xs text-blue-400">
            →
          </div>
          <div className="flex-1">
            <p className="text-sm text-slate-200">
              {description}
              <span className="ml-2 rounded bg-slate-700/60 px-1.5 py-0.5 text-xs text-slate-400 font-mono">
                {tool}
              </span>
            </p>
            {tool === 'report_finding' && !!input.title && (
              <div className="mt-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <p className="text-xs font-medium text-amber-300">
                  ⚠ Finding: {String(input.title)}
                </p>
                {!!input.description && (
                  <p className="mt-0.5 text-xs text-amber-200/70">
                    {String(input.description)}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    case 'tool_result': {
      const success = activity.success;
      return (
        <div className="flex items-center gap-3 pl-9">
          <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs ${
            success ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
          }`}>
            {success ? '✓' : ''}
          </div>
          <span className="text-xs text-slate-500">
            {activity.tool} {success ? 'completed' : 'failed'}
          </span>
        </div>
      );
    }

    case 'stream':
      // Stream chunks are rendered separately via streamText
      return null;

    default:
      return null;
  }
};

// ── Finding Card (standalone finding from completed session) ──
interface FindingCardProps {
  finding: Finding;
}

const FindingCard: React.FC<FindingCardProps> = ({ finding }) => (
  <div className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-3">
    <div className="mb-1 flex items-center justify-between gap-2">
      <SeverityBadge severity={finding.severity} />
    </div>
    <p className="text-sm font-medium text-slate-200">{finding.title}</p>
    <p className="mt-1 text-xs text-slate-400">{finding.description}</p>
    {finding.recommendation && (
      <p className="mt-2 text-xs text-blue-300/80">💡 {finding.recommendation}</p>
    )}
    {finding.evidence?.url && (
      <p className="mt-1 text-xs text-slate-500 truncate"> {finding.evidence.url}</p>
    )}
  </div>
);

// ─ Helpers ──

interface TurnGroup {
  turn: number;
  activities: AgentActivity[];
}

function groupActivitiesByTurn(activities: AgentActivity[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  let currentTurn = -1;
  let currentGroup: AgentActivity[] = [];

  for (const activity of activities) {
    if (activity.turn !== currentTurn) {
      if (currentGroup.length > 0) {
        groups.push({ turn: currentTurn, activities: currentGroup });
      }
      currentTurn = activity.turn;
      currentGroup = [activity];
    } else {
      currentGroup.push(activity);
    }
  }

  if (currentGroup.length > 0) {
    groups.push({ turn: currentTurn, activities: currentGroup });
  }

  return groups;
}

function describeToolCall(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case 'navigate_to':
      return `Navigate to ${input.url ?? '...'}`;
    case 'click_element':
      return `Click on ${input.selector ?? input.description ?? 'element'}`;
    case 'fill_input':
      return `Fill input: ${input.selector ?? ''} = ${input.value ?? '...'}`;
    case 'fill_form':
      return `Fill form: ${input.selector ?? ''} = ${input.value ?? '...'}`;
    case 'assert_visible':
      return `Check visible: ${input.selector ?? '...'}`;
    case 'assert_text':
      return `Check text contains "${input.text ?? '...'}"`;
    case 'take_screenshot':
      return 'Take screenshot';
    case 'measure_performance':
      return 'Measure performance';
    case 'http_request':
      return `HTTP ${input.method ?? 'GET'} ${input.url ?? '...'}`;
    case 'report_finding':
      return `Report finding: ${input.title ?? 'issue'}`;
    default:
      return `Call ${tool}`;
  }
}
