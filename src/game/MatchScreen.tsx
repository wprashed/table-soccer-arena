/** The in-match experience: table, HUD, chat, touch controls, result overlay. */
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FoosballTable, type DragInfo } from './FoosballTable';
import { useMatchSession } from './useMatchSession';
import { useControls, loadBindings, SOLO_LABELS } from './useControls';
import { Avatar, RankBadge, Spinner } from '../components/ui';
import { useApp } from '../lib/store';
import { MATCH, ROD } from '../../shared/engine/constants';
import { sfx } from '../lib/sfx';
import { audio, preloadSounds } from '../lib/audio';
import { storage } from '../lib/safeStorage';
import { Link } from '../lib/router';
import { request } from '../lib/socket';
import { LobbyPanel } from './LobbyPanel';

const QUICK_CHAT = [
  'Nice shot! 🔥', 'Good game 👏', 'Nice pass!', 'On my side!', 'Oops 😅',
  'Focus! 💪', 'GG WP', 'Let’s go! ⚡',
];
const EMOJIS = ['🔥', '😂', '😱', '👏', '💪', '🎯', '😭', '🤝'];

export function MatchScreen({ matchId, onExit }: { matchId: string; onExit: () => void }) {
  const { profile, soundOn } = useApp();
  const session = useMatchSession(matchId);
  const { view, mySlot, frameRef, inputRef, chat, goalFlash, endInfo, countdown, connected, latency } = session;
  const [bindings] = useState(loadBindings());
  const [showChat, setShowChat] = useState(false);
  const [draft, setDraft] = useState('');
  const [chatLog, setChatLog] = useState<{ text: string; at: number }[]>([]);
  const [hudTick, setHudTick] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  /** latched the first time the player touches any control */
  const usedControls = useRef(false);
  const lastCountdown = useRef(0);

  const solo = !!view && view.mode === 'practice' && (view.teamA.length + view.teamB.length) <= 1;
  const controls = useControls(inputRef, {
    enabled: mySlot !== null && !endInfo,
    bindings,
    multiRod: solo,
    // drag-to-position needs to know where the rods actually are right now
    readRodSlide: () => (inputRef.current.slide ?? 0) * ROD.maxSlide,
  });

  // show the control hint on the player's first few matches only
  useEffect(() => {
    const seen = Number(storage.get('tsa.matchesPlayed') ?? '0');
    setShowHint(seen < 3);
  }, []);

  // warm the match samples as soon as the match screen mounts
  useEffect(() => {
    void preloadSounds(['ball-soft', 'wall-soft', 'rod-clack', 'serve', 'crowd-loop', 'crowd-tense', 'crowd-cheer', 'victory', 'defeat']);
  }, []);

  // HUD clock refresh
  useEffect(() => {
    const iv = setInterval(() => setHudTick((t) => t + 1), 200);
    return () => clearInterval(iv);
  }, []);

  // countdown beeps
  useEffect(() => {
    if (countdown && countdown !== lastCountdown.current) {
      lastCountdown.current = countdown;
      if (soundOn) audio.countdown(countdown);
    }
  }, [countdown, soundOn]);

  // floating chat toast
  useEffect(() => {
    const last = chat[chat.length - 1];
    if (last && (!chatLog.length || chatLog[chatLog.length - 1].text !== last.text)) {
      setChatLog((c) => [...c.slice(-3), { text: `${last.username}: ${last.text}`, at: Date.now() }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat]);

  useEffect(() => {
    if (!chatLog.length) return;
    const t = setTimeout(() => setChatLog((c) => c.slice(1)), 5200);
    return () => clearTimeout(t);
  }, [chatLog]);

  // In solo drill the pad drives seat 0 (the rod pair nearest the player's own
  // goal) so a phone user can still play; the keyboard drives all four seats.
  const padSeat = solo ? 0 : null;
  const slideDown = (dir: -1 | 1) => {
    if (padSeat !== null) controls.setSeatSlide(padSeat, dir);
    else controls.padSlide(dir);
  };
  const slideUp = () => {
    if (padSeat !== null) controls.setSeatSlide(padSeat, 0);
    controls.padSlide(0);
  };
  const kick = (which: 'rear' | 'front', on: boolean) => {
    if (padSeat !== null) controls.pressSeatKick(padSeat, which, on);
    else controls.pressKick(which, on);
  };

  // sampled every animation frame by the renderer to draw the aim guide
  const getOverlay = () => {
    const inp = inputRef.current;
    const wound = Math.max(inp.rear ?? 0, inp.front ?? 0);
    return { windup: wound, aimZ: inp.slide ?? 0 };
  };

  /**
   * Direct manipulation: the rod follows the finger.
   *
   * The table reports the pointer in normalised space; we convert that to a
   * world-space slide target. Solo drill routes the gesture to seat 0's pad so
   * a phone user can still move a rod.
   */
  const onDrag = (info: DragInfo) => {
    // seat 0 is a real seat — a truthiness check would leave it with a dead table
    if (mySlot === null) return;
    if (info.phase === 'end') {
      controls.setDragTarget(null);
      return;
    }
    if (padSeat !== null) {
      // solo drill: map the horizontal drag onto the driven seat's slide
      controls.setSeatSlide(padSeat, Math.max(-1, Math.min(1, info.nx * 1.6)));
      return;
    }
    // nx is -1..1 across the table, so the rods track the finger 1:1 — grab a
    // rod and it stays under your thumb rather than lagging behind a multiplier
    controls.setDragTarget(info.nx * ROD.maxSlide, info.velocity);
  };

  /** A fast sideways swipe strikes the ball — no need to reach the buttons. */
  const onFlick = (rod: 'rear' | 'front', power: number) => {
    if (mySlot === null) return;
    if (padSeat !== null) {
      controls.pressSeatKick(padSeat, rod, true);
      window.setTimeout(() => controls.pressSeatKick(padSeat, rod, false), 120);
      return;
    }
    controls.flickKick(rod, power);
    if (soundOn) sfx.kick(power * 0.7);
  };
  /** Rematch keeps you in the same funnel: another practice run or a fresh queue. */
  const rematch = async () => {
    if (view?.mode === 'practice') {
      const res = await request<any>('practice:start', { difficulty: 'normal', solo: solo });
      if (res?.ok) {
        window.history.replaceState({}, '', `/match/${res.matchId}`);
        window.location.reload();
        return;
      }
    }
    onExit();
    window.location.href = '/play/quick';
  };

  const myTeam = mySlot === null ? null : mySlot < 2 ? 'A' : 'B';
  const skin = profile?.profile.tableSkin ?? 'classic-green';
  const ballSkin = profile?.profile.ballSkin ?? 'classic-ball';

  const clock = useMemo(() => {
    const v = frameRef.current;
    const total = Math.max(0, Math.ceil(v.timeLeft));
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hudTick]);

  const score = useMemo(() => frameRef.current.score, [hudTick]);
  const phase = view?.phase ?? 'waiting';
  const live = phase === 'live' || phase === 'countdown';

  // The hint retires as soon as the player demonstrates they've found the
  // controls — waiting for a timer punishes people who got it immediately.
  useEffect(() => {
    if (!showHint || !live) return;
    // event-driven, not polled: input is only "active" for a moment
    if (usedControls.current) {
      setShowHint(false);
      return;
    }
    controls.onFirstInput?.(() => {
      usedControls.current = true;
      setShowHint(false);
    });
    // safety net for a player who never touches anything
    const t = setTimeout(() => setShowHint(false), 12000);
    return () => clearTimeout(t);
  }, [showHint, live, controls]);


  const playerRow = (team: 'A' | 'B', compact = false) => {
    const list = (team === 'A' ? view?.teamA : view?.teamB) ?? [];
    const accent = team === 'A' ? 'text-blue-400' : 'text-rose-400';
    if (compact) {
      return (
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <span className={`text-[9px] font-black ${accent}`}>{team}</span>
          {list.length === 0 && <span className="text-[10px] text-slate-500">…</span>}
          {list.map((p) => (
            <span
              key={p.id}
              className={`flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 ${
                p.slot === mySlot ? 'bg-white/10' : ''
              }`}
            >
              <span className="shrink-0">
                <Avatar emoji={p.avatar} size={14} />
              </span>
              <span className="truncate text-[10px] font-bold">{p.username}</span>
            </span>
          ))}
        </div>
      );
    }
    return (
      <div className="flex flex-1 flex-col gap-1.5">
        <div className={`text-[10px] font-black uppercase tracking-[0.18em] ${accent}`}>Team {team}</div>
        {list.length === 0 && <div className="text-xs text-slate-500">Waiting…</div>}
        {list.map((p) => {
          const isMe = p.slot === mySlot;
          return (
            <div
              key={p.id}
              className={`flex items-center gap-2 rounded-lg px-2 py-1 ${
                isMe ? 'bg-white/10 ring-1 ring-emerald-400/50' : ''
              }`}
            >
              <Avatar emoji={p.avatar} size={22} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-bold">
                  {p.username} {isMe && <span className="text-emerald-400">(you)</span>}
                </div>
                <div className="flex items-center gap-1 text-[10px] text-slate-400">
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      p.online ? 'bg-emerald-400' : 'bg-rose-500'
                    }`}
                  />
                  {p.rating}
                  <span className="opacity-40">·</span>
                  {p.slot === 0 || p.slot === 2 ? 'DEF' : 'ATK'}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden">
      {/* --------------------------------------------------------------- HUD */}
      <header
        className="z-20 flex shrink-0 items-center gap-2 border-b border-white/10 bg-ink-950/70 px-2 py-1.5 backdrop-blur sm:gap-3 sm:px-3 sm:py-2"
        style={{ paddingTop: 'max(0.375rem, env(safe-area-inset-top))' }}
      >
        {/* fixed square so the score block stays optically centred whichever
            label variant is showing (icon on phones, icon + text on desktop) */}
        <button
          onClick={onExit}
          aria-label="Leave match"
          className="btn btn-ghost h-9 w-9 shrink-0 !p-0 text-sm sm:h-8 sm:w-auto sm:!px-2"
        >
          ←<span className="ml-1 hidden text-xs sm:inline">Leave</span>
        </button>
        <div className="flex flex-1 items-center justify-center gap-3">
          <ScoreBlock team="A" score={score.A} active={goalFlash?.team === 'A'} />
          <div className="text-center">
            <div className="font-mono text-sm font-black tabular-nums text-slate-200">{clock}</div>
            <div className="text-[9px] uppercase tracking-widest text-slate-500">
              {phase === 'waiting' ? 'Lobby' : phase === 'countdown' ? 'Kickoff' : phase === 'ended' ? 'Final' : `First to ${view?.goalsToWin ?? MATCH.goalsToWin}`}
            </div>
          </div>
          <ScoreBlock team="B" score={score.B} active={goalFlash?.team === 'B'} />
        </div>
        <button
          onClick={() => setHelpOpen(true)}
          aria-label="How to play"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/15 bg-white/5 text-[11px] font-black text-slate-300 transition hover:bg-white/10 active:scale-95"
        >
          ?
        </button>
        <div className="flex items-center gap-2 text-[10px] text-slate-400">
          <span
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 ${
              connected ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/20 text-rose-300'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            {connected ? `${latency || 35}ms` : 'Reconnecting'}
          </span>
        </div>
      </header>

      {/* ------------------------------------------------------------- table */}
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-start overflow-hidden p-1 sm:justify-center sm:p-3">
        <div className="absolute inset-0 bg-[radial-gradient(900px_500px_at_50%_20%,rgba(23,185,120,0.10),transparent_70%)]" />
        {/* the renderer letterboxes to the table's own shape, so the canvas can
            take all the height on offer without ever distorting the pitch */}
        <div className="relative min-h-0 w-full max-w-[1200px] flex-1">

          <FoosballTable
            frameRef={frameRef}
            skin={skin}
            ballSkin={ballSkin}
            onDrag={onDrag}
            onFlick={onFlick}
            interactive={mySlot !== null && !endInfo}
            getOverlay={getOverlay}
          />
        </div>

        {/* floating chat toasts */}
        <div className="pointer-events-none absolute left-2 top-2 flex w-56 flex-col gap-1">
          <AnimatePresence>
            {chatLog.map((c, i) => (
              <motion.div
                key={c.at + i}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="rounded-lg bg-black/55 px-2 py-1 text-[11px] font-semibold text-slate-200 backdrop-blur"
              >
                {c.text}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* goal flash */}
        <AnimatePresence>
          {goalFlash && (
            <motion.div
              key={goalFlash.id}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.1 }}
              className="pointer-events-none absolute inset-0 grid place-items-center"
            >
              <div className="text-center">
                <div
                  className="text-6xl font-black tracking-tight drop-shadow-[0_10px_30px_rgba(0,0,0,0.7)] sm:text-8xl"
                  style={{
                    color: goalFlash.team === 'A' ? '#60a5fa' : '#fb7185',
                    WebkitTextStroke: '2px rgba(0,0,0,0.35)',
                  }}
                >
                  GOAL!
                </div>
                <div className="text-sm font-bold uppercase tracking-[0.3em] text-white/70">
                  Team {goalFlash.team} scores
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* countdown */}
        <AnimatePresence>
          {countdown > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none absolute inset-0 grid place-items-center bg-black/40 backdrop-blur-[2px]"
            >
              <motion.div
                key={countdown}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-7xl font-black text-emerald-300 drop-shadow-[0_0_40px_rgba(23,185,120,0.7)]"
              >
                {countdown}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* first-match control hint */}
        <AnimatePresence>
          {showHint && live && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="pointer-events-none absolute inset-x-2 bottom-2 z-10 mx-auto max-w-md rounded-lg border border-white/15 bg-black/75 px-3 py-1.5 text-center backdrop-blur"
            >
              <div className="text-[10px] font-bold leading-tight text-slate-200">
                <span className="sm:hidden">Drag the table to move · swipe fast or tap Kick to shoot</span>
                <span className="hidden sm:inline">A / D slide · W and S kick · drag the table with the mouse</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* always-available controls reference (the "?" in the HUD) */}
        <AnimatePresence>
          {helpOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-30 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
              onClick={() => setHelpOpen(false)}
            >
              <motion.div
                initial={{ scale: 0.94, y: 10 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.96, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                className="glass w-full max-w-sm rounded-2xl p-4 text-left"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm font-black uppercase tracking-widest text-emerald-400">How to play</div>
                  <button
                    onClick={() => setHelpOpen(false)}
                    aria-label="Close help"
                    className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-slate-300 hover:bg-white/20"
                  >
                    ✕
                  </button>
                </div>

                <div className="mt-3 space-y-2.5 text-[11px] leading-relaxed text-slate-300">
                  <div className="flex gap-2">
                    <span className="mt-0.5 text-emerald-400">▸</span>
                    <span>
                      <b className="text-slate-100">Move your rods</b> — drag anywhere on the table, or hold the
                      ◀ ▶ buttons. On a keyboard use <Key>A</Key> / <Key>D</Key>.
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <span className="mt-0.5 text-emerald-400">▸</span>
                    <span>
                      <b className="text-slate-100">Shoot</b> — flick sideways across the table, or tap
                      <b className="text-blue-300"> Kick back</b> (GK/DEF) and <b className="text-emerald-300">Kick front</b>{' '}
                      (MID/ATK). Keys <Key>W</Key> and <Key>S</Key>/<Key>Space</Key>.
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <span className="mt-0.5 text-emerald-400">▸</span>
                    <span>
                      <b className="text-slate-100">Power</b> comes from how hard the rod swings — a fast flick hits
                      harder than a gentle tap.
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <span className="mt-0.5 text-emerald-400">▸</span>
                    <span>
                      <b className="text-slate-100">Win</b> by being first to {view?.goalsToWin ?? MATCH.goalsToWin} goals,
                      or leading when the clock runs out.
                    </span>
                  </div>
                </div>

                {solo && (
                  <div className="mt-3 rounded-lg bg-amber-400/10 px-2.5 py-2 text-[10px] text-amber-200/90">
                    Solo drill: the pad and table drive your GK/DEF pair; the keyboard still drives all four rods.
                  </div>
                )}

                <button onClick={() => setHelpOpen(false)} className="btn btn-primary mt-4 w-full py-2 text-xs">
                  Got it
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* private-room lobby / waiting panel */}
        {phase === 'waiting' && view && view.mode === 'private' && (
          <LobbyPanel view={view} mySlot={mySlot} onExit={onExit} />
        )}
        {phase === 'waiting' && view && view.mode !== 'private' && (
          <div className="absolute inset-0 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="glass w-full max-w-md rounded-2xl p-5 text-center">
              <div className="mb-1 text-lg font-black">Match starting</div>
              <div className="mb-4 text-xs text-slate-400">
                {view.mode === 'practice' ? 'Warming up the bots…' : 'Locking in teams…'}
              </div>
              <div className="grid grid-cols-2 gap-3 text-left">
                {playerRow('A')}
                {playerRow('B')}
              </div>
              <div className="mt-4 flex justify-center gap-2">
                <Spinner />
                <span className="text-xs text-slate-400">Syncing with server…</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------ footer */}
      <footer
        className="z-20 flex shrink-0 flex-col items-stretch gap-1.5 border-t border-white/10 bg-ink-950/70 px-2 py-1.5 backdrop-blur sm:flex-row sm:items-stretch sm:gap-2 sm:px-4 sm:py-2"
        style={{ paddingBottom: 'max(0.375rem, env(safe-area-inset-bottom))' }}
      >
        <div className="hidden flex-1 gap-3 sm:flex">
          {playerRow('A')}
        </div>
        {/* phone: one compact strip naming who you are and who you're facing */}
        <div className="flex items-center gap-2 sm:hidden">
          {playerRow('A', true)}
          <span className="shrink-0 text-[9px] font-black text-slate-600">VS</span>
          {playerRow('B', true)}
        </div>

        {/* controls */}
        <div className="flex flex-col items-center gap-1.5">
          {solo ? (
            <div className="hidden gap-1.5 sm:flex">
              {SOLO_LABELS.map((l) => (
                <div key={l.seat} className="rounded-lg bg-white/5 px-2 py-1 text-[9px] leading-tight text-slate-300">
                  <div className="font-bold text-slate-200">{l.seat}</div>
                  <div className="text-slate-400">
                    {l.slide} · {l.rear} back · {l.front} front
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {solo && (
            <div className="text-[10px] text-slate-500 sm:hidden">
              Solo drill: the pad drives your GK/DEF pair · keyboard drives all four
            </div>
          )}
        </div>
        <div className="mt-auto flex w-full flex-col items-center gap-1">
          <div className="flex w-full max-w-lg items-stretch justify-center gap-1.5">
            <TouchButton
              label="◀"
              onDown={() => slideDown(-1)}
              onUp={() => slideUp()}
              wide
            />
            <div className="flex flex-1 gap-1.5">
              <TouchButton
                label="Kick back"
                hint="GK/DEF"
                accent="blue"
                grow
                onDown={() => kick('rear', true)}
                onUp={() => kick('rear', false)}
              />
              <TouchButton
                label="Kick front"
                hint="MID/ATK"
                accent="emerald"
                grow
                onDown={() => kick('front', true)}
                onUp={() => kick('front', false)}
              />
            </div>
            <TouchButton
              label="▶"
              onDown={() => slideDown(1)}
              onUp={() => slideUp()}
              wide
            />
          </div>
          <div className="hidden text-[10px] text-slate-500 sm:block">
            A / D slide · W kick back · S or Space kick front · drag the table on touch
          </div>
        </div>

        <div className="hidden flex-1 sm:flex">
          {playerRow('B')}
        </div>

        <div className="hidden items-center gap-1 self-center sm:flex">
          <button
            className={`btn btn-ghost h-9 px-2 text-xs ${showChat ? '!bg-emerald-500/25' : ''}`}
            onClick={() => setShowChat((v) => !v)}
          >
            💬
          </button>
        </div>
      </footer>

      {/* chat drawer */}
      <AnimatePresence>
        {showChat && (
          <motion.aside
            initial={{ x: 320, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 320, opacity: 0 }}
            className="glass fixed bottom-0 right-0 top-0 z-40 flex w-[min(320px,88vw)] flex-col border-l"
          >
            <div className="flex items-center justify-between border-b border-white/10 p-3">
              <div className="font-black">Match chat</div>
              <button className="btn btn-ghost h-8 w-8 !p-0" onClick={() => setShowChat(false)}>
                ×
              </button>
            </div>
            <div className="scroll-thin flex-1 space-y-2 overflow-y-auto p-3 text-sm">
              {chat.length === 0 && <div className="text-xs text-slate-500">Say hi to your team 👋</div>}
              {chat.map((m) => (
                <div key={m.id} className={m.userId === profile?.user.id ? 'text-right' : ''}>
                  <div className="text-[10px] text-slate-500">{m.username}</div>
                  <div
                    className={`inline-block max-w-[85%] rounded-xl px-2.5 py-1.5 ${
                      m.userId === profile?.user.id
                        ? 'bg-emerald-500/25 text-emerald-100'
                        : 'bg-white/10 text-slate-100'
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-1 border-t border-white/10 p-2">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  className="rounded-lg bg-white/5 px-2 py-1 text-lg hover:bg-white/15"
                  onClick={() => session.sendChat(e, true)}
                >
                  {e}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1 px-2 pb-1">
              {QUICK_CHAT.slice(0, 4).map((q) => (
                <button
                  key={q}
                  className="rounded-full bg-white/5 px-2 py-1 text-[11px] font-semibold hover:bg-white/15"
                  onClick={() => session.sendChat(q)}
                >
                  {q}
                </button>
              ))}
            </div>
            <form
              className="flex gap-2 border-t border-white/10 p-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!draft.trim()) return;
                session.sendChat(draft.trim());
                setDraft('');
              }}
            >
              <input
                className="input !py-2 text-sm"
                placeholder="Message…"
                value={draft}
                maxLength={120}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button className="btn btn-primary px-3" type="submit">
                ↑
              </button>
            </form>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* --------------------------------------------------- end of match */}
      <AnimatePresence>
        {endInfo && (
          <MatchResultOverlay
            endInfo={endInfo}
            view={view}
            mySlot={mySlot}
            myUserId={profile?.user.id}
            onExit={onExit}
            onRematch={rematch}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function ScoreBlock({ team, score, active }: { team: 'A' | 'B'; score: number; active: boolean }) {
  return (
    <div
      className={`grid h-11 w-11 place-items-center rounded-xl text-2xl font-black transition ${
        active ? 'scale-110' : ''
      }`}
      style={{
        background: team === 'A' ? 'rgba(59,130,246,0.18)' : 'rgba(239,68,68,0.18)',
        color: team === 'A' ? '#93c5fd' : '#fda4af',
        boxShadow: active ? `0 0 30px ${team === 'A' ? 'rgba(59,130,246,.6)' : 'rgba(239,68,68,.6)'}` : 'none',
      }}
    >
      {score}
    </div>
  );
}

/** A short vibrate on press makes the touch controls feel physical on phones. */
function haptic(ms = 8) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
}

function TouchButton({
  label,
  hint,
  onDown,
  onUp,
  accent = 'slate',
  wide,
  grow,
}: {
  label: string;
  hint?: string;
  onDown: () => void;
  onUp: () => void;
  accent?: 'slate' | 'blue' | 'emerald';
  wide?: boolean;
  grow?: boolean;
}) {
  const bg =
    accent === 'blue'
      ? 'bg-blue-500/25 text-blue-100 border-blue-400/40 active:bg-blue-500/45'
      : accent === 'emerald'
      ? 'bg-emerald-500/25 text-emerald-100 border-emerald-400/40 active:bg-emerald-500/45'
      : 'bg-white/8 text-slate-200 border-white/15 active:bg-white/20';
  return (
    <button
      className={`no-select flex flex-col items-center justify-center rounded-xl border ${bg} ${
        wide ? 'h-16 w-16 shrink-0 text-2xl sm:h-14 sm:w-14 sm:text-xl' : 'h-16 px-4 text-xs sm:h-14'
      } ${grow ? 'flex-1' : ''} font-black transition-transform active:scale-[0.97]`}
      onPointerDown={(e) => {
        e.preventDefault();
        // capture so a thumb sliding off the button still releases it; synthetic
        // or already-cancelled pointers reject capture, which must not throw
        try {
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        } catch {
          /* pointer not capturable — onPointerLeave/Cancel still release */
        }
        haptic(accent === 'slate' ? 6 : 12);
        sfx.click();
        onDown();
      }}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      onPointerCancel={onUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="block leading-tight">{label}</span>
      {hint && <span className="block text-[9px] font-semibold opacity-60">{hint}</span>}
    </button>
  );
}

function MatchResultOverlay({
  endInfo,
  view,
  mySlot,
  myUserId,
  onExit,
  onRematch,
}: {
  endInfo: NonNullable<ReturnType<typeof useMatchSession>['endInfo']>;
  view: ReturnType<typeof useMatchSession>['view'];
  mySlot: number | null;
  myUserId?: string;
  onExit: () => void;
  onRematch: () => void;
}) {
  const myTeam = mySlot === null ? null : mySlot < 2 ? 'A' : 'B';
  const won = myTeam !== null && endInfo.winner === myTeam;
  const draw = endInfo.winner === null;
  const mine = endInfo.results?.results?.find((r: any) => r.userId === myUserId);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur"
    >
      <motion.div
        initial={{ y: 30, scale: 0.96 }}
        animate={{ y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
        className="glass w-full max-w-lg rounded-2xl p-5 text-center"
      >
        <div
          className="text-4xl font-black"
          style={{ color: draw ? '#cbd5e1' : won ? '#34d399' : '#fb7185' }}
        >
          {draw ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT'}
        </div>
        <div className="mt-1 text-xs uppercase tracking-[0.25em] text-slate-400">
          {endInfo.reason === 'abandon' ? 'Opponent disconnected' : endInfo.reason === 'time' ? 'Time up' : 'Match complete'}
        </div>

        <div className="mt-4 flex items-center justify-center gap-6">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-blue-400">Team A</div>
            <div className="text-5xl font-black text-blue-300">{endInfo.score.A}</div>
          </div>
          <div className="text-2xl text-slate-600">:</div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-rose-400">Team B</div>
            <div className="text-5xl font-black text-rose-300">{endInfo.score.B}</div>
          </div>
        </div>

        {mine?.rating && (
          <div className="mt-4 flex items-center justify-center gap-3 text-sm">
            <span className="text-slate-400">Rating</span>
            <span className="font-mono font-bold">{mine.rating.before}</span>
            <span className="text-slate-500">→</span>
            <span className="font-mono font-black text-emerald-300">{mine.rating.after}</span>
            <span
              className={`chip ${mine.rating.delta >= 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}
            >
              {mine.rating.delta >= 0 ? '+' : ''}
              {mine.rating.delta}
            </span>
          </div>
        )}
        {mine && (
          <div className="mt-2 flex justify-center gap-2 text-[11px] text-slate-400">
            <span className="chip bg-white/5">+{mine.xp} XP</span>
            <span className="chip bg-amber-400/15 text-amber-300">+{mine.coins} coins</span>
          </div>
        )}
        {!mine && view?.mode === 'practice' && (
          <div className="mt-2 text-[11px] text-slate-500">Practice match — unrated, no rewards at stake.</div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2 text-left text-xs">
          {[...(view?.teamA ?? []), ...(view?.teamB ?? [])].map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-lg bg-white/5 p-2">
              <Avatar emoji={p.avatar} size={22} />
              <div className="min-w-0">
                <div className="truncate font-bold">{p.username}</div>
                <div className="text-[10px] text-slate-400">
                  Team {p.team} · {p.rating}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex gap-2">
          <Link to="/" className="btn btn-ghost flex-1 py-2.5" onClick={onExit}>
            Dashboard
          </Link>
          <button className="btn btn-primary flex-1 py-2.5" onClick={onRematch}>
            Rematch
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mx-0.5 inline-block min-w-[1.4em] rounded border border-white/25 bg-white/10 px-1 text-center font-mono text-[10px] font-bold text-slate-100">
      {children}
    </kbd>
  );
}
