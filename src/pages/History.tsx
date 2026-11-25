/** Full match history with per-match detail. */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Empty, Spinner, Avatar } from '../components/ui';
import { MatchRow, timeAgo } from './Dashboard';
import type { MatchHistoryEntry } from '../../shared/types';

export function History() {
  const [rows, setRows] = useState<MatchHistoryEntry[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'win' | 'loss'>('all');

  useEffect(() => {
    api.get<MatchHistoryEntry[]>('/matches/history').then(setRows).catch(() => setRows([]));
  }, []);

  if (!rows)
    return (
      <div className="grid place-items-center py-20">
        <Spinner size={26} />
      </div>
    );

  const shown = rows.filter((r) => filter === 'all' || r.outcome === filter);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black">Match history</h1>
          <p className="text-xs text-slate-400">{rows.length} completed matches</p>
        </div>
        <div className="flex gap-1 rounded-xl bg-black/30 p-1">
          {(['all', 'win', 'loss'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold capitalize ${
                filter === f ? 'bg-emerald-500 text-emerald-950' : 'text-slate-300'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="glass rounded-2xl p-6">
          <Empty icon="🎮" title="Nothing here" hint="Play a match to build your history" />
        </div>
      ) : (
        <div className="grid gap-2">
          {shown.map((m) => (
            <div key={m.id} className="glass rounded-xl p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div
                  className={`chip ${
                    m.outcome === 'win'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : m.outcome === 'loss'
                      ? 'bg-rose-500/20 text-rose-300'
                      : 'bg-white/10 text-slate-300'
                  }`}
                >
                  {m.outcome.toUpperCase()}
                </div>
                <div className="font-mono text-lg font-black">
                  {m.myScore}–{m.opponentScore}
                </div>
                <div className="text-[11px] capitalize text-slate-400">{m.mode}</div>
                <div className="flex items-center gap-1 text-[11px] text-slate-400">
                  <span>with</span>
                  {m.partners.map((p) => (
                    <span key={p.username} className="flex items-center gap-0.5">
                      <Avatar emoji={p.avatar} size={16} /> {p.username}
                    </span>
                  ))}
                  <span className="mx-1 text-slate-600">vs</span>
                  {m.opponents.map((p) => (
                    <span key={p.username} className="flex items-center gap-0.5">
                      <Avatar emoji={p.avatar} size={16} /> {p.username}
                    </span>
                  ))}
                </div>
                <div className="ml-auto flex items-center gap-3 text-[11px]">
                  <span className={m.ratingDelta >= 0 ? 'font-bold text-emerald-400' : 'font-bold text-rose-400'}>
                    {m.ratingDelta >= 0 ? '+' : ''}
                    {m.ratingDelta} rating
                  </span>
                  <span className="text-slate-500">{timeAgo(m.playedAt)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
