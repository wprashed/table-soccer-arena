import { useEffect, useState, useRef, Component } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useApp } from './lib/store';
import { Link, matchRoute, navigate, useLocation } from './lib/router';
import { getSocket } from './lib/socket';
import { reconnectAuth } from './lib/socket';
import { setSfxEnabled, sfx } from './lib/sfx';
import { unlockAudio } from './lib/audio';
import { Avatar, Spinner, ToastHost, TierPill } from './components/ui';
import { usePwa } from './lib/pwa';
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

class RouteErrorBoundary extends Component<
  { children: React.ReactNode; path: string },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: any, info: any) {
    console.error('Subpage render error:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="glass mx-auto my-12 max-w-md rounded-2xl p-6 text-center">
          <div className="text-4xl">⚽</div>
          <div className="mt-2 text-base font-black text-white">Could not load this view</div>
          <p className="mt-1 text-xs text-slate-400">
            A temporary display error occurred. You can reload this view or return to the main dashboard.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              onClick={() => this.setState({ hasError: false })}
              className="btn btn-secondary px-3.5 py-2 text-xs font-bold"
            >
              Try Again
            </button>
            <Link to="/" className="btn btn-primary px-3.5 py-2 text-xs font-bold">
              Back to Home
            </Link>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function Routes({ path }: { path: string }) {
  const { user } = useApp();
  return (
    <RouteErrorBoundary key={path} path={path}>
      {renderRoute(path, user?.username)}
    </RouteErrorBoundary>
  );
}

function renderRoute(path: string, currentUsername?: string) {
  if (matchRoute('/', path)) return <Dashboard />;
  // Play & matchmaking
  if (matchRoute('/play/quick', path) || matchRoute('/play', path) || matchRoute('/quick', path)) return <QuickMatch />;
  if (matchRoute('/practice', path)) return <Practice />;
  // Ranks & leaderboards
  if (matchRoute('/leaderboard', path) || matchRoute('/ranks', path) || matchRoute('/rankings', path)) return <Leaderboard />;
  // Social & friends
  if (matchRoute('/friends', path) || matchRoute('/social', path)) return <Social />;
  // Tournaments & cups
  if (matchRoute('/tournaments', path) || matchRoute('/cups', path) || matchRoute('/cup', path)) return <Tournaments />;
  // Store & cosmetics
  if (matchRoute('/store', path) || matchRoute('/shop', path)) return <Store />;
  // History & past matches
  if (matchRoute('/history', path) || matchRoute('/matches', path)) return <History />;
  // Settings & account
  if (matchRoute('/settings', path) || matchRoute('/account', path)) return <Settings />;
  // Admin console
  if (matchRoute('/admin', path)) return <Admin />;
  // Direct profile route
  if (matchRoute('/profile', path)) return <Profile username={currentUsername ?? ''} />;
  // Room join
  const join = matchRoute('/join/:code', path);
  if (join) return <JoinRoom code={join.code} />;
  // Public player profile
  const player = matchRoute('/player/:username', path);
  if (player) return <Profile username={player.username} />;

  return (
    <div className="grid place-items-center py-24 text-center">
      <div className="text-5xl">🧭</div>
      <div className="mt-2 text-lg font-black">Page not found</div>
      <p className="mt-1 text-xs text-slate-400">The requested page "{path}" does not exist.</p>
      <Link to="/" className="btn btn-primary mt-3 px-4 py-2 text-sm font-bold">
        Back to arena
      </Link>
    </div>
  );
}

function TopBar() {
  const { user, online, logout, soundOn, toggleSound } = useApp();
  const { canInstall, install, isStandalone } = usePwa();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const path = useLocation();

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [path]);

  if (!user) return null;

  const isAdmin = user.role === 'admin' || user.email?.toLowerCase() === 'rashedcse18@gmail.com';

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-ink-950/85 px-3 py-2.5 pt-[calc(0.6rem+env(safe-area-inset-top))] backdrop-blur-xl sm:px-5">
      <div className="mx-auto flex max-w-6xl items-center gap-3">
        {/* Brand: football logo only */}
        <Link to="/" className="flex items-center group shrink-0" title="Table Soccer Arena">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-lg text-emerald-950 shadow-md shadow-emerald-500/30 transition group-hover:scale-105">
            ⚽
          </span>
        </Link>

        {/* Navigation tabs */}
        <nav className="ml-3 hidden items-center gap-1 md:flex shrink-0">
          {NAV.map((n) => {
            const active = path === n.to || (n.to !== '/' && path.startsWith(n.to));
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all whitespace-nowrap ${
                  active
                    ? 'bg-emerald-500/15 text-emerald-300 shadow-sm'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>

        {/* Right side tools & Profile */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {/* Live Online Badge */}
          <div className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-bold text-emerald-300 whitespace-nowrap shrink-0">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="whitespace-nowrap">{online || 1} online</span>
          </div>

          {/* PWA Install Button */}
          {canInstall && !isStandalone && (
            <button
              onClick={() => install()}
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/30 text-xs font-bold text-emerald-300 transition whitespace-nowrap shrink-0"
              title="Install Table Soccer Arena app"
            >
              <span>📲</span>
              <span className="text-[11px]">Install</span>
            </button>
          )}

          {/* Coin Wallet */}
          <Link
            to="/store"
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-400/10 hover:bg-amber-400/20 border border-amber-400/25 text-xs font-black text-amber-300 transition-all hover:scale-[1.02] whitespace-nowrap shrink-0"
            title="Coin balance — Visit store"
          >
            <span>🪙</span>
            <span className="font-mono font-bold">{user.coins.toLocaleString()}</span>
          </Link>

          {/* Master Admin shortcut (if admin) */}
          {isAdmin && (
            <Link
              to="/admin"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-xs font-black text-rose-300 transition hover:scale-[1.02] whitespace-nowrap shrink-0"
              title="Admin Dashboard"
            >
              <span>🛡️</span>
              <span className="text-[11px] uppercase tracking-wider">Admin</span>
            </Link>
          )}

          {/* Direct Settings Shortcut (Desktop) */}
          <Link
            to="/settings"
            className="btn btn-ghost hidden h-8 w-8 !p-0 text-xs sm:inline-flex rounded-full border border-white/10 shrink-0"
            title="Settings & Profile"
          >
            ⚙
          </Link>

          {/* Unified Player Profile Capsule & Dropdown */}
          <div className="relative shrink-0" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className={`flex items-center gap-2 rounded-full border transition-all ${
                menuOpen
                  ? 'border-emerald-400/50 bg-white/[0.08] ring-2 ring-emerald-400/20'
                  : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20'
              } p-1 pr-2.5`}
              title="Player menu & settings"
            >
              <Avatar emoji={user.avatar} size={28} frame={(user as any).frame} />
              <div className="hidden sm:flex flex-col text-left leading-none">
                <span className="text-xs font-bold text-slate-200 truncate max-w-[90px]">{user.username}</span>
                <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-wider mt-0.5">
                  {user.position === 'defence' ? '🛡️ Def' : user.position === 'any' ? '🎲 Flex' : '⚽ Atk'}
                </span>
              </div>
              <div className="hidden md:block">
                <TierPill rating={user.rating} />
              </div>
              <span className={`text-[10px] text-slate-400 transition-transform duration-200 ${menuOpen ? 'rotate-180' : ''}`}>
                ▾
              </span>
            </button>

            {/* Dropdown Menu */}
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.96 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 mt-2 w-64 rounded-2xl border border-white/15 bg-ink-950/95 p-2 shadow-2xl backdrop-blur-2xl z-50 divide-y divide-white/[0.08]"
                >
                  {/* User identity header */}
                  <div className="p-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar emoji={user.avatar} size={36} frame={(user as any).frame} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-sm text-white truncate">{user.username}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">{user.email || 'No email attached'}</div>
                      </div>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between text-xs rounded-xl bg-white/[0.04] p-2">
                      <span className="text-slate-400">Position:</span>
                      <span className="font-bold text-emerald-300">
                        {user.position === 'defence' ? '🛡️ Defence (Goalie)' : user.position === 'any' ? '🎲 Any Position' : '⚽ Striker (Attack)'}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="py-1.5 space-y-0.5">
                    <Link
                      to={`/player/${user.username}`}
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-200 hover:bg-white/10 transition"
                    >
                      <span className="text-base">👤</span>
                      <span>View Player Profile</span>
                    </Link>
                    <Link
                      to="/settings"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-200 hover:bg-white/10 transition"
                    >
                      <span className="text-base">⚙️</span>
                      <span>Profile &amp; Position Settings</span>
                    </Link>
                    <Link
                      to="/store"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-200 hover:bg-white/10 transition"
                    >
                      <span className="text-base">🛍️</span>
                      <span>Skins &amp; Cosmetic Store</span>
                    </Link>
                    {isAdmin && (
                      <Link
                        to="/admin"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-bold text-rose-300 hover:bg-rose-500/20 transition"
                      >
                        <span className="text-base">🛡️</span>
                        <span>Admin Dashboard</span>
                      </Link>
                    )}
                  </div>

                  {/* Sound Toggle & Sign Out */}
                  <div className="pt-1.5 space-y-0.5">
                    <button
                      type="button"
                      onClick={() => toggleSound()}
                      className="flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-xs font-bold text-slate-300 hover:bg-white/10 transition"
                    >
                      <span className="flex items-center gap-2.5">
                        <span className="text-base">{soundOn ? '🔊' : '🔇'}</span>
                        <span>Sound Effects</span>
                      </span>
                      <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${soundOn ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-slate-400'}`}>
                        {soundOn ? 'ON' : 'OFF'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        logout();
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-bold text-rose-400 hover:bg-rose-500/15 transition"
                    >
                      <span className="text-base">🚪</span>
                      <span>Sign Out</span>
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
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
