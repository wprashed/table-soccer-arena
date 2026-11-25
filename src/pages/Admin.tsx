/** Moderation console: reports, bans and the audit trail (admin role only). */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { Empty, Spinner } from '../components/ui';

export function Admin() {
  const { toast } = useApp();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .get<any>('/admin/overview')
      .then(setData)
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  const ban = async (userId: string, reason: string) => {
    try {
      await api.post('/admin/ban', { userId, ban: true, reason });
      toast('Player banned', 'success');
      load();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };
  const resolve = async (id: number, status: string) => {
    await api.post(`/admin/reports/${id}/resolve`, { status }).catch(() => {});
    load();
  };

  if (error)
    return (
      <div className="glass rounded-2xl p-6 text-center">
        <div className="text-lg font-black">Access denied</div>
        <p className="mt-1 text-xs text-slate-400">{error}</p>
      </div>
    );
  if (!data)
    return (
      <div className="grid place-items-center py-20">
        <Spinner size={26} />
      </div>
    );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black">Moderation</h1>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { k: 'Players', v: data.users },
          { k: 'Matches', v: data.matches },
          { k: 'Open reports', v: data.reports.length },
          { k: 'Coins in economy', v: data.economy?.coins ?? 0 },
        ].map((s) => (
          <div key={s.k} className="glass rounded-xl p-3">
            <div className="text-[10px] uppercase tracking-widest text-slate-500">{s.k}</div>
            <div className="text-xl font-black">{s.v}</div>
          </div>
        ))}
      </div>

      <div className="glass rounded-2xl p-4">
        <h2 className="mb-2 text-sm font-black uppercase tracking-widest text-slate-300">Open reports</h2>
        {data.reports.length === 0 ? (
          <Empty icon="🛡️" title="No open reports" />
        ) : (
          <div className="space-y-2">
            {data.reports.map((r: any) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-white/[0.04] p-2 text-xs">
                <span className="chip bg-rose-500/20 text-rose-300">{r.reason}</span>
                <b>{r.target}</b>
                <span className="text-slate-500">{r.details}</span>
                <div className="ml-auto flex gap-1">
                  <button className="btn btn-flame px-2 py-1 text-[10px]" onClick={() => ban(r.target_id, r.reason)}>
                    Ban
                  </button>
                  <button className="btn btn-ghost px-2 py-1 text-[10px]" onClick={() => resolve(r.id, 'dismiss')}>
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="glass rounded-2xl p-4">
        <h2 className="mb-2 text-sm font-black uppercase tracking-widest text-slate-300">Audit log</h2>
        <div className="scroll-thin max-h-72 space-y-1 overflow-y-auto font-mono text-[10px] text-slate-400">
          {data.audit.map((a: any) => (
            <div key={a.id} className="flex gap-2 border-b border-white/5 py-1">
              <span className="text-slate-600">{a.created_at.slice(11, 19)}</span>
              <span className="text-emerald-400">{a.action}</span>
              <span className="truncate text-slate-500">{a.target}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
