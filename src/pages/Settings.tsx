/** Account settings, controls remapping, audio and cosmetics. */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { Spinner } from '../components/ui';
import { previewSound } from '../lib/audio';
import { Link } from '../lib/router';
import {
  CONTROL_LABELS,
  DEFAULT_BINDINGS,
  loadBindings,
  prettyKey,
  saveBindings,
  type Action,
} from '../game/useControls';

const AVATARS = ['⚽', '🔥', '🦈', '🚀', '🐉', '🦅', '👑', '🎯', '🐺', '⚡', '🥇', '🤖'];

export function Settings() {
  const {
    profile, refresh, toast, logout, user,
    soundOn, toggleSound, sfxVolume, setSfxVolume, crowdVolume, setCrowdVolume,
  } = useApp();
  const [avatar, setAvatar] = useState(user?.avatar ?? '⚽');
  const [country, setCountry] = useState(user?.country ?? 'BD');
  const [bio, setBio] = useState('');
  const [preferredPosition, setPreferredPosition] = useState<'striker' | 'defence' | 'any'>(
    (profile as any)?.profile?.preferredPosition ?? 'striker'
  );
  const [bindings, setBindings] = useState(loadBindings());
  const [listening, setListening] = useState<Action | null>(null);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [customServer, setCustomServer] = useState(
    typeof window !== 'undefined' ? localStorage.getItem('server_url') || '' : ''
  );
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'profile' | 'controls' | 'audio' | 'account'>('profile');

  useEffect(() => {
    if (!profile) return;
    setBio((profile as any).profile?.bio ?? '');
    if ((profile as any).profile?.preferredPosition) {
      setPreferredPosition((profile as any).profile.preferredPosition);
    }
  }, [profile]);

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

  const saveProfile = async () => {
    setBusy(true);
    try {
      await api.patch('/profile', { avatar, country, bio, preferredPosition });
      await refresh();
      toast('Profile updated', 'success');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    setBusy(true);
    try {
      await api.post('/account/password', pw);
      toast('Password changed — please sign in again', 'success');
      setPw({ current: '', next: '' });
      setTimeout(() => logout(), 1200);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black">Settings</h1>
        <p className="text-xs text-slate-400">Profile, controls and account security.</p>
      </div>

      {/* The phone tab bar has five slots, so Cups and Store live here. Showing
          them on every screen is cheaper than a "more" drawer nobody opens. */}
      <div className="grid grid-cols-3 gap-2 md:hidden">
        <Link to={`/player/${user?.username ?? ''}`} className="glass-soft rounded-xl p-3 text-center">
          <div className="text-lg">👤</div>
          <div className="mt-0.5 text-[11px] font-black">Profile</div>
        </Link>
        <Link to="/tournaments" className="glass-soft rounded-xl p-3 text-center">
          <div className="text-lg">🏆</div>
          <div className="mt-0.5 text-[11px] font-black">Cups</div>
        </Link>
        <Link to="/store" className="glass-soft rounded-xl p-3 text-center">
          <div className="text-lg">🛍️</div>
          <div className="mt-0.5 text-[11px] font-black">Store</div>
        </Link>
      </div>

      <div className="flex gap-1 rounded-xl bg-black/30 p-1">
        {(['profile', 'controls', 'audio', 'account'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg py-2 text-xs font-black uppercase tracking-wider capitalize ${
              tab === t ? 'bg-emerald-500 text-emerald-950' : 'text-slate-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <div className="glass space-y-4 rounded-2xl p-4">
          <div>
            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Avatar</label>
            <div className="flex flex-wrap gap-1.5">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  onClick={() => setAvatar(a)}
                  className={`grid h-10 w-10 place-items-center rounded-xl text-xl ${
                    avatar === a ? 'bg-emerald-500/30 ring-1 ring-emerald-400' : 'bg-white/5'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Country</label>
              <input className="input uppercase" maxLength={2} value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Sound</label>
              <button className={`btn w-full py-2 text-xs ${soundOn ? 'btn-primary' : 'btn-ghost'}`} onClick={toggleSound}>
                {soundOn ? 'On' : 'Off'}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">
              Preferred Match Position
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'striker' as const, label: '⚽ Striker', desc: 'Attack (3-bar & 5-bar)' },
                { id: 'defence' as const, label: '🛡️ Defence', desc: 'Goalie (1-bar & 2-bar)' },
                { id: 'any' as const, label: '🎲 Any Role', desc: 'Flexible / Fill' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPreferredPosition(p.id)}
                  className={`rounded-xl p-2.5 text-left transition ${
                    preferredPosition === p.id
                      ? 'bg-emerald-500 text-emerald-950 font-black ring-1 ring-emerald-300'
                      : 'bg-white/5 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  <div className="text-xs font-black">{p.label}</div>
                  <div className={`text-[9px] ${preferredPosition === p.id ? 'text-emerald-900 font-bold' : 'text-slate-400'}`}>
                    {p.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Bio</label>
            <textarea className="input min-h-[70px]" maxLength={200} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell opponents who you are" />
          </div>
          <button className="btn btn-primary w-full py-2.5" onClick={saveProfile} disabled={busy}>
            {busy ? <Spinner size={16} /> : 'Save profile'}
          </button>
        </div>
      )}

      {tab === 'controls' && (
        <div className="glass space-y-3 rounded-2xl p-4">
          <p className="text-xs text-slate-400">
            Click a binding then press any key. Inputs are rate-limited on the server, so smoother key mashing
            still converts into powerful shots.
          </p>
          {(Object.keys(CONTROL_LABELS) as Action[]).map((a) => (
            <div key={a} className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
              <span className="text-sm font-bold">{CONTROL_LABELS[a]}</span>
              <button
                className={`btn px-3 py-1.5 text-xs ${listening === a ? 'btn-flame animate-pulse' : 'btn-ghost'}`}
                onClick={() => setListening(a)}
              >
                {listening === a ? 'Press a key…' : (bindings[a] ?? []).map(prettyKey).join(' / ') || 'Unbound'}
              </button>
            </div>
          ))}
          <button
            className="btn btn-ghost w-full py-2 text-xs"
            onClick={() => {
              setBindings(DEFAULT_BINDINGS);
              saveBindings(DEFAULT_BINDINGS);
              toast('Bindings restored to defaults', 'success');
            }}
          >
            Reset to defaults
          </button>
        </div>
      )}

      {tab === 'audio' && (
        <div className="space-y-3">
          <div className="glass rounded-2xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="font-black">Sound &amp; atmosphere</div>
                <div className="text-[11px] text-slate-400">
                  Ball, rods, whistle and crowd are real recorded-style samples — they follow the action live.
                </div>
              </div>
              <button
                className={`btn h-9 px-3 text-xs ${soundOn ? 'btn-primary' : 'btn-ghost'}`}
                onClick={toggleSound}
              >
                {soundOn ? 'Sound on' : 'Muted'}
              </button>
            </div>

            <SliderRow
              label="Effects"
              hint="Kicks, wall knocks, goals, whistle"
              value={sfxVolume}
              onChange={setSfxVolume}
              onTest={() => previewSound('ball')}
            />
            <SliderRow
              label="Crowd"
              hint="Ambient arena noise during matches"
              value={crowdVolume}
              onChange={setCrowdVolume}
              onTest={() => previewSound('cheer')}
            />

            <div className="mt-4">
              <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Test sounds</div>
              <div className="flex flex-wrap gap-2">
                {([
                  ['ball', 'Ball kick'],
                  ['goal', 'Goal'],
                  ['whistle', 'Whistle'],
                  ['cheer', 'Crowd'],
                  ['victory', 'Victory'],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    className="btn btn-ghost h-9 px-3 text-xs"
                    onClick={() => previewSound(key)}
                  >
                    ▶ {label}
                  </button>
                ))}
              </div>
              {!soundOn && (
                <p className="mt-2 text-[11px] text-amber-300/90">Sound is muted — turn it on to hear previews.</p>
              )}
            </div>
          </div>

          <div className="glass-soft rounded-2xl p-4 text-[11px] leading-relaxed text-slate-400">
            <b className="text-slate-200">Why real samples?</b> A foosball table sounds like a hollow plastic
            ball, a wooden box and metal rods. These sounds are physically modelled offline (modal synthesis for
            the rods and rails, filtered noise bursts for the ball, formant-filtered voices for the crowd) and
            shipped as small WAVs, so they work offline and never depend on a CDN.
          </div>
        </div>
      )}

      {tab === 'account' && (
        <div className="space-y-4">
          <div className="glass space-y-3 rounded-2xl p-4">
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-300">Change password</h2>
            <input
              className="input"
              type="password"
              placeholder="Current password"
              value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })}
            />
            <input
              className="input"
              type="password"
              placeholder="New password (8+ chars, letters + numbers)"
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
            />
            <button className="btn btn-primary w-full py-2.5" onClick={changePassword} disabled={busy || !pw.current || !pw.next}>
              {busy ? <Spinner size={16} /> : 'Update password'}
            </button>
          </div>
          <div className="glass space-y-2 rounded-2xl p-4">
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-300">Account</h2>
            <div className="text-xs text-slate-400">
              Signed in as <b className="text-slate-200">{user?.username}</b> (#{user?.id.slice(-6)})
            </div>
            <button className="btn btn-flame w-full py-2.5" onClick={() => logout()}>
              Sign out
            </button>
          </div>

          <div className="glass space-y-3 rounded-2xl p-4">
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-300">Multiplayer Server</h2>
            <p className="text-xs text-slate-400">
              By default on GitHub Pages, the game runs directly in your browser with real-time physics and AI matchmaking.
              Enter a custom server URL to join live cross-device 4-player lobbies.
            </p>
            <div className="flex items-center gap-2">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${customServer ? 'bg-emerald-400 animate-pulse' : 'bg-blue-400'}`} />
              <span className="text-xs font-bold text-slate-300">
                {customServer ? `Custom: ${customServer}` : 'Standalone Browser Mode (Zero latency / Offline ready)'}
              </span>
            </div>
            <input
              className="input text-xs"
              type="text"
              placeholder="e.g. https://table-soccer-api.up.railway.app"
              value={customServer}
              onChange={(e) => setCustomServer(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                className="btn btn-secondary flex-1 py-2 text-xs"
                onClick={() => {
                  localStorage.removeItem('server_url');
                  setCustomServer('');
                  toast('Reverted to Browser / Standalone mode', 'info');
                  setTimeout(() => window.location.reload(), 500);
                }}
              >
                Reset Default
              </button>
              <button
                className="btn btn-primary flex-1 py-2 text-xs"
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
                Save & Connect
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
        <button className="text-[10px] font-black uppercase tracking-widest text-emerald-400" onClick={onTest}>
          test
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
