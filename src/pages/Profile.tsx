/** Public player profile: rank, stats, achievements, rating trend, match history. */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Link, navigate } from '../lib/router';
import { Avatar, Empty, RankBadge, Spinner, TierPill } from '../components/ui';
import { MatchRow, timeAgo } from './Dashboard';
import { useApp } from '../lib/store';
import type { ProfileResponse } from '../../shared/types';
import { tierProgress, tierFor } from '../../shared/rating';

export function Profile({ username }: { username: string }) {
  const { user: me, toast } = useApp();
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ratingHistory, setRatingHistory] = useState<number[]>([]);

  useEffect(() => {
    setData(null);
    setError(null);
    api
      .get<ProfileResponse>(`/profile/${encodeURIComponent(username)}`)
      .then((d) => {
        setData(d);
        const hist = ((d as any).ratingHistory ?? []) as { rating_after: number }[];
        // API returns newest-first; the chart wants chronological order and
        // always starts from the player's starting rating so the curve is honest
        const chrono = hist.slice().reverse().map((h) => h.rating_after);
        setRatingHistory(chrono);
      })
      .catch((e) => setError(e.message));
  }, [username]);

  if (error)
    return (
      <div className="glass rounded-2xl p-6 text-center">
        <div className="text-lg font-black">{error}</div>
        <Link to="/" className="btn btn-ghost mt-3 px-4 py-2 text-sm">
          Back to dashboard
        </Link>
      </div>
    );

  if (!data)
    return (
      <div className="grid place-items-center py-20">
        <Spinner size={26} />
      </div>
    );

  const { user, stats, matchHistory } = data;
  const achievements = data.achievements ?? [];
  const tier = tierFor(user.rating);
  const isMe = user.id === me?.id;

  return (
    <div className="space-y-4">
      <section className="glass relative overflow-hidden rounded-2xl p-5">
        <div
          className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full opacity-25 blur-3xl"
          style={{ background: tier.color }}
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
          <Avatar emoji={user.avatar} size={72} />
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-black">{user.username}</h1>
              <TierPill rating={user.rating} />
              <span className="chip bg-white/5 text-slate-400">Lv {user.level}</span>
              <span className="chip bg-emerald-500/15 text-emerald-300 font-bold">
                {user.position === 'defence' ? '🛡️ Defence' : user.position === 'any' ? '🎲 Any Position' : '⚽ Striker'}
              </span>
              {isMe && (
                <Link to="/settings" className="btn btn-primary px-2.5 py-1 text-[11px] font-bold inline-flex items-center gap-1">
                  <span>⚙️</span> Edit Profile
                </Link>
              )}
            </div>
            {data.profile?.bio && (
              <p className="mt-1.5 text-xs text-slate-300 italic">"{data.profile.bio}"</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <span className="font-mono text-lg font-black text-white">{user.rating}</span>
              <span>rating</span>
              <span className="opacity-30">|</span>
              <span>Peak <b className="text-amber-300">{stats.highestRating}</b></span>
              <span className="opacity-30">|</span>
              <span>Best streak <b className="text-orange-300">{stats.bestStreak}</b></span>
            </div>
            <div className="mt-2 h-2 w-full max-w-sm overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full"
                style={{ width: `${tierProgress(user.rating) * 100}%`, background: tier.color }}
              />
            </div>
          </div>
          <RankBadge rating={user.rating} size="lg" />
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <MiniStat label="Matches" value={stats.matches} />
        <MiniStat label="Wins" value={stats.wins} accent="#34d399" />
        <MiniStat label="Losses" value={stats.losses} accent="#fb7185" />
        <MiniStat label="Win rate" value={`${stats.winRate}%`} />
        <MiniStat label="Goals for" value={stats.goalsFor} />
        <MiniStat label="Conceded" value={stats.goalsAgainst} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="glass rounded-2xl p-4 lg:col-span-2">
          <h2 className="mb-2 text-sm font-black uppercase tracking-widest text-slate-300">Rating history</h2>
          {ratingHistory.length < 2 ? (
            <Empty icon="📈" title="Not enough ranked matches" hint="Your rating curve appears after a few games" />
          ) : (
            <>
              <RatingChart points={ratingHistory} />
              <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                {[
                  { k: 'Current', v: ratingHistory[ratingHistory.length - 1] },
                  { k: 'Peak', v: Math.max(...ratingHistory, stats.highestRating) },
                  { k: 'Average', v: Math.round(ratingHistory.reduce((a, b) => a + b, 0) / ratingHistory.length) },
                  { k: 'Last 5 Δ', v: ratingHistory.slice(-1)[0] - ratingHistory.slice(-6)[0] },
                ].map((x) => (
                  <div key={x.k} className="rounded-lg bg-white/[0.04] py-1.5">
                    <div className="text-[9px] uppercase tracking-widest text-slate-500">{x.k}</div>
                    <div
                      className={`font-mono text-sm font-black ${
                        x.k === 'Last 5 Δ' ? (x.v >= 0 ? 'text-emerald-400' : 'text-rose-400') : 'text-slate-100'
                      }`}
                    >
                      {x.k === 'Last 5 Δ' && x.v > 0 ? '+' : ''}
                      {x.v}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="glass rounded-2xl p-4">
          <h2 className="mb-2 text-sm font-black uppercase tracking-widest text-slate-300">
            Achievements ({achievements.filter((a) => a.unlocked).length}/{achievements.length})
          </h2>
          <div className="scroll-thin max-h-72 space-y-1.5 overflow-y-auto">
            {achievements.map((a) => (
              <div
                key={a.id}
                className={`flex items-center gap-2 rounded-lg p-2 ${a.unlocked ? 'bg-emerald-500/10' : 'bg-white/[0.03] opacity-70'}`}
              >
                <div className="text-lg">{a.unlocked ? a.icon : '🔒'}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-bold">{a.title}</div>
                  <div className="text-[10px] text-slate-500">{a.description}</div>
                  {!a.unlocked && (
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/10">
                      <div className="h-full bg-emerald-400/70" style={{ width: `${(a.progress / a.target) * 100}%` }} />
                    </div>
                  )}
                </div>
                <span className="chip bg-amber-400/10 text-[9px] text-amber-300">🪙{a.reward}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="glass rounded-2xl p-4">
        <h2 className="mb-2 text-sm font-black uppercase tracking-widest text-slate-300">Match history</h2>
        {matchHistory.length === 0 ? (
          <Empty icon="🎮" title="No matches yet" />
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {matchHistory.map((m) => (
              <MatchRow key={m.id} m={m} showGoals />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="glass rounded-xl px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="text-lg font-black" style={{ color: accent ?? '#e8eefc' }}>
        {value}
      </div>
    </div>
  );
}

function RatingChart({ points }: { points: number[] }) {
  const w = 600;
  const h = 140;
  const min = Math.min(...points) - 20;
  const max = Math.max(...points) + 20;
  const span = Math.max(60, max - min);
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p - min) / span) * h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const area = `${path} L${w},${h} L0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-44 w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#17b978" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#17b978" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#rg)" />
      <path d={path} fill="none" stroke="#34d399" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
