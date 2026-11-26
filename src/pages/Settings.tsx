/** Account settings, profile identity, controls remapping, audio, and security. */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { Avatar, RankBadge, Spinner, TierPill } from '../components/ui';
import { previewSound } from '../lib/audio';
import { Link } from '../lib/router';
import { usePwa } from '../lib/pwa';
import { tierFor } from '../../shared/rating';
import type { PlayerPosition } from '../../shared/types';
import {
  CONTROL_LABELS,
  DEFAULT_BINDINGS,
  loadBindings,
  prettyKey,
  saveBindings,
  type Action,
} from '../game/useControls';

const AVATARS = [
  '⚽', '👑', '🔥', '🚀', '⚡', '🦈', '🐉', '🦅',
  '🎯', '🐺', '🥇', '🤖', '🦁', '🐯', '🥊', '🏆',
  '💎', '🌟', '🛡️', '🌪️', '🦊', '⚔️', '🥷', '👾',
];

export function Settings() {
  const {
    profile, refresh, toast, logout, user,
    soundOn, toggleSound, sfxVolume, setSfxVolume, crowdVolume, setCrowdVolume,
  } = useApp();
  const { canInstall, install, isStandalone } = usePwa();

  // Profile fields
  const [username, setUsername] = useState(user?.username ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [avatar, setAvatar] = useState(user?.avatar ?? '⚽');
  const [bio, setBio] = useState('');
  const [preferredPosition, setPreferredPosition] = useState<PlayerPosition>(
    (user?.position as PlayerPosition) || (profile as any)?.profile?.preferredPosition || 'striker'
  );

  // Password fields
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNextPw, setShowNextPw] = useState(false);

  // Controls & bindings
  const [bindings, setBindings] = useState(loadBindings());
  const [listening, setListening] = useState<Action | null>(null);

  // Server
  const [customServer, setCustomServer] = useState(
    typeof window !== 'undefined' ? localStorage.getItem('server_url') || '' : ''
  );

  const [busy, setBusy] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [tab, setTab] = useState<'profile' | 'security' | 'controls' | 'audio' | 'app'>('profile');

  // Synchronize state when user/profile changes
  useEffect(() => {
    if (user) {
      setUsername(user.username);
      setEmail(user.email ?? '');
      setAvatar(user.avatar ?? '⚽');
      if (user.position) setPreferredPosition(user.position);
    }
    if (profile) {
      setBio((profile as any).profile?.bio ?? '');
      if ((profile as any).profile?.preferredPosition) {
        setPreferredPosition((profile as any).profile.preferredPosition);
      }
    }
  }, [user, profile]);

  // Key listening for controls remapping
  useEffect(() => {
    if (!listening) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') return setListening(null);
      const next = { ...bindings, [listening]: [e.code] };
      setBindings(next);
      saveBindings(next);
      setListening(null);
      toast(`Bound ${CONTROL_LABELS[listening]} to ${prettyKey(e.code)}`, 'success');
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [listening, bindings, toast]);

  // Save profile information
  const saveProfile = async () => {
    if (!username.trim()) {
      return toast('Username cannot be empty', 'error');
    }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username.trim())) {
      return toast('Username must be 3-20 characters (letters, numbers, underscores)', 'error');
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return toast('Please enter a valid email address', 'error');
    }

    setBusy(true);
    try {
      await api.patch('/profile', {
        username: username.trim(),
        email: email.trim().toLowerCase(),
        avatar,
        bio: bio.slice(0, 200),
        preferredPosition,
      });
      await refresh();
      toast('Profile information and position updated successfully!', 'success');
    } catch (e: any) {
      toast(e.message || 'Failed to update profile', 'error');
    } finally {
      setBusy(false);
    }
  };

  // Change password
  const changePassword = async () => {
    if (!pw.current) {
      return toast('Please enter your current password', 'error');
    }
    if (!pw.next || pw.next.length < 6) {
      return toast('New password must be at least 6 characters long', 'error');
    }
    if (pw.next !== pw.confirm) {
      return toast('New passwords do not match', 'error');
    }

    setPwBusy(true);
    try {
      await api.post('/account/password', {
        current: pw.current,
        next: pw.next,
      });
      toast('Password updated successfully!', 'success');
      setPw({ current: '', next: '', confirm: '' });
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Failed to update password', 'error');
    } finally {
      setPwBusy(false);
    }
  };

  const userTier = tierFor(user?.rating ?? 1000);

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2">
            <span>⚙️</span> Settings &amp; Preferences
          </h1>
          <p className="text-xs text-slate-400">
            Manage your player profile, preferred position, account credentials, and controls.
          </p>
        </div>
        {user && (
          <Link
            to={`/player/${user.username}`}
            className="btn btn-ghost self-start sm:self-auto text-xs font-bold inline-flex items-center gap-1.5"
          >
            <span>👤</span> View Public Profile →
          </Link>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto scroll-thin rounded-2xl bg-black/40 p-1.5 border border-white/10">
        {[
          { id: 'profile' as const, label: 'Profile & Position', icon: '👤' },
          { id: 'security' as const, label: 'Password & Security', icon: '🔒' },
          { id: 'controls' as const, label: 'Controls', icon: '🎮' },
          { id: 'audio' as const, label: 'Audio', icon: '🔊' },
          { id: 'app' as const, label: 'App & System', icon: '📱' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 py-2 text-xs font-black uppercase tracking-wider transition-all ${
              tab === t.id
                ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-emerald-950 shadow-md shadow-emerald-500/20'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <span className="text-sm">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* ------------------------------------------------------------- 1. PROFILE & POSITION */}
      {tab === 'profile' && (
        <div className="space-y-4">
          {/* Live Player Preview Card */}
          <div className="glass relative overflow-hidden rounded-2xl p-4 sm:p-5 border border-white/10">
            <div
              className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-20 blur-3xl"
              style={{ background: userTier.color }}
            />
            <div className="relative flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <Avatar emoji={avatar} size={64} frame={(user as any)?.frame} />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-black uppercase tracking-widest text-emerald-400">
                  Live Player Preview
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-0.5">
                  <span className="text-xl font-black text-white truncate">{username || 'Player'}</span>
                  <TierPill rating={user?.rating ?? 1000} />
                  <span className="chip bg-emerald-500/20 text-emerald-300 font-bold">
                    {preferredPosition === 'defence' ? '🛡️ Defence' : preferredPosition === 'any' ? '🎲 Any Position' : '⚽ Striker'}
                  </span>
                </div>
                <div className="text-xs text-slate-400 mt-1 truncate">
                  {email || 'No email attached'} • Elo Rating: <b className="text-white font-mono">{user?.rating ?? 1000}</b>
                </div>
                {bio && <div className="mt-1.5 text-xs text-slate-300 italic line-clamp-1">"{bio}"</div>}
              </div>
              <div className="hidden sm:block">
                <RankBadge rating={user?.rating ?? 1000} size="md" />
              </div>
            </div>
          </div>

          {/* Form */}
          <div className="glass space-y-5 rounded-2xl p-4 sm:p-6 border border-white/10">
            {/* Preferred Position Section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-black uppercase tracking-wider text-slate-200">
                  ⚽ Preferred Match Position
                </label>
                <span className="text-[11px] text-emerald-400 font-bold">
                  Matches you into your chosen role in 2v2
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  {
                    id: 'striker' as const,
                    icon: '⚽',
                    title: 'Striker',
                    subtitle: 'Attack & Midfield',
                    desc: 'Controls the 3-player forward line and 5-player midfield rod. Focuses on shooting, angling, and high-tempo offense.',
                    badge: 'Offensive Role',
                  },
                  {
                    id: 'defence' as const,
                    icon: '🛡️',
                    title: 'Defence',
                    subtitle: 'Goalie & 2-Bar Backline',
                    desc: 'Controls the Goalkeeper (1-bar) and the 2-player defensive guard. Focuses on blocking, wall clears, and bank shots.',
                    badge: 'Defensive Role',
                  },
                  {
                    id: 'any' as const,
                    icon: '🎲',
                    title: 'Any Position',
                    subtitle: 'Flex / Auto-Fill',
                    desc: 'Willing to play either position. Gives you the fastest matchmaking queue times by filling whichever seat is open.',
                    badge: 'Fastest Queues',
                  },
                ].map((p) => {
                  const active = preferredPosition === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPreferredPosition(p.id)}
                      className={`relative rounded-2xl p-3.5 text-left transition-all ${
                        active
                          ? 'border-2 border-emerald-400 bg-emerald-500/15 shadow-lg shadow-emerald-500/15 ring-2 ring-emerald-400/20'
                          : 'border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-2xl">{p.icon}</span>
                        <span
                          className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                            active ? 'bg-emerald-400 text-emerald-950' : 'bg-white/10 text-slate-400'
                          }`}
                        >
                          {p.badge}
                        </span>
                      </div>
                      <div className="mt-2 text-sm font-black text-white">{p.title}</div>
                      <div className={`text-[11px] font-bold ${active ? 'text-emerald-300' : 'text-slate-400'}`}>
                        {p.subtitle}
                      </div>
                      <p className="mt-1.5 text-[11px] text-slate-400 leading-relaxed">{p.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Username & Email inputs */}
            <div className="grid gap-4 sm:grid-cols-2 pt-2 border-t border-white/10">
              <div>
                <label className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-200">
                  Player Username
                </label>
                <input
                  type="text"
                  className="input font-medium"
                  maxLength={20}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username (e.g. StrikerPro)"
                />
                <p className="mt-1 text-[10px] text-slate-500">
                  3-20 characters. Shown in matchmaking, leaderboards, and matches.
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-200">
                  Email Address
                </label>
                <input
                  type="email"
                  className="input font-medium"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@example.com"
                />
                <p className="mt-1 text-[10px] text-slate-500">
                  Used for account identification and administrator access.
                </p>
              </div>
            </div>

            {/* Avatar Selection */}
            <div className="pt-2 border-t border-white/10">
              <label className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-200">
                Player Avatar Emoji
              </label>
              <div className="flex flex-wrap gap-2">
                {AVATARS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setAvatar(a)}
                    className={`grid h-11 w-11 place-items-center rounded-xl text-2xl transition-all ${
                      avatar === a
                        ? 'bg-emerald-500/30 ring-2 ring-emerald-400 scale-105 shadow-md shadow-emerald-500/25'
                        : 'bg-white/5 hover:bg-white/10 hover:scale-105'
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>

            {/* Bio / Quote */}
            <div className="pt-2 border-t border-white/10">
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-black uppercase tracking-wider text-slate-200">
                  Player Bio &amp; Motto
                </label>
                <span className="text-[10px] text-slate-500">{bio.length}/200</span>
              </div>
              <textarea
                className="input min-h-[75px] text-xs leading-relaxed"
                maxLength={200}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Share your playing style or a victory slogan with your opponents…"
              />
            </div>

            {/* Submit button */}
            <button
              type="button"
              className="btn btn-primary w-full py-3 text-sm font-black flex items-center justify-center gap-2"
              onClick={saveProfile}
              disabled={busy}
            >
              {busy ? (
                <>
                  <Spinner size={16} />
                  <span>Saving Profile…</span>
                </>
              ) : (
                <>
                  <span>💾</span>
                  <span>Save Profile &amp; Position Settings</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- 2. PASSWORD & SECURITY */}
      {tab === 'security' && (
        <div className="space-y-4">
          {/* Change Password Card */}
          <div className="glass space-y-4 rounded-2xl p-4 sm:p-6 border border-white/10">
            <div>
              <h2 className="text-base font-black text-white flex items-center gap-2">
                <span>🔒</span> Update Password
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Change your account password to secure your player rating and inventory.
              </p>
            </div>

            <div className="space-y-3 pt-2">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-300">Current Password</label>
                <div className="relative">
                  <input
                    type={showCurrentPw ? 'text' : 'password'}
                    className="input pr-10"
                    placeholder="Enter current password"
                    value={pw.current}
                    onChange={(e) => setPw({ ...pw, current: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPw(!showCurrentPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
                  >
                    {showCurrentPw ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-300">New Password</label>
                <div className="relative">
                  <input
                    type={showNextPw ? 'text' : 'password'}
                    className="input pr-10"
                    placeholder="Enter new password (at least 6 characters)"
                    value={pw.next}
                    onChange={(e) => setPw({ ...pw, next: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNextPw(!showNextPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
                  >
                    {showNextPw ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-300">Confirm New Password</label>
                <input
                  type={showNextPw ? 'text' : 'password'}
                  className={`input ${
                    pw.confirm && pw.next !== pw.confirm ? 'border-rose-500/50 bg-rose-500/5' : ''
                  }`}
                  placeholder="Re-enter new password"
                  value={pw.confirm}
                  onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                />
                {pw.confirm && pw.next !== pw.confirm && (
                  <p className="mt-1 text-[11px] text-rose-400">Passwords do not match</p>
                )}
                {pw.confirm && pw.next === pw.confirm && pw.next.length >= 6 && (
                  <p className="mt-1 text-[11px] text-emerald-400">✓ Passwords match</p>
                )}
              </div>

              <button
                type="button"
                className="btn btn-primary w-full py-2.5 text-xs font-black"
                onClick={changePassword}
                disabled={pwBusy || !pw.current || !pw.next || pw.next !== pw.confirm}
              >
                {pwBusy ? <Spinner size={16} /> : 'Update Password'}
              </button>
            </div>
          </div>

          {/* Admin Privileges Card */}
          {(user?.role === 'admin' || user?.email?.toLowerCase() === 'rashedcse18@gmail.com') ? (
            <div className="glass space-y-2 rounded-2xl p-4 border border-rose-500/30 bg-rose-500/10">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🛡️</span>
                    <h2 className="text-sm font-black uppercase tracking-widest text-rose-300">
                      Master Administrator Privileges Active
                    </h2>
                  </div>
                  <div className="text-xs text-slate-300 mt-1">
                    Designated admin user: <b className="text-white">rashedcse18@gmail.com</b>
                  </div>
                </div>
                <Link to="/admin" className="btn btn-flame px-4 py-2 text-xs font-black self-start sm:self-auto">
                  Open Admin Dashboard →
                </Link>
              </div>
            </div>
          ) : (
            <div className="glass space-y-2 rounded-2xl p-4 border border-white/10 bg-white/5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-black uppercase tracking-widest text-slate-300">
                    Administrator Privileges
                  </h2>
                  <div className="text-xs text-slate-400">
                    Unlock user management, economy moderation, and server controls.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await api.post('/admin/claim');
                      toast('Master Admin Privileges Granted!', 'success');
                      await refresh();
                    } catch (e: any) {
                      toast(e.message, 'error');
                    }
                  }}
                  className="btn btn-primary px-4 py-2 text-xs font-bold self-start sm:self-auto"
                >
                  ⚡ Grant Admin Privileges
                </button>
              </div>
            </div>
          )}

          {/* Account Details & Sign Out */}
          <div className="glass space-y-3 rounded-2xl p-4 border border-white/10">
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-300">Account Session</h2>
            <div className="text-xs text-slate-400">
              Signed in as <b className="text-slate-200">{user?.username}</b> ({user?.email || 'No email'}) • Account ID: <span className="font-mono text-slate-300">{user?.id}</span>
            </div>
            <button
              type="button"
              className="btn btn-flame w-full py-2.5 text-xs font-bold"
              onClick={() => logout()}
            >
              Sign out of Table Soccer Arena
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- 3. CONTROLS */}
      {tab === 'controls' && (
        <div className="glass space-y-3 rounded-2xl p-4 sm:p-6 border border-white/10">
          <div>
            <h2 className="text-base font-black text-white flex items-center gap-2">
              <span>🎮</span> Rod Controls &amp; Key Bindings
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Click a binding then press any key to remap. Inputs are responsive with real-time rotational physics.
            </p>
          </div>
          <div className="space-y-1.5 pt-2">
            {(Object.keys(CONTROL_LABELS) as Action[]).map((a) => (
              <div key={a} className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3.5 py-2.5">
                <span className="text-xs sm:text-sm font-bold text-slate-200">{CONTROL_LABELS[a]}</span>
                <button
                  type="button"
                  className={`btn px-3 py-1.5 text-xs ${listening === a ? 'btn-flame animate-pulse' : 'btn-ghost'}`}
                  onClick={() => setListening(a)}
                >
                  {listening === a ? 'Press a key…' : (bindings[a] ?? []).map(prettyKey).join(' / ') || 'Unbound'}
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-ghost w-full py-2.5 text-xs font-bold mt-2"
            onClick={() => {
              setBindings(DEFAULT_BINDINGS);
              saveBindings(DEFAULT_BINDINGS);
              toast('Bindings restored to defaults', 'success');
            }}
          >
            Reset Controls to Default
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------- 4. AUDIO */}
      {tab === 'audio' && (
        <div className="space-y-3">
          <div className="glass rounded-2xl p-4 sm:p-6 border border-white/10 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-black text-white flex items-center gap-2">
                  <span>🔊</span> Sound &amp; Atmosphere
                </h2>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Realistic ball kicks, rod clatter, whistles and stadium crowd chants.
                </div>
              </div>
              <button
                type="button"
                className={`btn h-9 px-3.5 text-xs font-bold ${soundOn ? 'btn-primary' : 'btn-ghost'}`}
                onClick={toggleSound}
              >
                {soundOn ? 'Sound On' : 'Muted'}
              </button>
            </div>

            <SliderRow
              label="Sound Effects (SFX)"
              hint="Kicks, wall knocks, goal chimes, whistles"
              value={sfxVolume}
              onChange={setSfxVolume}
              onTest={() => previewSound('ball')}
            />
            <SliderRow
              label="Stadium Crowd"
              hint="Dynamic stadium cheers and ambient match reactions"
              value={crowdVolume}
              onChange={setCrowdVolume}
              onTest={() => previewSound('cheer')}
            />

            <div className="pt-2 border-t border-white/10">
              <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                Sample Previews
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  ['ball', '⚽ Ball Kick'],
                  ['goal', '🥅 Goal!'],
                  ['whistle', '📢 Whistle'],
                  ['cheer', '🏟️ Stadium Cheer'],
                  ['victory', '🏆 Victory Fanfare'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className="btn btn-ghost h-9 px-3 text-xs"
                    onClick={() => previewSound(key as any)}
                  >
                    ▶ {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- 5. APP & SYSTEM */}
      {tab === 'app' && (
        <div className="space-y-4">
          <div className="glass space-y-3 rounded-2xl p-4 sm:p-6 border border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-black text-white flex items-center gap-2">
                  <span>📱</span> Progressive Web App (PWA)
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Install Table Soccer Arena for full-screen offline-ready play on mobile and desktop.
                </p>
              </div>
              <span className="text-2xl">⚽</span>
            </div>
            {isStandalone ? (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300 font-bold">
                <span className="text-base">✓</span> Running as standalone installed app
              </div>
            ) : canInstall ? (
              <button
                type="button"
                className="btn btn-primary w-full py-2.5 text-xs font-bold"
                onClick={() => install()}
              >
                📲 Install Table Soccer Arena to Home Screen
              </button>
            ) : (
              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-slate-400">
                <b className="text-slate-200">Mobile Safari / iOS:</b> Tap the <b className="text-white">Share</b> icon (<span className="text-sm font-bold">↑</span>), then select <b className="text-emerald-400">"Add to Home Screen"</b> to play full-screen.
              </div>
            )}
          </div>

          <div className="glass space-y-3 rounded-2xl p-4 sm:p-6 border border-white/10">
            <h2 className="text-base font-black text-white flex items-center gap-2">
              <span>🌐</span> Multiplayer Server Connectivity
            </h2>
            <p className="text-xs text-slate-400">
              By default on GitHub Pages, the game runs directly in your browser with real-time physics and AI matchmaking. Enter an external WebSocket server URL to bridge dedicated cross-device lobbies.
            </p>
            <input
              type="text"
              className="input text-xs"
              placeholder="e.g. https://table-soccer-api.up.railway.app"
              value={customServer}
              onChange={(e) => setCustomServer(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-secondary flex-1 py-2 text-xs font-bold"
                onClick={() => {
                  localStorage.removeItem('server_url');
                  setCustomServer('');
                  toast('Reverted to Standalone browser mode', 'info');
                  setTimeout(() => window.location.reload(), 500);
                }}
              >
                Reset Default
              </button>
              <button
                type="button"
                className="btn btn-primary flex-1 py-2 text-xs font-bold"
                onClick={() => {
                  if (customServer.trim()) {
                    localStorage.setItem('server_url', customServer.trim());
                    toast('Server URL saved — reconnecting…', 'success');
                  } else {
                    localStorage.removeItem('server_url');
                    toast('Reverted to Standalone mode', 'info');
                  }
                  setTimeout(() => window.location.reload(), 500);
                }}
              >
                Save &amp; Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SliderRow({
  label,
  hint,
  value,
  onChange,
  onTest,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
  onTest: () => void;
}) {
  const pct = Math.round(value * 100);
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-baseline justify-between">
        <div className="text-xs font-bold text-slate-200">
          {label} <span className="ml-1 font-mono text-[11px] text-slate-500">{pct}%</span>
        </div>
        <button
          type="button"
          className="text-[10px] font-black uppercase tracking-widest text-emerald-400 hover:text-emerald-300"
          onClick={onTest}
        >
          test sound
        </button>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-emerald-400"
        style={{
          background: `linear-gradient(to right, #17b978 ${pct}%, rgba(255,255,255,0.10) ${pct}%)`,
        }}
      />
      <div className="mt-0.5 text-[10px] text-slate-500">{hint}</div>
    </div>
  );
}