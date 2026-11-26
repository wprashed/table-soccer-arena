/** Matchmaking queue with live player list, wait estimate and bot fallback. */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { getSocket, request } from '../lib/socket';
import { useApp } from '../lib/store';
import { navigate } from '../lib/router';
import { Avatar, Spinner } from '../components/ui';
import type { MatchView } from '../../shared/types';
import { sfx } from '../lib/sfx';

interface QueueView {
  count: number;
  players: { userId: string; username: string; avatar: string; rating: number; waitedMs: number }[];
  online: number;
}

export function QuickMatch() {
  const { user, toast } = useApp();
  const [queue, setQueue] = useState<QueueView>({ count: 0, players: [], online: 0 });
  const [elapsed, setElapsed] = useState(0);
  const [searching, setSearching] = useState(false);
  const [position, setPosition] = useState<'striker' | 'defence' | 'any'>(
    (user as any)?.position || 'striker'
  );
  const [matched, setMatched] = useState<{ matchId: string; view: MatchView } | null>(null);

  const changePosition = (next: 'striker' | 'defence' | 'any') => {
    setPosition(next);
    request<any>('queue:join', { allowBots: true, position: next })
      .then((res) => {
        if (res?.queue) setQueue(res.queue);
      })
      .catch(() => {});
  };

  useEffect(() => {
    const socket = getSocket();
    const onUpdate = (q: QueueView) => setQueue(q);
    const onMatched = (p: { matchId: string; view: MatchView }) => {
      setMatched(p);
      sfx.win();
      setTimeout(() => navigate(`/match/${p.matchId}`), 1600);
    };
    const onInvited = (p: { matchId: string; view: MatchView }) => {
      if (p.view?.mode === 'quick') {
        setMatched(p);
        setTimeout(() => navigate(`/match/${p.matchId}`), 1600);
      }
    };
    socket.on('queue:update', onUpdate);
    socket.on('queue:matched', onMatched);
    socket.on('match:invited', onInvited);

    request<any>('queue:join', { allowBots: true, position })
      .then((res) => {
        if (res?.ok) {
          setQueue(res.queue);
          setSearching(true);
        } else {
          setSearching(false);
          toast(res?.error ?? 'Could not join queue', 'error');
          navigate('/');
        }
      })
      .catch((e) => toast(e.message, 'error'));

    return () => {
      socket.off('queue:update', onUpdate);
      socket.off('queue:matched', onMatched);
      socket.off('match:invited', onInvited);
      socket.emit('queue:leave');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!searching) return;
    const iv = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(iv);
  }, [searching]);

  const cancel = () => {
    getSocket().emit('queue:leave');
    setSearching(false);
    navigate('/');
  };

  if (matched) {
    const myTeam = matched.view.teamA.some((p) => p.userId === user?.id) ? 'A' : 'B';
    return (
      <div className="grid min-h-[70vh] place-items-center">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="glass w-full max-w-md rounded-2xl p-6 text-center"
        >
          <div className="text-2xl font-black text-emerald-300">Match found!</div>
          <div className="mt-1 text-xs uppercase tracking-[0.25em] text-slate-400">Entering the arena…</div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            {(['A', 'B'] as const).map((team) => (
              <div key={team} className="glass-soft rounded-xl p-2">
                <div className={`text-[10px] font-black uppercase tracking-widest ${team === 'A' ? 'text-blue-400' : 'text-rose-400'}`}>
                  Team {team} {team === myTeam && '· you'}
                </div>
                {(team === 'A' ? matched.view.teamA : matched.view.teamB).map((p) => (
                  <div key={p.id} className="mt-1 flex items-center gap-2">
                    <Avatar emoji={p.avatar} size={22} />
                    <div className="min-w-0 flex-1 text-left">
                      <div className="truncate text-xs font-bold">{p.username}</div>
                      <div className="text-[10px] text-slate-500">{p.rating}</div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-5"><Spinner /></div>
        </motion.div>
      </div>
    );
  }

  const estimate =
    queue.count >= 4 ? 'Match found!' : queue.count === 3 ? 'Almost — 1 more player' : queue.count === 2 ? 'Waiting for 2 more' : 'Searching for opponents…';

  return (
    <div className="grid min-h-[70vh] place-items-center">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass w-full max-w-lg rounded-2xl p-6">
        <div className="text-center">
          <div className="relative mx-auto grid h-24 w-24 place-items-center">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 2.6, ease: 'linear' }}
              className="absolute inset-0 rounded-full border-2 border-emerald-400/30 border-t-emerald-400"
            />
            <span className="text-3xl">⚽</span>
          </div>
          <h1 className="mt-4 text-xl font-black">Finding a match</h1>
          <p className="text-xs text-slate-400">{estimate}</p>
          <div className="mt-1 font-mono text-sm text-slate-500">
            {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Position Preference</span>
            <span className="text-[10px] font-bold text-emerald-400 capitalize">
              {position === 'striker' ? '⚽ Striker (3-bar & 5-bar)' : position === 'defence' ? '🛡️ Defence (Goalie & 2-bar)' : '🎲 Flex'}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'striker' as const, label: '⚽ Striker', desc: 'Atk & Mid' },
              { id: 'defence' as const, label: '🛡️ Defence', desc: 'Goalie & Def' },
              { id: 'any' as const, label: '🎲 Any', desc: 'Flex Role' },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => changePosition(p.id)}
                className={`rounded-xl py-2 px-2 text-center transition ${
                  position === p.id
                    ? 'bg-emerald-500 text-emerald-950 font-black ring-1 ring-emerald-300'
                    : 'bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                <div className="text-xs font-black">{p.label}</div>
                <div className={`text-[9px] ${position === p.id ? 'text-emerald-900 font-bold' : 'text-slate-400'}`}>
                  {p.desc}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 space-y-1.5">
          <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-500">
            <span>In queue ({queue.count}/4)</span>
            <span>{queue.online} online</span>
          </div>
          {[0, 1, 2, 3].map((i) => {
            const p = queue.players[i];
            return (
              <div
                key={i}
                className={`flex items-center gap-2 rounded-xl px-3 py-2 ${
                  p ? 'bg-white/[0.07]' : 'border border-dashed border-white/10'
                }`}
              >
                {p ? (
                  <>
                    <Avatar emoji={p.avatar} size={26} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-bold">
                        {p.username} {p.userId === user?.id && <span className="text-emerald-400">(you)</span>}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {p.rating} rating · waiting {Math.round(p.waitedMs / 1000)}s
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <div className="h-6 w-6 rounded-full bg-white/5" />
                    Open slot
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 rounded-xl bg-white/[0.04] p-3 text-[11px] leading-relaxed text-slate-400">
          Players are matched by rating and the teams are balanced automatically. If nobody joins within ~18s the
          server fills the empty seats with bots — that match is casual and does not change your rating.
        </div>

        <button className="btn btn-ghost mt-4 w-full py-2.5" onClick={cancel}>
          Cancel search
        </button>
      </motion.div>
    </div>
  );
}
