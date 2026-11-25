/** Global / weekly / monthly / friends / country leaderboards + tournaments. */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { Link } from '../lib/router';
import { Avatar, Segmented, Spinner, TierPill, Empty } from '../components/ui';
import type { LeaderboardEntry } from '../../shared/types';

type Scope = 'global' | 'weekly' | 'monthly' | 'friends' | 'country';

export function Leaderboard() {
  const { user } = useApp();
  const [scope, setScope] = useState<Scope>('global');
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);
  const [tourney, setTourney] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get<LeaderboardEntry[]>(`/leaderboard?scope=${scope}`)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [scope]);

  useEffect(() => {
    api.get<any[]>('/leaderboard/tournaments').then(setTourney).catch(() => {});
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black">Leaderboards</h1>
          <p className="text-xs text-slate-400">Elo ratings update after every ranked match.</p>
        </div>
        <div className="w-full sm:w-auto">
          <Segmented<Scope>
            value={scope}
            onChange={setScope}
            options={[
              { value: 'global', label: 'Global' },
              { value: 'weekly', label: 'Weekly' },
              { value: 'monthly', label: 'Monthly' },
              { value: 'friends', label: 'Friends' },
              { value: 'country', label: `Country` },
            ]}
          />
        </div>
      </div>

      <div className="glass overflow-hidden rounded-2xl">
        {loading ? (
          <div className="grid place-items-center py-16">
            <Spinner size={26} />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <Empty
              icon="🏅"
              title="Nothing here yet"
              hint={scope === 'friends' ? 'Add friends to compare ratings' : 'Play a ranked match to appear'}
            />
          </div>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="bg-white/[0.04] text-[10px] uppercase tracking-widest text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-bold">#</th>
                  <th className="px-3 py-2 font-bold">Player</th>
                  <th className="px-3 py-2 font-bold">Tier</th>
                  <th className="px-3 py-2 text-right font-bold">{scope === 'weekly' || scope === 'monthly' ? 'Gain' : 'Rating'}</th>
                  <th className="px-3 py-2 text-right font-bold">Matches</th>
                  <th className="px-3 py-2 text-right font-bold">Win %</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const me = r.userId === user?.id;
                  const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : null;
                  return (
                    <tr
                      key={r.userId}
                      className={`border-t border-white/[0.06] transition hover:bg-white/[0.04] ${
                        me ? 'bg-emerald-500/10' : ''
                      }`}
                    >
                      <td className="px-3 py-2 font-black text-slate-400">{medal ?? r.rank}</td>
                      <td className="px-3 py-2">
                        <Link to={`/player/${r.username}`} className="flex items-center gap-2">
                          <Avatar emoji={r.avatar} size={28} />
                          <div>
                            <div className="flex items-center gap-1.5 text-xs font-bold">
                              {r.username}
                              {me && <span className="text-[9px] text-emerald-400">YOU</span>}
                            </div>
                            <div className="text-[10px] text-slate-500">{r.country}</div>
                          </div>
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <TierPill rating={r.rating} />
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-black text-emerald-300">
                        {scope === 'weekly' || scope === 'monthly'
                          ? `${r.rating >= 0 ? '+' : ''}${r.rating}`
                          : r.rating}
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-slate-400">{r.matches}</td>
                      <td className="px-3 py-2 text-right text-xs text-slate-400">{r.winRate}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="glass rounded-2xl p-4">
        <h2 className="mb-2 text-sm font-black uppercase tracking-widest text-slate-300">Tournament leaderboard</h2>
        {tourney.length === 0 ? (
          <Empty icon="🏆" title="No tournament results yet" hint="Create one from the Tournaments tab" />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="text-[10px] uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="py-1">#</th>
                  <th className="py-1">Team</th>
                  <th className="py-1">Tournament</th>
                  <th className="py-1 text-right">Pts</th>
                  <th className="py-1 text-right">W–L</th>
                  <th className="py-1 text-right">GD</th>
                </tr>
              </thead>
              <tbody>
                {tourney.map((t) => (
                  <tr key={`${t.tournamentId}-${t.team}`} className="border-t border-white/[0.06]">
                    <td className="py-1.5 font-black text-slate-500">{t.rank}</td>
                    <td className="py-1.5 font-bold">{t.team}</td>
                    <td className="py-1.5 text-slate-400">{t.tournament}</td>
                    <td className="py-1.5 text-right font-mono text-emerald-300">{t.points}</td>
                    <td className="py-1.5 text-right text-slate-400">
                      {t.won}–{t.lost}
                    </td>
                    <td className="py-1.5 text-right text-slate-400">{t.goalDiff > 0 ? '+' : ''}{t.goalDiff}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
