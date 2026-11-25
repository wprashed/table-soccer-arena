/** Tournament hub: create, join, start and view standings. */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { Empty, Modal, Spinner, Avatar } from '../components/ui';

export function Tournaments() {
  const { profile, toast, refresh } = useApp();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [format, setFormat] = useState<'knockout' | 'league'>('knockout');
  const [maxTeams, setMaxTeams] = useState(4);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .get<any[]>('/tournaments')
      .then(setList)
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ tournament: any }>('/tournaments', { name, format, maxTeams });
      toast('Tournament created', 'success');
      setOpen(false);
      setName('');
      setSelected(res.tournament.id);
      await load();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const join = async (t: any) => {
    setBusy(true);
    try {
      await api.post(`/tournaments/${t.id}/join`, { teamName: profile?.user.username });
      toast('Registered — waiting for the organiser to start', 'success');
      await load();
      setSelected(t.id);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const start = async (t: any) => {
    setBusy(true);
    try {
      const res = await api.post<{ fixturesRun: number }>(`/tournaments/${t.id}/start`);
      toast(`Tournament simulated — ${res.fixturesRun} fixtures played`, 'success');
      await load();
      refresh();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const detail = list.find((t) => t.id === selected) ?? null;
  const myEntry = (t: any) => t.participants?.find((p: any) => p.members.some((m: any) => m.id === profile?.user.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black">Tournaments</h1>
          <p className="text-xs text-slate-400">
            Solo sign-up — the organiser starts it and the server pairs players into 2v2 teams.
          </p>
        </div>
        <button className="btn btn-primary px-4 py-2.5" onClick={() => setOpen(true)}>
          + Create tournament
        </button>
      </div>

      {loading ? (
        <div className="grid place-items-center py-16"><Spinner size={26} /></div>
      ) : list.length === 0 ? (
        <div className="glass rounded-2xl p-6">
          <Empty icon="🏆" title="No tournaments yet" hint="Create the first one and invite players" />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((t) => {
            const mine = myEntry(t);
            return (
              <div key={t.id} className={`glass card-hover rounded-2xl p-4 ${selected === t.id ? 'ring-1 ring-emerald-400/60' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-black">{t.name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-slate-400">
                      <span className="chip bg-white/5 capitalize">{t.format}</span>
                      <span className="chip bg-white/5">{t.participants.length}/{t.maxTeams * 2} players</span>
                      <span className={`chip ${t.status === 'open' ? 'bg-emerald-500/20 text-emerald-300' : t.status === 'running' ? 'bg-amber-500/20 text-amber-300' : 'bg-white/10 text-slate-300'}`}>
                        {t.status}
                      </span>
                      <span className="chip bg-amber-400/15 text-amber-300">🪙 {t.prizeCoins}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {t.status === 'open' && !mine && (
                    <button className="btn btn-primary px-3 py-1.5 text-xs" onClick={() => join(t)} disabled={busy}>
                      Join
                    </button>
                  )}
                  {t.status === 'open' && t.createdBy === profile?.user.id && (
                    <button className="btn btn-flame px-3 py-1.5 text-xs" onClick={() => start(t)} disabled={busy}>
                      Start & simulate
                    </button>
                  )}
                  {mine && <span className="chip bg-emerald-500/20 text-emerald-300">Registered ✓</span>}
                  <button className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => setSelected(t.id)}>
                    Standings
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {detail && (
        <div className="glass rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-300">
              {detail.name} — standings
            </h2>
            <button className="text-[10px] text-slate-500 hover:text-slate-300" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="text-[10px] uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="py-1">#</th>
                  <th className="py-1">Team</th>
                  <th className="py-1 text-right">P</th>
                  <th className="py-1 text-right">W</th>
                  <th className="py-1 text-right">L</th>
                  <th className="py-1 text-right">Pts</th>
                  <th className="py-1 text-right">GD</th>
                </tr>
              </thead>
              <tbody>
                {detail.standings.map((s: any, i: number) => (
                  <tr key={s.teamId} className="border-t border-white/[0.06]">
                    <td className="py-1.5 font-black text-slate-500">{i + 1}</td>
                    <td className="py-1.5 font-bold">{s.name}</td>
                    <td className="py-1.5 text-right">{s.played}</td>
                    <td className="py-1.5 text-right text-emerald-400">{s.won}</td>
                    <td className="py-1.5 text-right text-rose-400">{s.lost}</td>
                    <td className="py-1.5 text-right font-black">{s.points}</td>
                    <td className="py-1.5 text-right">{s.gf - s.ga}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {detail.participants.map((p: any) => (
              <div key={p.teamId} className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2 py-1">
                {p.members.map((m: any) => (
                  <div key={m.id} className="flex items-center gap-1">
                    <Avatar emoji={m.avatar} size={18} />
                    <span className="text-[11px] font-semibold">{m.username}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Create tournament">
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Friday Night Cup" maxLength={40} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Format</label>
              <select className="input" value={format} onChange={(e) => setFormat(e.target.value as any)}>
                <option value="knockout">Knockout</option>
                <option value="league">League (round robin)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Teams</label>
              <select className="input" value={maxTeams} onChange={(e) => setMaxTeams(Number(e.target.value))}>
                {[2, 4, 6, 8].map((n) => (
                  <option key={n} value={n}>{n} teams</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">
            Players register solo. When you start, the server shuffles entrants into 2v2 teams and plays every
            fixture with the real physics engine — results and prizes are paid server-side.
          </p>
          <button className="btn btn-primary w-full py-2.5" onClick={create} disabled={busy || name.trim().length < 3}>
            {busy ? <Spinner size={16} /> : 'Create'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
