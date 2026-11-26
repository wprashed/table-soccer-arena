import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useApp } from './lib/store';
import { Link, matchRoute, navigate, useLocation } from './lib/router';
import { getSocket } from './lib/socket';
import { reconnectAuth } from './lib/socket';
import { setSfxEnabled, sfx } from './lib/sfx';
import { unlockAudio } from './lib/audio';
import { Avatar, Spinner, ToastHost, TierPill } from './components/ui';
import { AuthPage } from './pages/AuthPage';
import { Dashboard } from './pages/Dashboard';
import { QuickMatch } from './pages/QuickMatch';
import { Leaderboard } from './pages/Leaderboard';
import { Social } from './pages/Social';
import { Tournaments } from './pages/Tournaments';
import { Practice } from './pages/Practice';
import { Store } from './pages/Store';
import { Profile } from './pages/Profile';
import { History } from './pages/History';
import { Settings } from './pages/Settings';
import { Admin } from './pages/Admin';
import { MatchScreen } from './game/MatchScreen';
import { JoinRoom } from './pages/JoinRoom';

const NAV = [
  { to: '/', label: 'Home', icon: '🏠' },
  { to: '/play/quick', label: 'Play', icon: '⚡' },
  { to: '/tournaments', label: 'Cups', icon: '🏆' },
  { to: '/leaderboard', label: 'Ranks', icon: '📊' },
  { to: '/friends', label: 'Friends', icon: '👥' },
  { to: '/store', label: 'Store', icon: '🛍️' },
];

/**
 * Phones get five destinations, not seven. Seven 52 px tabs on a 390 px screen
 * leaves ~55 px each — too cramped to read or hit reliably, and "Cups" and
 * "Store" are occasional visits. Those two live one tap deeper, in the You hub.
 */
const MOBILE_NAV = [
  { to: '/', label: 'Home', icon: '🏠' },
  { to: '/play/quick', label: 'Play', icon: '⚡' },
  { to: '/leaderboard', label: 'Ranks', icon: '📊' },
  { to: '/friends', label: 'Friends', icon: '👥' },
  { to: '/settings', label: 'You', icon: '⚙' },
];

export default function App() {
  const { user, booting, boot, online, setOnline, soundOn, profile } = useApp();
  const path = useLocation();
  const [matchId, setMatchId] = useState<string | null>(null);

  useEffect(() => {
    boot();
  }, [boot]);

  useEffect(() => {
    setSfxEnabled(soundOn);
  }, [soundOn]);

  // Browsers (and iOS especially) only allow audio after a gesture, so the
  // first interaction anywhere in the app starts the audio context and warms
  // the sample cache. Until then the mixer stays suspended and silent.
  useEffect(() => {
    unlockAudio();
  }, []);

  // One delegated listener gives *every* button in the app a click sound and a
  // subtle hover tick, without touching each component.
  useEffect(() => {
    if (!soundOn) return;
    let last = 0;
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest('button, a.btn, [role="button"]');
      if (!el || (el as HTMLButtonElement).disabled) return;
      last = Date.now();
      sfx.click();
    };
    const onOver = (e: PointerEvent) => {
      if (Date.now() - last < 220) return;
      const el = (e.target as HTMLElement | null)?.closest('button, a.btn');
      if (!el) return;
      sfx.hover();
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('pointerover', onOver, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('pointerover', onOver, true);
    };
  }, [soundOn]);

  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    reconnectAuth();
    const onReady = (p: any) => setOnline(p.online ?? 0);
    const onLobby = (p: any) => setOnline(p.online ?? 0);
    socket.on('ready', onReady);
    socket.on('lobby:state', onLobby);
    socket.emit('lobby:hello');
    const iv = setInterval(() => socket.emit('presence:ping'), 25_000);
    return () => {
      socket.off('ready', onReady);
      socket.off('lobby:state', onLobby);
      clearInterval(iv);
    };
  }, [user, setOnline]);

  // room invite toasts (global)
  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    const onInvited = (p: any) => {
      if (p?.view?.mode === 'quick') return;
      useApp.getState().toast(`${p.from ?? 'A friend'} invited you to room ${p.code}`, 'info');
    };
    socket.on('room:invited', onInvited);
    return () => {
      socket.off('room:invited', onInvited);
    };
  }, [user]);

  // route the match view
  const match = matchRoute('/match/:id', path);
  useEffect(() => {
    setMatchId(match?.id ?? null);
  }, [match?.id]);

  if (booting) {
    return (
      <div className="grid min-h-[100dvh] place-items-center">
        <div className="flex flex-col items-center gap-3">
          <div className="text-3xl">⚽</div>
          <Spinner size={26} />
          <div className="text-xs uppercase tracking-widest text-slate-500">Loading arena…</div>
        </div>
      </div>
    );
  }

  if (!user) return (<><AuthPage /><ToastHost /></>);

  // in-match: full bleed, no chrome
  if (matchId) {
    return (
      <>
        <MatchScreen matchId={matchId} onExit={() => navigate('/')} />
        <ToastHost />
      </>
    );
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-6xl flex-col">
      <TopBar />
      <main className="page-safe flex-1 pt-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={path}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <Routes path={path} />
          </motion.div>
        </AnimatePresence>
      </main>
      <BottomNav path={path} />
      <ToastHost />
    </div>
  );
}

function Routes({ path }: { path: string }) {
  if (matchRoute('/', path)) return <Dashboard />;
  if (matchRoute('/play/quick', path)) return <QuickMatch />;
  if (matchRoute('/practice', path)) return <Practice />;
  if (matchRoute('/leaderboard', path)) return <Leaderboard />;
  if (matchRoute('/friends', path)) return <Social />;
  if (matchRoute('/tournaments', path)) return <Tournaments />;
  if (matchRoute('/store', path)) return <Store />;
  if (matchRoute('/history', path)) return <History />;
  if (matchRoute('/settings', path)) return <Settings />;
  if (matchRoute('/admin', path)) return <Admin />;
  const join = matchRoute('/join/:code', path);
  if (join) return <JoinRoom code={join.code} />;
  const player = matchRoute('/player/:username', path);
  if (player) return <Profile username={player.username} />;
  return (
    <div className="grid place-items-center py-24 text-center">
      <div className="text-5xl">🧭</div>
      <div className="mt-2 text-lg font-black">Page not found</div>
      <Link to="/" className="btn btn-primary mt-3 px-4 py-2 text-sm">
        Back to dashboard
      </Link>
    </div>
  );
}

function TopBar() {
  const { user, online, logout } = useApp();
  if (!user) return null;
  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/10 bg-ink-950/80 px-3 py-2 backdrop-blur-xl sm:px-5">
      <Link to="/" className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 text-base text-emerald-950 shadow-lg shadow-emerald-500/30">
          ⚽
        </span>
        <span className="hidden text-sm font-black uppercase tracking-[0.18em] text-emerald-300 sm:block">
          Table Soccer <span className="text-slate-400">Arena</span>
        </span>
      </Link>

      <nav className="ml-2 hidden items-center gap-1 md:flex">
        {NAV.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-300 transition hover:bg-white/5 hover:text-white"
          >
            {n.label}
          </Link>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <span className="chip hidden bg-emerald-500/15 text-emerald-300 sm:inline-flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> {online || 1} online
        </span>
        <Link to="/store" className="chip bg-amber-400/15 text-amber-300">
          🪙 {user.coins}
        </Link>
        {(user.role === 'admin' || user.email?.toLowerCase() === 'rashedcse18@gmail.com') && (
          <Link
            to="/admin"
            className="chip border border-rose-500/40 bg-rose-500/20 text-rose-300 font-bold hover:bg-rose-500/30 transition text-xs"
            title="Admin Dashboard"
          >
            🛡️ Admin
          </Link>
        )}
        <button onClick={() => sfx.click()} className="hidden sm:block" title="Your rank">
          <TierPill rating={user.rating} />
        </button>
        <Link to={`/player/${user.username}`} className="flex items-center gap-1.5" title="Your profile">
          <Avatar emoji={user.avatar} size={30} frame={(user as any).frame} />
        </Link>
        <Link
          to="/settings"
          className="btn btn-ghost hidden h-8 w-8 !p-0 text-xs sm:inline-flex"
          title="Settings"
        >
          ⚙
        </Link>
        <button
          className="btn btn-ghost hidden h-8 px-2 text-[11px] sm:block"
          onClick={() => logout()}
          title="Sign out"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}

function BottomNav({ path }: { path: string }) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-ink-950/90 backdrop-blur-xl md:hidden">
      <div
        className="mx-auto flex max-w-md"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {MOBILE_NAV.map((n) => {
          const active = path === n.to || (n.to !== '/' && path.startsWith(n.to));
          return (
            <Link
              key={n.to}
              to={n.to}
              className={`flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[9px] font-bold uppercase tracking-wider transition-colors ${
                active ? 'text-emerald-400' : 'text-slate-500 active:text-slate-300'
              }`}
            >
              <span className="text-base">{n.icon}</span>
              {n.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
