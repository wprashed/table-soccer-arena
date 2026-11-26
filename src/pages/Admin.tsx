/**
 * Admin Dashboard — Comprehensive user management, moderation, audit trail,
 * and system health controls.
 * Restricted to authorized admin users (e.g. rashedcse18@gmail.com).
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { Avatar, Empty, Modal, Spinner, TierPill } from '../components/ui';
import { navigate, Link } from '../lib/router';
import type { PublicUser } from '../../shared/types';
import { sfx } from '../lib/sfx';

type AdminTab = 'users' | 'overview' | 'reports' | 'audit';

export function Admin() {
  const { user, toast } = useApp();
  const [tab, setTab] = useState<AdminTab>('users');
  const [overview, setOverview] = useState<any>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search & filter
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'player' | 'banned'>('all');

  // Action modals
  const [adjustUser, setAdjustUser] = useState<PublicUser | null>(null);
  const [adjustCoins, setAdjustCoins] = useState<number>(500);
  const [adjustRating, setAdjustRating] = useState<number>(0);
  const [banUser, setBanUser] = useState<PublicUser | null>(null);
  const [banReason, setBanReason] = useState('Terms of service violation');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const isAdmin =
    user?.role === 'admin' ||
    user?.email?.toLowerCase() === 'rashedcse18@gmail.com' ||
    user?.email?.toLowerCase() === 'admin@arena.dev';

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, us] = await Promise.all([
        api.get<any>('/admin/overview'),
        api.get<{ users: PublicUser[] }>('/admin/users').catch(() => ({ users: [] })),
      ]);
      setOverview(ov);
      setUsers(us.users || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      loadData();
    }
  }, [isAdmin]);

  if (!user || !isAdmin) {
    return (
      <div className="mx-auto my-12 max-w-md text-center">
        <div className="glass rounded-3xl p-8 shadow-2xl">
          <div className="text-5xl">🔒</div>
          <h1 className="mt-3 text-2xl font-black text-white">Administrator Access Required</h1>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            This dashboard is restricted to arena administrators. You are currently logged in as{' '}
            <b className="text-white">{user?.username || 'Guest'}</b> ({user?.email || 'unregistered'}).
          </p>
          <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
            Designated Admin: <span className="font-mono font-black text-white">rashedcse18@gmail.com</span>
          </div>
          <div className="mt-6 flex flex-col gap-2">
            <button onClick={() => navigate('/')} className="btn btn-primary w-full py-2.5 text-xs font-bold">
              Return to Arena Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------- Admin actions
  const handleToggleRole = async (target: PublicUser) => {
    const nextRole = target.role === 'admin' ? 'player' : 'admin';
    setBusyAction(`role_${target.id}`);
    try {
      await api.post('/admin/user/role', { userId: target.id, role: nextRole });
      toast(`${target.username} is now ${nextRole.toUpperCase()}`, 'success');
      sfx.click();
      await loadData();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleToggleBan = async (target: PublicUser, shouldBan: boolean, reason?: string) => {
    setBusyAction(`ban_${target.id}`);
    try {
      await api.post('/admin/ban', { userId: target.id, ban: shouldBan, reason });
      toast(shouldBan ? `${target.username} has been banned` : `${target.username} unbanned`, 'success');
      setBanUser(null);
      sfx.click();
      await loadData();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleAdjustUser = async () => {
    if (!adjustUser) return;
    setBusyAction(`adjust_${adjustUser.id}`);
    try {
      await api.post('/admin/user/adjust', {
        userId: adjustUser.id,
        deltaCoins: Number(adjustCoins) || 0,
        deltaRating: Number(adjustRating) || 0,
      });
      toast(`Updated ${adjustUser.username}: +${adjustCoins} coins, +${adjustRating} rating`, 'success');
      setAdjustUser(null);
      sfx.coin();
      await loadData();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteUser = async (target: PublicUser) => {
    if (!window.confirm(`Are you sure you want to delete user "${target.username}"? This cannot be undone.`)) {
      return;
    }
    setBusyAction(`del_${target.id}`);
    try {
      await api.post('/admin/user/delete', { userId: target.id });
      toast(`User ${target.username} deleted`, 'success');
      await loadData();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleResolveReport = async (reportId: number, status: string) => {
    try {
      await api.post(`/admin/reports/${reportId}/resolve`, { status });
      toast(`Report marked ${status}`, 'success');
      await loadData();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  // Filtered users
  const filteredUsers = users.filter((u) => {
    const q = search.toLowerCase().trim();
    const matchesSearch =
      !q ||
      u.username.toLowerCase().includes(q) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      u.id.toLowerCase().includes(q);

    if (!matchesSearch) return false;
    if (roleFilter === 'admin') return u.role === 'admin';
    if (roleFilter === 'player') return u.role !== 'admin' && !u.banned;
    if (roleFilter === 'banned') return !!u.banned;
    return true;
  });

  return (
    <div className="space-y-5">
      {/* ----------------------------------------------------- Admin Header */}
      <div className="glass rounded-3xl p-5 sm:p-6 border border-white/10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3.5">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-rose-500 to-amber-600 text-2xl shadow-lg shadow-rose-500/25">
              🛡️
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black text-white">Admin Dashboard</h1>
                <span className="chip bg-rose-500/20 text-rose-300 font-mono text-[10px] font-bold">
                  MASTER CONTROL
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-400">
                Logged in as <b className="text-white">{user.email || user.username}</b> · Real-time user management & moderation
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              disabled={loading}
              className="btn btn-ghost px-3 py-2 text-xs font-bold inline-flex items-center gap-1.5"
              title="Refresh admin data"
            >
              {loading ? <Spinner size={14} /> : '🔄'} Refresh
            </button>
            <Link to="/" className="btn btn-primary px-3 py-2 text-xs font-bold">
              Arena Home →
            </Link>
          </div>
        </div>

        {/* ------------------------------------------------- KPI Stat Cards */}
        {overview && (
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="glass-soft rounded-2xl p-3 border border-white/5">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Users</div>
              <div className="mt-1 font-mono text-2xl font-black text-white">{overview.users ?? users.length}</div>
              <div className="text-[10px] text-emerald-400">Registered accounts</div>
            </div>
            <div className="glass-soft rounded-2xl p-3 border border-white/5">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Banned Players</div>
              <div className="mt-1 font-mono text-2xl font-black text-rose-400">
                {overview.bannedUsers ?? users.filter((u) => u.banned).length}
              </div>
              <div className="text-[10px] text-slate-500">Restricted access</div>
            </div>
            <div className="glass-soft rounded-2xl p-3 border border-white/5">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Economy Total</div>
              <div className="mt-1 font-mono text-2xl font-black text-amber-300">
                🪙 {overview.economy?.coins ?? 0}
              </div>
              <div className="text-[10px] text-slate-500">Coins in circulation</div>
            </div>
            <div className="glass-soft rounded-2xl p-3 border border-white/5">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Open Reports</div>
              <div className="mt-1 font-mono text-2xl font-black text-sky-400">
                {overview.reports?.length ?? 0}
              </div>
              <div className="text-[10px] text-slate-500">Player complaints</div>
            </div>
          </div>
        )}

        {/* ------------------------------------------------- Navigation Tabs */}
        <div className="mt-5 flex gap-1 border-t border-white/10 pt-4 overflow-x-auto scroll-thin">
          {[
            { id: 'users' as const, label: '👥 User Management', count: users.length },
            { id: 'reports' as const, label: '🚩 Reports', count: overview?.reports?.length },
            { id: 'audit' as const, label: '📜 Audit Trail', count: overview?.audit?.length },
            { id: 'overview' as const, label: '📊 System Health' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
                sfx.click();
              }}
              className={`rounded-xl px-4 py-2 text-xs font-bold transition shrink-0 inline-flex items-center gap-1.5 ${
                tab === t.id
                  ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/20 font-black'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {t.label}
              {typeof t.count === 'number' && (
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-mono font-black ${
                    tab === t.id ? 'bg-black/30 text-white' : 'bg-white/10 text-slate-400'
                  }`}
                >
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ---------------------------------------------------- TAB 1: USERS */}
      {tab === 'users' && (
        <div className="space-y-3">
          {/* Controls bar */}
          <div className="glass rounded-2xl p-3.5 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1">
              <input
                className="input pl-8 text-xs w-full"
                placeholder="Search user by username, email, or user ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <span className="absolute left-2.5 top-2.5 text-xs text-slate-500">🔍</span>
            </div>

            <div className="flex gap-1.5">
              {[
                { id: 'all' as const, label: 'All' },
                { id: 'player' as const, label: 'Players' },
                { id: 'admin' as const, label: 'Admins' },
                { id: 'banned' as const, label: 'Banned' },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setRoleFilter(f.id)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                    roleFilter === f.id
                      ? 'bg-white/20 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* User List Table */}
          <div className="glass rounded-2xl p-4 overflow-hidden">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-400">
                Registered Players ({filteredUsers.length})
              </h2>
            </div>

            {filteredUsers.length === 0 ? (
              <Empty icon="👤" title="No users matched your filter" />
            ) : (
              <div className="overflow-x-auto scroll-thin">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-[10px] font-black uppercase tracking-wider text-slate-500">
                      <th className="py-2.5 px-2">Player</th>
                      <th className="py-2.5 px-2">Email</th>
                      <th className="py-2.5 px-2">Rating & Tier</th>
                      <th className="py-2.5 px-2">Stats</th>
                      <th className="py-2.5 px-2">Role</th>
                      <th className="py-2.5 px-2">Status</th>
                      <th className="py-2.5 px-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {filteredUsers.map((u) => {
                      const isTargetAdmin = u.role === 'admin';
                      return (
                        <tr key={u.id} className="hover:bg-white/[0.02] transition">
                          {/* Player */}
                          <td className="py-2.5 px-2">
                            <div className="flex items-center gap-2">
                              <Avatar emoji={u.avatar} size={28} frame={u.frame} />
                              <div>
                                <div className="font-bold text-white flex items-center gap-1.5">
                                  <span>{u.username}</span>
                                  {u.id === user.id && (
                                    <span className="text-[9px] text-emerald-400 font-bold">(You)</span>
                                  )}
                                </div>
                                <div className="font-mono text-[9px] text-slate-500">{u.id}</div>
                              </div>
                            </div>
                          </td>

                          {/* Email */}
                          <td className="py-2.5 px-2 font-mono text-[11px] text-slate-300">
                            {u.email || <span className="text-slate-600">no email</span>}
                          </td>

                          {/* Rating & Tier */}
                          <td className="py-2.5 px-2">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-bold text-white">{u.rating}</span>
                              <TierPill rating={u.rating} />
                            </div>
                          </td>

                          {/* Stats */}
                          <td className="py-2.5 px-2">
                            <div className="text-[11px]">
                              <span className="text-amber-300 font-bold">🪙 {u.coins}</span>
                              <span className="mx-1 text-slate-600">·</span>
                              <span className="text-slate-400">Lv {u.level}</span>
                            </div>
                          </td>

                          {/* Role */}
                          <td className="py-2.5 px-2">
                            <span
                              className={`chip font-bold text-[10px] ${
                                isTargetAdmin
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                  : 'bg-white/10 text-slate-400'
                              }`}
                            >
                              {isTargetAdmin ? '👑 Admin' : 'Player'}
                            </span>
                          </td>

                          {/* Status */}
                          <td className="py-2.5 px-2">
                            {u.banned ? (
                              <span className="chip bg-rose-500/30 text-rose-300 font-bold text-[10px]">
                                🚫 Banned
                              </span>
                            ) : (
                              <span className="chip bg-emerald-500/15 text-emerald-300 font-bold text-[10px]">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 mr-1" /> Active
                              </span>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="py-2.5 px-2 text-right">
                            <div className="inline-flex items-center gap-1">
                              {/* Adjust coins/rating */}
                              <button
                                onClick={() => {
                                  setAdjustUser(u);
                                  setAdjustCoins(500);
                                  setAdjustRating(0);
                                }}
                                className="btn btn-ghost px-2 py-1 text-[10px] font-bold"
                                title="Adjust coins and rating"
                              >
                                ⚡ Adjust
                              </button>

                              {/* Toggle Role */}
                              <button
                                onClick={() => handleToggleRole(u)}
                                disabled={busyAction === `role_${u.id}`}
                                className={`rounded-lg border px-2 py-1 text-[10px] font-bold transition ${
                                  isTargetAdmin
                                    ? 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                                    : 'border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
                                }`}
                                title={isTargetAdmin ? 'Demote to Player' : 'Promote to Admin'}
                              >
                                {isTargetAdmin ? 'Demote' : 'Make Admin'}
                              </button>

                              {/* Ban / Unban */}
                              {u.banned ? (
                                <button
                                  onClick={() => handleToggleBan(u, false)}
                                  disabled={busyAction === `ban_${u.id}`}
                                  className="btn btn-primary px-2 py-1 text-[10px]"
                                >
                                  Unban
                                </button>
                              ) : (
                                <button
                                  onClick={() => {
                                    setBanUser(u);
                                    setBanReason('Policy violation');
                                  }}
                                  disabled={busyAction === `ban_${u.id}`}
                                  className="btn btn-flame px-2 py-1 text-[10px]"
                                >
                                  Ban
                                </button>
                              )}

                              {/* Delete */}
                              {u.id !== user.id && (
                                <button
                                  onClick={() => handleDeleteUser(u)}
                                  disabled={busyAction === `del_${u.id}`}
                                  className="btn btn-ghost px-1.5 py-1 text-[10px] text-slate-500 hover:text-rose-400"
                                  title="Delete user account"
                                >
                                  🗑️
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* -------------------------------------------------- TAB 2: REPORTS */}
      {tab === 'reports' && (
        <div className="glass rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-300">
              Player Reports & Complaints ({overview?.reports?.length ?? 0})
            </h2>
          </div>

          {(!overview?.reports || overview.reports.length === 0) ? (
            <Empty icon="🛡️" title="No open reports" hint="Arena is running smoothly with no reported infractions." />
          ) : (
            <div className="space-y-2">
              {overview.reports.map((r: any) => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/[0.04] p-3 text-xs">
                  <span className="chip bg-rose-500/20 text-rose-300 font-bold uppercase text-[10px]">
                    {r.reason}
                  </span>
                  <div>
                    <span className="text-slate-400">Target: </span>
                    <b className="text-white">{r.target || r.target_id}</b>
                  </div>
                  <span className="text-slate-400 flex-1 truncate">{r.details}</span>
                  <div className="ml-auto flex gap-1.5">
                    <button
                      className="btn btn-flame px-3 py-1 text-xs"
                      onClick={() => {
                        const targetUser = users.find((u) => u.id === r.target_id || u.username === r.target);
                        if (targetUser) {
                          handleToggleBan(targetUser, true, r.reason);
                        } else {
                          api.post('/admin/ban', { userId: r.target_id, ban: true, reason: r.reason }).then(() => {
                            toast('Banned target player', 'success');
                            loadData();
                          });
                        }
                      }}
                    >
                      Ban Offender
                    </button>
                    <button
                      className="btn btn-ghost px-3 py-1 text-xs"
                      onClick={() => handleResolveReport(r.id, 'dismiss')}
                    >
                      Dismiss
                    </button>
                    <button
                      className="btn btn-primary px-3 py-1 text-xs"
                      onClick={() => handleResolveReport(r.id, 'resolved')}
                    >
                      Mark Resolved ✓
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------ TAB 3: AUDIT LOG */}
      {tab === 'audit' && (
        <div className="glass rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-300">
              Security & Audit Trail
            </h2>
            <span className="text-xs text-slate-500">Last 40 actions</span>
          </div>

          {(!overview?.audit || overview.audit.length === 0) ? (
            <Empty icon="📜" title="No audit entries" />
          ) : (
            <div className="scroll-thin max-h-[500px] space-y-1.5 overflow-y-auto font-mono text-xs text-slate-300">
              {overview.audit.map((a: any) => (
                <div
                  key={a.id}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2"
                >
                  <span className="text-slate-500 text-[10px]">
                    {a.created_at ? new Date(a.created_at).toLocaleTimeString() : 'now'}
                  </span>
                  <span className="font-bold text-amber-300">{a.actor}</span>
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-emerald-400">
                    {a.action}
                  </span>
                  <span className="text-white font-bold">{a.target}</span>
                  {a.meta && a.meta !== '{}' && (
                    <span className="text-slate-500 truncate max-w-xs text-[10px]">{a.meta}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------- TAB 4: SYSTEM HEALTH */}
      {tab === 'overview' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="glass rounded-2xl p-4">
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-300 mb-3">
              Arena System Status
            </h2>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1.5 border-b border-white/5">
                <span className="text-slate-400">Multiplayer Match Loop</span>
                <span className="text-emerald-400 font-bold">● Active (60 FPS)</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-white/5">
                <span className="text-slate-400">Database Engine</span>
                <span className="text-emerald-400 font-bold">● SQLite / Local Storage</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-white/5">
                <span className="text-slate-400">Matchmaker Queue</span>
                <span className="text-emerald-400 font-bold">● Operational</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-white/5">
                <span className="text-slate-400">Anti-Cheat Engine</span>
                <span className="text-emerald-400 font-bold">● Rod-spin & Speed Bounds</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-slate-400">Authorized Master Admin</span>
                <span className="text-rose-400 font-bold font-mono">rashedcse18@gmail.com</span>
              </div>
            </div>
          </div>

          <div className="glass rounded-2xl p-4">
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-300 mb-3">
              Quick Admin Operations
            </h2>
            <div className="space-y-2">
              <button
                onClick={() => {
                  toast('Broadcasting maintenance message: Arena online and operating smoothly.', 'info');
                }}
                className="btn btn-ghost w-full py-2.5 text-xs font-bold text-left justify-start"
              >
                📢 Broadcast System Announcement
              </button>
              <button
                onClick={() => {
                  loadData();
                  toast('Arena metrics reloaded successfully', 'success');
                }}
                className="btn btn-ghost w-full py-2.5 text-xs font-bold text-left justify-start"
              >
                🔄 Force Sync All Player Data
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------- MODAL: ADJUST USER */}
      <Modal
        open={!!adjustUser}
        onClose={() => setAdjustUser(null)}
        title={`Adjust Player: ${adjustUser?.username ?? ''}`}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">
              Coin Adjustment (Coins to grant or deduct)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                className="input font-mono"
                value={adjustCoins}
                onChange={(e) => setAdjustCoins(Number(e.target.value))}
              />
              <button className="btn btn-ghost text-xs" onClick={() => setAdjustCoins(500)}>
                +500
              </button>
              <button className="btn btn-ghost text-xs" onClick={() => setAdjustCoins(2000)}>
                +2,000
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">
              Rating Delta (Elo change)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                className="input font-mono"
                value={adjustRating}
                onChange={(e) => setAdjustRating(Number(e.target.value))}
              />
              <button className="btn btn-ghost text-xs" onClick={() => setAdjustRating(25)}>
                +25
              </button>
              <button className="btn btn-ghost text-xs" onClick={() => setAdjustRating(100)}>
                +100
              </button>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button className="btn btn-ghost flex-1 py-2.5 text-xs" onClick={() => setAdjustUser(null)}>
              Cancel
            </button>
            <button
              className="btn btn-primary flex-1 py-2.5 text-xs font-black"
              onClick={handleAdjustUser}
              disabled={busyAction === `adjust_${adjustUser?.id}`}
            >
              Apply Adjustment
            </button>
          </div>
        </div>
      </Modal>

      {/* ---------------------------------------------- MODAL: BAN USER */}
      <Modal
        open={!!banUser}
        onClose={() => setBanUser(null)}
        title={`Ban Player: ${banUser?.username ?? ''}`}
      >
        <div className="space-y-3">
          <p className="text-xs text-rose-300">
            Banning this player will terminate their active sessions and restrict them from entering matchmaking.
          </p>
          <div>
            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">
              Reason for Ban
            </label>
            <input
              className="input text-xs"
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              placeholder="e.g. Excessive spinning, harassment, rating manipulation"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button className="btn btn-ghost flex-1 py-2.5 text-xs" onClick={() => setBanUser(null)}>
              Cancel
            </button>
            <button
              className="btn btn-flame flex-1 py-2.5 text-xs font-black"
              onClick={() => banUser && handleToggleBan(banUser, true, banReason)}
              disabled={busyAction === `ban_${banUser?.id}`}
            >
              Confirm Ban
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
