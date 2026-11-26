/** Sign in / register / password reset. Email verification is surfaced inline. */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { navigate } from '../lib/router';
import { Spinner } from '../components/ui';
import { sfx } from '../lib/sfx';

const AVATARS = ['⚽', '🔥', '🦈', '🚀', '🐉', '🦅', '👑', '🎯', '🐺', '⚡', '🥇', '🤖'];

type Mode = 'login' | 'register' | 'forgot' | 'reset';

export function AuthPage() {
  const { login, register, toast } = useApp();
  const [mode, setMode] = useState<Mode>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [country, setCountry] = useState('BD');
  const [avatar, setAvatar] = useState('⚽');
  const [resetToken, setResetToken] = useState('');
  const [verifyLink, setVerifyLink] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const hasJoinTarget =
        typeof window !== 'undefined' &&
        (window.location.hash.includes('join') ||
          window.location.search.includes('join') ||
          window.location.pathname.includes('/join/'));

      if (mode === 'login') {
        await login(email, password);
        toast('Welcome back!', 'success');
        if (!hasJoinTarget) navigate('/');
      } else if (mode === 'register') {
        const res = await register({ email, username, password, country, avatar });
        toast(`Account created — you start at 1000 rating`, 'success');
        if (res?.verification?.devToken) setVerifyLink(res.verification.link);
        if (!hasJoinTarget) navigate('/');
      } else if (mode === 'forgot') {
        const res = await api.post<{ devToken?: string; message: string }>('/auth/forgot-password', { email });
        setNotice(res.message);
        if (res.devToken) {
          setResetToken(res.devToken);
          setMode('reset');
          setNotice('Dev mode: reset token filled in for you.');
        }
      } else if (mode === 'reset') {
        await api.post('/auth/reset-password', { token: resetToken, password });
        toast('Password updated — sign in with your new password', 'success');
        setMode('login');
      }
    } catch (err: any) {
      let msg = err?.message ?? 'Something went wrong';
      if (typeof msg === 'string' && (msg.includes('<html') || msg.includes('405'))) {
        msg = 'Could not reach server. Ready to create your account in offline/browser mode!';
      }
      setError(msg);
      sfx.click();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative grid min-h-[100dvh] place-items-center overflow-hidden p-4">
      <div className="pointer-events-none absolute -left-32 top-0 h-[420px] w-[420px] rounded-full bg-emerald-500/20 blur-[120px]" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-[420px] w-[420px] rounded-full bg-indigo-500/20 blur-[120px]" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-[linear-gradient(155deg,rgba(18,28,44,0.92),rgba(8,12,20,0.94))] shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)] backdrop-blur-xl"
      >
        <div className="grid md:grid-cols-2">
          {/* ------------------------------------------------------- pitch side */}
          <div className="relative hidden flex-col justify-between overflow-hidden p-8 md:flex">
            <div className="absolute inset-0 opacity-[0.16]">
              <svg viewBox="0 0 400 400" className="h-full w-full">
                <defs>
                  <pattern id="pitch" width="40" height="40" patternUnits="userSpaceOnUse">
                    <rect width="40" height="40" fill="#17b978" opacity="0.25" />
                  </pattern>
                </defs>
                <rect width="400" height="400" fill="url(#pitch)" />
                <rect x="20" y="20" width="360" height="360" fill="none" stroke="#e8eefc" strokeWidth="2" opacity="0.6" />
                <line x1="200" y1="20" x2="200" y2="380" stroke="#e8eefc" strokeWidth="2" opacity="0.6" />
                <circle cx="200" cy="200" r="60" fill="none" stroke="#e8eefc" strokeWidth="2" opacity="0.6" />
                <rect x="20" y="120" width="60" height="160" fill="none" stroke="#e8eefc" strokeWidth="2" opacity="0.6" />
                <rect x="320" y="120" width="60" height="160" fill="none" stroke="#e8eefc" strokeWidth="2" opacity="0.6" />
              </svg>
            </div>
            <div className="relative">
              <div className="text-[11px] font-black uppercase tracking-[0.35em] text-emerald-400">
                Table Soccer Arena
              </div>
              <h1 className="mt-3 text-4xl font-black leading-[1.05]">
                Play together.
                <br />
                Compete.
                <br />
                <span className="bg-gradient-to-r from-emerald-300 to-cyan-300 bg-clip-text text-transparent">
                  Climb the rankings.
                </span>
              </h1>
              <p className="mt-4 max-w-xs text-sm text-slate-400">
                Four-player online foosball with server-authoritative physics, Elo ratings, tournaments and
                a global leaderboard — instantly in your browser.
              </p>
            </div>
            <div className="relative grid grid-cols-3 gap-2 text-center">
              {[
                { k: '2v2', v: 'Live' },
                { k: 'Elo', v: 'Rated' },
                { k: '0', v: 'Installs' },
              ].map((s) => (
                <div key={s.k} className="rounded-xl border border-white/10 bg-black/25 p-2">
                  <div className="text-lg font-black text-emerald-300">{s.k}</div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-500">{s.v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* --------------------------------------------------------- form side */}
          <div className="p-6 sm:p-8">
            <div className="mb-5 flex items-center gap-2 md:hidden">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-500 text-lg font-black text-emerald-950">
                ⚽
              </div>
              <div className="text-sm font-black uppercase tracking-[0.2em] text-emerald-400">Arena</div>
            </div>

            <div className="mb-4 flex gap-1 rounded-xl bg-black/30 p-1">
              {(['login', 'register'] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setMode(m);
                    setError(null);
                  }}
                  className={`flex-1 rounded-lg py-2 text-xs font-black uppercase tracking-wider transition ${
                    mode === m ? 'bg-emerald-500 text-emerald-950' : 'text-slate-400'
                  }`}
                >
                  {m === 'login' ? 'Sign in' : 'Create account'}
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="space-y-3">
              {mode === 'register' && (
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-slate-400">
                    Username
                  </label>
                  <input
                    className="input"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="rod_master"
                    autoComplete="username"
                    required
                  />
                </div>
              )}

              {mode !== 'reset' && (
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-slate-400">
                    Email
                  </label>
                  <input
                    className="input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                  />
                </div>
              )}

              {mode === 'reset' && (
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-slate-400">
                    Reset token
                  </label>
                  <input className="input" value={resetToken} onChange={(e) => setResetToken(e.target.value)} required />
                </div>
              )}

              {mode !== 'forgot' && (
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-slate-400">
                    Password
                  </label>
                  <input
                    className="input"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 chars, letters + numbers"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    required
                  />
                </div>
              )}

              {mode === 'register' && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-slate-400">
                        Country
                      </label>
                      <input
                        className="input uppercase"
                        value={country}
                        maxLength={2}
                        onChange={(e) => setCountry(e.target.value.toUpperCase())}
                        placeholder="BD"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-slate-400">
                        Avatar
                      </label>
                      <div className="scroll-thin flex gap-1 overflow-x-auto pb-1">
                        {AVATARS.map((a) => (
                          <button
                            type="button"
                            key={a}
                            onClick={() => setAvatar(a)}
                            className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-lg transition ${
                              avatar === a ? 'bg-emerald-500/30 ring-1 ring-emerald-400' : 'bg-white/5'
                            }`}
                          >
                            {a}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {error && (
                <div className="shake rounded-lg bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-300">
                  {error}
                </div>
              )}
              {notice && (
                <div className="rounded-lg bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-300">
                  {notice}
                </div>
              )}
              {verifyLink && (
                <div className="rounded-lg bg-amber-500/15 px-3 py-2 text-[11px] text-amber-200">
                  Verification email sent. Dev shortcut:{' '}
                  <a className="underline" href={verifyLink}>
                    verify now
                  </a>
                </div>
              )}

              <button className="btn btn-primary w-full py-3" disabled={busy}>
                {busy ? <Spinner /> : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Set new password'}
              </button>

              {mode === 'login' && (
                <button
                  type="button"
                  onClick={async () => {
                    setEmail('rashedcse18@gmail.com');
                    setPassword('Wprashed@125#');
                    setBusy(true);
                    try {
                      await login('rashedcse18@gmail.com', 'Wprashed@125#');
                      toast('Signed in as Master Admin (rashedcse18@gmail.com)', 'success');
                      navigate('/admin');
                    } catch (e: any) {
                      toast(e.message, 'error');
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="btn btn-secondary w-full py-2.5 text-xs font-black inline-flex items-center justify-center gap-2 border border-rose-500/30 text-rose-300 hover:bg-rose-500/10"
                >
                  🛡️ One-Click Master Admin Sign In
                </button>
              )}
            </form>

            <div className="mt-3 flex justify-between text-[11px]">
              <button className="text-slate-400 hover:text-emerald-300" onClick={() => setMode('forgot')}>
                Forgot password?
              </button>
              {mode !== 'login' && (
                <button className="text-slate-400 hover:text-emerald-300" onClick={() => setMode('login')}>
                  Back to sign in
                </button>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
