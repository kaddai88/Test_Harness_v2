import React, { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { useSessionStore } from '../stores/sessionStore';
import { Card } from '../components/ui/Card';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Spinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, icon, color }) => (
  <Card>
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-slate-400">{label}</p>
        <p className="mt-1 text-2xl font-bold text-slate-100">{value}</p>
      </div>
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${color}`}>
        {icon}
      </div>
    </div>
  </Card>
);

export const Dashboard: React.FC = () => {
  const { sessions, totalSessions, loading, fetchSessions } = useSessionStore();
  const navigate = useNavigate();

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  const stats = useMemo(() => {
    const safeSessions = sessions ?? [];
    const total = totalSessions ?? safeSessions.length;
    const active = safeSessions.filter((s) => s.status === 'queued' || s.status === 'running' || s.status === 'pending' || s.status === 'planning' || s.status === 'executing' || s.status === 'cancelling').length;
    const completed = safeSessions.filter((s) => s.status === 'completed');
    const avgScore =
      completed.length > 0
        ? completed.reduce((sum, s) => sum + (s.score ?? 0), 0) / completed.length
        : 0;
    const totalFindings = safeSessions.reduce((sum, s) => sum + (s.findings?.length ?? 0), 0);
    return { total, active, avgScore, totalFindings };
  }, [sessions, totalSessions]);

  const scoreDistribution = useMemo(() => {
    const safeSessions = sessions ?? [];
    const buckets = [
      { name: 'Excellent (90+)', value: 0, color: '#10b981' },
      { name: 'Good (70-89)', value: 0, color: '#3b82f6' },
      { name: 'Fair (50-69)', value: 0, color: '#f59e0b' },
      { name: 'Poor (0-49)', value: 0, color: '#ef4444' },
    ];
    for (const session of safeSessions) {
      if (session.score == null) continue;
      if (session.score >= 90) buckets[0]!.value++;
      else if (session.score >= 70) buckets[1]!.value++;
      else if (session.score >= 50) buckets[2]!.value++;
      else buckets[3]!.value++;
    }
    return buckets;
  }, [sessions]);

  const recentSessions = (sessions ?? []).slice(0, 5);

  if (loading && (sessions?.length ?? 0) === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-400">Overview of session activity and results</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Sessions"
          value={stats.total}
          color="bg-blue-600/20"
          icon={
            <svg className="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.75a2.25 2.25 0 0 1 2.25 2.25v3.776m-7.5 0H18" />
            </svg>
          }
        />
        <StatCard
          label="Active Sessions"
          value={stats.active}
          color="bg-emerald-600/20"
          icon={
            <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 5.636a9 9 0 1 0 12.728 0M12 3v9" />
            </svg>
          }
        />
        <StatCard
          label="Avg Score"
          value={Math.round(stats.avgScore)}
          color="bg-amber-600/20"
          icon={
            <svg className="h-5 w-5 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5z" />
            </svg>
          }
        />
        <StatCard
          label="Total Findings"
          value={stats.totalFindings}
          color="bg-red-600/20"
          icon={
            <svg className="h-5 w-5 text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent Sessions */}
        <Card className="lg:col-span-2">
          <h2 className="mb-4 text-lg font-semibold text-slate-100">Recent Sessions</h2>
          {recentSessions.length === 0 ? (
            <EmptyState
              title="No sessions yet"
              description="Create your first session to get started."
            />
          ) : (
            <div className="space-y-3">
              {recentSessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between rounded-lg border border-slate-700/50 bg-slate-800/50 p-3 transition-colors hover:bg-slate-700/30 cursor-pointer"
                  onClick={() => navigate(`/sessions/${session.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/sessions/${session.id}`);
                    }
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-200">
                      {session.targetUrl}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {new Date(session.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="ml-4 flex items-center gap-3">
                    {session.score != null && (
                      <span className="text-sm font-medium text-slate-300">
                        Score: {Math.round(session.score)}
                      </span>
                    )}
                    <StatusBadge status={session.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Score Distribution Chart */}
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-100">Score Distribution</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={scoreDistribution}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {scoreDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    color: '#e2e8f0',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-3">
            {scoreDistribution.map((bucket) => (
              <div key={bucket.name} className="flex items-center gap-1.5 text-xs text-slate-400">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: bucket.color }}
                />
                {bucket.name}
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Activity Timeline */}
      <Card>
        <h2 className="mb-4 text-lg font-semibold text-slate-100">Session Activity</h2>
        {sessions.length === 0 ? (
          <EmptyState
            title="No activity"
            description="Session activity will appear here."
          />
        ) : (
          <div className="relative space-y-4 before:absolute before:left-[7px] before:top-2 before:h-[calc(100%-16px)] before:w-px before:bg-slate-700">
            {recentSessions.map((session) => (
              <div key={session.id} className="relative flex items-start gap-3 pl-6">
                <span
                  className={`absolute left-0 top-1.5 h-[15px] w-[15px] rounded-full border-2 ${
                    session.status === 'completed'
                      ? 'border-emerald-500 bg-emerald-500/20'
                      : session.status === 'running'
                        ? 'border-blue-500 bg-blue-500/20'
                        : session.status === 'failed'
                          ? 'border-red-500 bg-red-500/20'
                          : 'border-slate-500 bg-slate-500/20'
                  }`}
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-200">
                    {session.status === 'completed'
                      ? `Session completed`
                      : session.status === 'running'
                        ? `Session in progress`
                        : session.status === 'failed'
                          ? `Session failed`
                          : `Session created`}
                  </p>
                  <p className="text-xs text-slate-400">
                    {session.targetUrl} · {new Date(session.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};
