/** Player home: rank card, play buttons, daily rewards, challenges, recent matches. */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { navigate, Link } from '../lib/router';
import { getSocket, request } from '../lib/socket';
import { Avatar, RankBadge, Spinner, TierPill, Empty } from '../components/ui';
import { tierProgress, tierFor } from '../../shared/rating';
import type { ChallengeView, LeaderboardEntry, MatchHistoryEntry } from '../../shared/types';
import { sfx } from '../lib/sfx';

export function Dashboard() {
  const { profile, user, refresh, toast, online } = useApp();
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [joinOpen, setJoinOpen] = useState(false);

  useEffect(() => {
    api.get<LeaderboardEntry[]>('/leaderboard?scope=global').then((l) => setLeaders(l.slice(0, 3))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!profile) refresh();
  }, [profile, refresh]);

  if (!user) return null;

  const activeProfile = profile || {
    user,
    profile: {
      bio: 'Ready to climb the arena rankings!',
      frame: 'frame-default',
      tableSkin: 'skin-emerald',
      ballSkin: 'ball-gold',
      uniform: 'kit-away',
      celebration: 'celebration-confetti',
      dailyStreak: 1,
      lastDailyClaim: null,
    },
    stats: {
      matches: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      winRate: 0,
      streak: 0,
      bestStreak: 0,
      highestRating: user.rating || 1000,
    },
    achievements: [],
    daily: { canClaim: true, streak: 1, rewards: [40, 55, 70, 85, 100, 130, 200] },
    challenges: [],
    matchHistory: [],
  };
  const { stats, daily, challenges, matchHistory, achievements } = activeProfile;
  const tier = tierFor(user.rating);
  const progress = tierProgress(user.rating);
  const nextTier = tier.max === Infinity ? null : tierFor(tier.max + 1);

  const claimDaily = async () => {
    setBusy('daily');
    try {
      const r = await api.post<{ reward: number; streak: number }>('/rewards/daily');
      sfx.coin();
      toast(`Daily reward: +${r.reward} coins (${r.streak}-day streak)`, 'success');
      await refresh();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const claimChallenge = async (c: ChallengeView) => {
    try {
      const r = await api.post<{ coins: number; xp: number }>('/rewards/challenge', { id: c.id });
      sfx.coin();
      toast(`Challenge complete: +${r.coins} coins, +${r.xp} XP`, 'success');
      await refresh();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const quickMatch = () => navigate('/play/quick');
  const createRoom = async () => {
    setBusy('room');
    try {
      const res = await request<any>('room:create', { rated: true });
      if (!res?.ok) throw new Error(res?.error ?? 'Could not create room');
      toast(`Room ${res.code} created — invite your friends`, 'success');
      navigate(`/match/${res.matchId}`);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  };
  const joinRoom = async () => {
    if (joinCode.length !== 6) return toast('Enter the 6-digit room code', 'error');
    setBusy('join');
    try {
      const res = await request<any>('room:join', { code: joinCode });
      if (!res?.ok) throw new Error(res?.error ?? 'Room not found');
      navigate(`/match/${res.matchId}`);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const unlocked = achievements.filter((a) => a.unlocked).length;

  return (
    <div className="space-y-4">
      {/* --------------------------------------------------------- hero card */}
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass relative overflow-hidden rounded-2xl p-4 sm:p-5"
      >
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full opacity-25 blur-3xl"
          style={{ background: tier.color }}
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <RankBadge rating={user.rating} size="lg" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="truncate text-xl font-black">{user.username}</h1>
                <TierPill rating={user.rating} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span className="font-mono text-base font-black text-white">{user.rating}</span>
                <span>rating</span>
                <span className="opacity-30">|</span>
                <span>Lv {user.level}</span>
                <span className="opacity-30">|</span>
                <span className="text-amber-300">🪙 {user.coins}</span>
                <span className="opacity-30">|</span>
                <span>{user.country}</span>
              </div>
            </div>
          </div>

          <div className="flex-1">
            <div className="mb-1 flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-500">
              <span>{tier.tier}</span>
              <span>{nextTier ? nextTier.tier : 'Max tier'}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.round(progress * 100)}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
                className="h-full rounded-full"
                style={{ background: `linear-gradient(90deg,${tier.color},${nextTier?.color ?? tier.color})` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <StatPill
                label="Record"
                value={`${stats.wins}W · ${stats.matches - stats.wins}L`}
                accent="#34d399"
              />
              <StatPill label="Win rate" value={`${stats.winRate}%`} />
              {stats.streak > 0 && <StatPill label="Streak" value={`🔥 ${stats.streak}`} accent="#fbbf24" />}
            </div>
          </div>
        </div>
      </motion.section>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ------------------------------------------------------- play panel */}
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass rounded-2xl p-4 lg:col-span-2"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-300">Play</h2>
            <span className="chip bg-emerald-500/15 text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> {online} online
            </span>
          </div>

          <button
            onClick={quickMatch}
            className="btn btn-primary pulse-ring group relative mb-2 w-full overflow-hidden py-4 text-lg font-black"
          >
            <span className="text-2xl">▶</span> PLAY NOW
            <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
          </button>

          {/* Quick Position Selector */}
          <div className="mb-3.5 flex items-center justify-between rounded-xl border border-white/10 bg-black/25 px-3 py-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Position</span>
            <div className="flex gap-1">
              {[
                { id: 'striker' as const, label: '⚽ Striker', title: 'Attack (3-bar & 5-bar)' },
                { id: 'defence' as const, label: '🛡️ Defence', title: 'Goalie (1-bar & 2-bar)' },
              ].map((p) => {
                const currentPos = (profile?.profile as any)?.preferredPosition ?? 'striker';
                const active = currentPos === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      api.patch('/profile', { preferredPosition: p.id }).catch(() => {});
                      refresh();
                    }}
                    className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                      active
                        ? 'bg-emerald-500 text-emerald-950 font-black shadow-sm'
                        : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                    title={p.title}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mb-4 text-center text-[11px] text-slate-500">
            Ranked 2v2 quick match · Elo on the line
          </div>

          {/* secondary modes: one compact row, no duplicate "quick match" card */}
          <div className="grid grid-cols-3 gap-2">
            <PlayCard
              icon="🔒"
              title="Private Room"
              hint="Invite friends"
              onClick={createRoom}
              loading={busy === 'room'}
            />
            <PlayCard icon="🎯" title="Practice" hint="vs bots" onClick={() => navigate('/practice')} />
            <PlayCard icon="🏆" title="Tournament" hint="Compete" onClick={() => navigate('/tournaments')} />
          </div>

          {/* room code is only used occasionally, so it stays collapsed */}
          {joinOpen ? (
            <div className="mt-2 flex gap-2">
              <input
                className="input font-mono tracking-[0.3em]"
                placeholder="ROOM CODE"
                maxLength={6}
                autoFocus
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
              <button className="btn btn-ghost px-4" onClick={joinRoom} disabled={busy === 'join'}>
                {busy === 'join' ? <Spinner size={16} /> : 'Join'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setJoinOpen(true)}
              className="mt-2 w-full text-center text-[11px] font-semibold text-slate-500 transition hover:text-slate-300"
            >
              Have a room code?
            </button>
          )}

          {/* challenges */}
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Daily challenges</h3>
              <span className="text-[10px] text-slate-500">{unlocked}/{achievements.length} achievements</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {[...challenges]
                .sort((a, b) => Number(b.complete) - Number(a.complete) || b.progress / b.target - a.progress / a.target)
                .slice(0, 2)
                .map((c) => (
                <div key={c.id} className="glass-soft rounded-xl p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-bold">{c.title}</div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-emerald-400"
                          style={{ width: `${Math.min(100, (c.progress / c.target) * 100)}%` }}
                        />
                      </div>
                      <div className="mt-1 text-[10px] text-slate-500">
                        {c.progress}/{c.target} · 🪙 {c.reward} · {c.xp} XP
                      </div>
                    </div>
                    <button
                      className="btn btn-primary shrink-0 px-2 py-1 text-[10px]"
                      disabled={!c.complete || c.claimed}
                      onClick={() => claimChallenge(c)}
                    >
                      {c.claimed ? 'Claimed' : c.complete ? 'Claim' : 'Locked'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {challenges.length > 2 && (
              <div className="mt-2 text-center text-[10px] text-slate-500">
                +{challenges.length - 2} more · see all in Profile
              </div>
            )}
          </div>
        </motion.section>

        {/* ---------------------------------------------------- right column */}
        <div className="space-y-4">
          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass rounded-2xl p-4"
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-black uppercase tracking-widest text-slate-300">Rewards</h2>
              <span className="text-[10px] text-slate-500">{daily.streak} day streak</span>
            </div>
            <div className="mb-3 flex gap-1">
              {daily.rewards.map((r, i) => (
                <div
                  key={i}
                  className={`flex-1 rounded-lg py-1.5 text-center text-[10px] font-bold ${
                    i < daily.streak ? 'bg-emerald-500/25 text-emerald-300' : 'bg-white/5 text-slate-500'
                  }`}
                >
                  <div className="text-[9px] opacity-70">D{i + 1}</div>
                  {r}
                </div>
              ))}
            </div>
            <button className="btn btn-flame w-full py-2.5" onClick={claimDaily} disabled={!daily.canClaim || busy === 'daily'}>
              {daily.canClaim ? `Claim daily reward` : 'Claimed today ✓'}
            </button>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="glass rounded-2xl p-4"
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-black uppercase tracking-widest text-slate-300">Top players</h2>
              <Link to="/leaderboard" className="text-[10px] font-bold text-emerald-400">
                View all →
              </Link>
            </div>
            <div className="space-y-1.5">
              {leaders.map((l) => (
                <Link
                  key={l.userId}
                  to={`/player/${l.username}`}
                  className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-white/5"
                >
                  <span className="w-4 text-center text-[10px] font-black text-slate-500">{l.rank}</span>
                  <Avatar emoji={l.avatar} size={24} />
                  <span className="min-w-0 flex-1 truncate text-xs font-bold">{l.username}</span>
                  <span className="font-mono text-xs font-black text-emerald-300">{l.rating}</span>
                </Link>
              ))}
              {leaders.length === 0 && <Empty icon="🏅" title="No ranked players yet" />}
            </div>
          </motion.section>
        </div>
      </div>

      {/* --------------------------------------------------------- recent list */}
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="glass rounded-2xl p-4"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-300">Recent matches</h2>
          <Link to="/history" className="text-[10px] font-bold text-emerald-400">
            Full history →
          </Link>
        </div>
        {matchHistory.length === 0 ? (
          <Empty icon="🎮" title="No matches yet" hint="Hit Play Now to jump into your first 2v2" />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <div className="divide-y divide-white/[0.06]">
              {matchHistory.slice(0, 5).map((m) => (
                <MatchRow key={m.id} m={m} />
              ))}
            </div>
          </div>
        )}
      </motion.section>
    </div>
  );
}

export function MatchRow({ m, showGoals = false }: { m: MatchHistoryEntry; showGoals?: boolean }) {
  const tone =
    m.outcome === 'win' ? 'text-emerald-400 bg-emerald-500/15' : m.outcome === 'loss' ? 'text-rose-400 bg-rose-500/15' : 'text-slate-300 bg-white/10';
  return (
    <div className="flex items-center gap-2 py-2 text-xs">
      <span className={`chip w-14 justify-center ${tone}`}>{m.outcome.toUpperCase()}</span>
      <span className="font-mono font-bold">
        {m.myScore}–{m.opponentScore}
      </span>
      <span className="capitalize text-slate-500">{m.mode}</span>
      {showGoals && <span className="font-mono text-slate-300">{m.goals}</span>}
      <span className="flex-1" />
      <span className={`font-mono font-bold ${m.ratingDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
        {m.ratingDelta >= 0 ? '+' : ''}
        {m.ratingDelta}
      </span>
      <span className="w-16 text-right text-slate-500">{timeAgo(m.playedAt)}</span>
    </div>
  );
}

function StatPill({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <span className="chip bg-white/[0.07] text-slate-300">
      <span className="text-slate-500">{label}</span>
      <b style={{ color: accent ?? '#e8eefc' }}>{value}</b>
    </span>
  );
}

function PlayCard({
  icon,
  title,
  hint,
  onClick,
  loading,
}: {
  icon: string;
  title: string;
  hint: string;
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <button onClick={onClick} className="glass-soft card-hover rounded-xl p-3 text-left" disabled={loading}>
      <div className="text-xl">{loading ? <Spinner size={18} /> : icon}</div>
      <div className="mt-1 text-[11px] font-black leading-tight sm:text-xs">{title}</div>
      <div className="text-[10px] text-slate-500">{hint}</div>
    </button>
  );
}

export function timeAgo(iso: string) {
  const diff = Date.now() - Date.parse(iso);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString();
}
