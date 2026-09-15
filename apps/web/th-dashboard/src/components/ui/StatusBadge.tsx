import React from 'react';
import type { SessionStatus } from '../../types';

interface StatusBadgeProps {
  status: SessionStatus;
}

const statusStyles: Record<SessionStatus, string> = {
  queued: 'bg-slate-400/20 text-slate-400 border-slate-400/30',
  pending: 'bg-slate-400/20 text-slate-400 border-slate-400/30',
  planning: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  executing: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  running: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  cancelling: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  completed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  failed: 'bg-red-500/20 text-red-400 border-red-500/30',
  cancelled: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${statusStyles[status]}`}
  >
    {(status === 'running' || status === 'planning' || status === 'executing' || status === 'cancelling') && (
      <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
    )}
    {status === 'cancelling' ? 'Cancelling…' : status}
  </span>
);
