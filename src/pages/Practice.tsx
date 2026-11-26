/** Solo practice against bots — a real match on the server, unrated. */
import { useState } from 'react';
import { request } from '../lib/socket';
import { navigate } from '../lib/router';
import { useApp } from '../lib/store';
import { Spinner } from '../components/ui';

export function Practice() {
  const { toast, user } = useApp();
  const [difficulty, setDifficulty] = useState<'easy' | 'normal' | 'hard'>('normal');
  const [solo, setSolo] = useState(false);
  const [position, setPosition] = useState<'striker' | 'defence'>('striker');
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      const res = await request<any>('practice:start', { difficulty, solo, position });
      if (!res?.ok) throw new Error(res?.error ?? 'Could not start practice');
      navigate(`/match/${res.matchId}`);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-[70vh] place-items-center">
      <div className="glass w-full max-w-lg rounded-2xl p-6">
        <h1 className="text-xl font-black">Practice arena</h1>
        <p className="mt-1 text-xs text-slate-400">
          A real server-authoritative match against bots. Unrated, so nothing is at stake while you learn the
          controls — perfect for testing without a second player.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {[
            { v: false, label: 'Real 2v2', hint: 'You + a bot teammate' },
            { v: true, label: 'Solo drill', hint: 'You control all 4 rods' },
          ].map((o) => (
            <button
              key={String(o.v)}
              onClick={() => setSolo(o.v)}
              className={`rounded-xl px-3 py-3 text-left transition ${
                solo === o.v ? 'bg-emerald-500/20 ring-1 ring-emerald-400/60' : 'bg-white/5 hover:bg-white/10'
              }`}
            >
              <div className="text-xs font-black">{o.label}</div>
              <div className="text-[10px] text-slate-400">{o.hint}</div>
            </button>
          ))}
        </div>

        {!solo && (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                Your Position
              </label>
              <span className="text-[10px] text-emerald-400 font-bold">
                {position === 'striker' ? 'Attack & Midfield' : 'Goalie & Defense'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'striker' as const, label: '⚽ Striker', rods: '3-bar Attack & 5-bar Midfield', desc: 'Score goals & control passing' },
                { id: 'defence' as const, label: '🛡️ Defence', rods: '1-bar Goalie & 2-bar Defense', desc: 'Block shots & protect the net' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPosition(p.id)}
                  className={`rounded-xl p-3 text-left transition ${
                    position === p.id
                      ? 'bg-emerald-500/25 ring-1 ring-emerald-400 text-white'
                      : 'bg-white/5 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  <div className="text-xs font-black">{p.label}</div>
                  <div className="mt-0.5 text-[10px] font-semibold text-emerald-300/90">{p.rods}</div>
                  <div className="mt-0.5 text-[9px] text-slate-400">{p.desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="mt-4 grid grid-cols-3 gap-2">
          {(['easy', 'normal', 'hard'] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDifficulty(d)}
              className={`rounded-xl px-3 py-3 text-xs font-black capitalize transition ${
                difficulty === d ? 'bg-emerald-500 text-emerald-950' : 'bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
        <div className="mt-4 space-y-1.5 rounded-xl bg-white/[0.04] p-3 text-[11px] text-slate-400">
          <div className="font-bold uppercase tracking-widest text-slate-500">
            {solo ? 'Solo drill: you control your two rods (slot 0) — the other three seats are bots' : 'Controls'}
          </div>
          <div><b className="text-slate-200">A / D</b> — slide both of your rods</div>
          <div><b className="text-slate-200">W</b> — kick with the back rod (GK / defence)</div>
          <div><b className="text-slate-200">S / Space</b> — kick with the front rod (mid / attack)</div>
          <div><b className="text-slate-200">Drag / swipe the table</b> — slide (touch)</div>
          <div className="pt-1 text-slate-500">Rods spring back to neutral when you release, so tapping is a full swing.</div>
        </div>
        <button className="btn btn-primary mt-4 w-full py-3" onClick={start} disabled={busy}>
          {busy ? <Spinner /> : 'Start practice match'}
        </button>
      </div>
    </div>
  );
}
