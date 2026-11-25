/**
 * Client match session.
 *
 *  - subscribes to server snapshots (30 Hz) + events
 *  - interpolates the ball / remote rods between the last two snapshots
 *  - *predicts the local player's own rods* with the shared simulation code so
 *    controls feel instant regardless of ping
 *  - streams validated input packets at 40 Hz
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { getSocket, request } from '../lib/socket';
import { createRodState, slotRodRoles, stepRodControl, type RodState } from '../../shared/engine/physics';
import { MATCH, ROD_SPECS, type Team } from '../../shared/engine/constants';
import type { ChatMessage, MatchView } from '../../shared/types';
import { audio, setCrowd, unlockAudio } from '../lib/audio';
import { useApp } from '../lib/store';

export interface Snap {
  tick: number;
  phase: string;
  score: { A: number; B: number };
  timeLeft: number;
  kickoffLeft: number;
  ball: [number, number, number, number];
  rods: [number, number][];
  lastTouch: { team: Team | null; slot: number | null };
  recvAt: number;
}

export interface GoalFlash {
  team: Team;
  at: number;
  id: number;
}

export interface MatchSession {
  view: MatchView | null;
  ready: boolean;
  mySlot: number | null;
  chat: ChatMessage[];
  goalFlash: GoalFlash | null;
  endInfo: { winner: Team | null; score: { A: number; B: number }; reason: string; durationSec: number; results: any } | null;
  countdown: number;
  connected: boolean;
  latency: number;
  sendChat: (text: string, emoji?: boolean) => void;
  leave: () => void;
  /** live numbers for the renderer, refreshed every frame via the provided ref */
  frameRef: React.MutableRefObject<FrameData>;
  inputRef: React.MutableRefObject<{ slide: number; rear: number; front: number }>;
}

export interface FrameData {
  /** solo drill: every rod is locally controllable */
  allRods: boolean;
  rods: Array<{ slide: number; angle: number }>;
  ball: { x: number; z: number; lift: number; vx: number; vz: number };
  score: { A: number; B: number };
  timeLeft: number;
  kickoffLeft: number;
  phase: string;
  lastTouch: { team: Team | null; slot: number | null };
  highlightRods: number[];
  mySlot: number | null;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function useMatchSession(matchId: string | null, opts: { spectate?: boolean } = {}): MatchSession {
  const soundOn = useApp((s) => s.soundOn);
  const [view, setView] = useState<MatchView | null>(null);
  const [ready, setReady] = useState(false);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [goalFlash, setGoalFlash] = useState<GoalFlash | null>(null);
  const [endInfo, setEndInfo] = useState<MatchSession['endInfo']>(null);
  const [countdown, setCountdown] = useState(0);
  const [connected, setConnected] = useState(true);
  const [latency, setLatency] = useState(0);
  const [mySlot, setMySlot] = useState<number | null>(null);
  const [solo, setSolo] = useState(false);

  const viewRef = useRef<MatchView | null>(null);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const prevSnap = useRef<Snap | null>(null);
  const curSnap = useRef<Snap | null>(null);
  const myRods = useRef<Record<number, RodState>>({});
  const inputRef = useRef<any>({ slide: 0, rear: 0, front: 0, allRods: {} });
  const frameRef = useRef<FrameData>({
    allRods: false,
    rods: ROD_SPECS.map(() => ({ slide: 0, angle: 0 })),
    ball: { x: 0, z: 0, lift: 0, vx: 0, vz: 0 },
    score: { A: 0, B: 0 },
    timeLeft: MATCH.defaultTimeLimitSec,
    kickoffLeft: 0,
    phase: 'waiting',
    lastTouch: { team: null, slot: null },
    highlightRods: [],
    mySlot: null,
  });

  const roles = useMemo(() => (mySlot === null ? null : slotRodRoles(mySlot)), [mySlot]);
  const myRodIndexes = useMemo(() => {
    if (solo) return ROD_SPECS.map((_, i) => i);
    if (!roles) return [] as number[];
    return [roles.rear, roles.front]
      .filter(Boolean)
      .map((id) => ROD_SPECS.findIndex((r) => r.id === id))
      .filter((i) => i >= 0);
  }, [roles, solo]);

  // ------------------------------------------------------------- socket wiring
  useEffect(() => {
    if (!matchId) return;
    const socket = getSocket();

    const join = () => {
      request<any>(opts.spectate ? 'match:spectate' : 'match:join', { matchId })
        .then((res) => {
          if (!res?.ok) return;
          setView(res.view);
          setMySlot(res.seat ?? null);
          setSolo(!!res.solo);
          if (res.snapshot) {
            const s: Snap = { ...res.snapshot, recvAt: performance.now() };
            prevSnap.current = s;
            curSnap.current = s;
          }
          if (res.chat) setChat(res.chat.map((c: any) => ({ ...c, at: Date.parse(c.created_at) })));
          setReady(true);
        })
        .catch(() => setReady(true));
    };

    join();
    socket.on('connect', () => {
      setConnected(true);
      join();
    });
    socket.on('disconnect', () => setConnected(false));

    const onState = (p: { matchId: string; snapshot: Snap; view: MatchView }) => {
      if (p.matchId !== matchId) return;
      prevSnap.current = curSnap.current;
      curSnap.current = { ...p.snapshot, recvAt: performance.now() };
      setView(p.view);
      if (p.snapshot.tick % 8 === 0) {
        const srv = performance.now();
        setLatency((prev) => Math.round(prev * 0.8 + (srv - p.snapshot.recvAt) * 0.2) || prev);
      }
    };

    const onEvent = (p: { matchId: string; event: any }) => {
      if (p.matchId !== matchId) return;
      const ev = p.event;
      // pan by the x position of the impact so hits from the left rail come
      // from the left speaker — the table sits in front of you
      const panFor = (x: number | undefined) =>
        typeof x === 'number' ? Math.max(-0.8, Math.min(0.8, x / 60)) : 0;
      if (ev.type === 'goal') {
        setGoalFlash({ team: ev.team, at: performance.now(), id: Math.random() });
        if (soundOn) {
          audio.goalNet();
          audio.goalCheer();
          audio.whistle(false);
        }
      } else if (ev.type === 'kick' && soundOn) {
        audio.kick(ev.power ?? 0.5, panFor(ev.x));
      } else if (ev.type === 'wall' && soundOn) {
        audio.wall(ev.power ?? 0.5, panFor(ev.x));
      } else if (ev.type === 'serve' && soundOn) {
        audio.serve();
      } else if (ev.type === 'end' && soundOn) {
        audio.whistle(true);
      }
    };

    const onEnd = (p: any) => {
      if (p.matchId !== matchId) return;
      setEndInfo({
        winner: p.winner,
        score: p.score,
        reason: p.reason,
        durationSec: p.durationSec,
        results: p.results,
      });
      setView(p.view);
      if (soundOn) {
        const mine = mySlot !== null && (mySlot < 2 ? 'A' : 'B');
        setTimeout(() => (p.winner === mine ? audio.victory() : audio.defeat()), 350);
      }
    };
    const onChat = (m: ChatMessage) => {
      setChat((c) => [...c.slice(-49), m]);
      if (soundOn) audio.click();
    };
    const onCountdown = (p: any) => {
      if (p.matchId !== matchId) return;
      if (soundOn) audio.whistle(false);
      setView(p.view);
      const start = performance.now();
      const total = p.countdownMs ?? 3500;
      const iv = setInterval(() => {
        const left = Math.max(0, total - (performance.now() - start));
        setCountdown(Math.ceil(left / 1000));
        if (left <= 0) clearInterval(iv);
      }, 100);
    };
    const onLive = (p: any) => {
      if (p.matchId !== matchId) return;
      setView(p.view);
      setCountdown(0);
    };

    // crowd ambience follows the match: calm while it plays, tense when the
    // score is level or a side is one goal from winning
    const crowdTimer = setInterval(() => {
      const snap = curSnap.current;
      const v = viewRef.current;
      if (!snap || !v) return;
      if (snap.phase !== 'live' && snap.phase !== 'countdown') return;
      const target = v.goalsToWin || MATCH.goalsToWin;
      const margin = Math.abs(snap.score.A - snap.score.B);
      const nearWin = Math.max(snap.score.A, snap.score.B) >= target - 1;
      const tense = margin <= 1 || nearWin || snap.timeLeft < 30;
      const closeness = Math.max(0, 1 - margin / 4);
      void setCrowd(tense ? 'tense' : 'calm', 0.45 + closeness * 0.5);
    }, 1500);

    const stopCrowd = () => void setCrowd('off');
    const onRoomUpdate = (p: any) => setView(p.view);
    const onConnection = (p: any) => {
      if (p.matchId !== matchId) return;
      setView((v) =>
        v
          ? {
              ...v,
              teamA: v.teamA.map((pl) => (pl.userId === p.userId ? { ...pl, online: p.online } : pl)),
              teamB: v.teamB.map((pl) => (pl.userId === p.userId ? { ...pl, online: p.online } : pl)),
            }
          : v
      );
    };

    socket.on('match:state', onState);
    socket.on('match:event', onEvent);
    socket.on('match:end', onEnd);
    socket.on('match:chat', onChat);
    socket.on('match:countdown', onCountdown);
    socket.on('match:live', onLive);
    socket.on('room:update', onRoomUpdate);
    socket.on('match:connection', onConnection);

    return () => {
      socket.emit('match:leave', { matchId });
      socket.off('match:state', onState);
      socket.off('match:event', onEvent);
      socket.off('match:end', onEnd);
      socket.off('match:chat', onChat);
      socket.off('match:countdown', onCountdown);
      socket.off('match:live', onLive);
      socket.off('room:update', onRoomUpdate);
      socket.off('match:connection', onConnection);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, opts.spectate]);

  // clear goal flash
  useEffect(() => {
    if (!goalFlash) return;
    const t = setTimeout(() => setGoalFlash(null), 2200);
    return () => clearTimeout(t);
  }, [goalFlash]);

  // --------------------------------------------------------- predict own rods
  useEffect(() => {
    if (mySlot === null) return;
    const owned: Record<number, RodState> = {};
    for (const idx of myRodIndexes) owned[idx] = createRodState(ROD_SPECS[idx]);
    myRods.current = owned;
  }, [mySlot, myRodIndexes]);

  // ------------------------------------------------------- render + input loop
  useEffect(() => {
    if (!matchId) return;
    let raf = 0;
    let lastFrame = performance.now();
    let predAcc = 0;
    let lastSend = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dtMs = Math.min(64, now - lastFrame);
      lastFrame = now;

      const a = prevSnap.current;
      const b = curSnap.current;
      const scoreFallback = view?.score ?? { A: 0, B: 0 };

      if (!b) {
        frameRef.current = {
          ...frameRef.current,
          allRods: solo,
          score: scoreFallback,
          mySlot,
          highlightRods: myRodIndexes,
        };
        return;
      }

      // interpolation factor across the snapshot interval
      const interval = Math.max(33, (b.recvAt ?? now) - (a?.recvAt ?? now - 33));
      const alpha = Math.min(1.35, (now - b.recvAt) / interval);
      const t = Math.min(1, alpha);

      // ---- ball ----
      const b0 = a?.ball ?? b.ball;
      const ball = b.ball;
      const ballX = lerp(b0[0], ball[0], t) + lerp(b0[2], ball[2], t) * 0.012;
      const ballZ = lerp(b0[1], ball[1], t) + lerp(b0[3], ball[3], t) * 0.012;
      const speed = Math.hypot(ball[2], ball[3]);

      // ---- rods ----
      const rods = ROD_SPECS.map((_, i) => {
        const mine = myRodIndexes.includes(i);
        const from = a?.rods?.[i] ?? b.rods[i];
        const to = b.rods[i];
        if (mine) {
          const local = myRods.current[i];
          // reconcile gently unless we've drifted badly
          if (local) {
            const driftSlide = Math.abs(local.slide - to[0]);
            const driftAngle = Math.abs(local.angle - to[1]);
            if (driftSlide > 7 || driftAngle > 0.75) {
              local.slide = to[0];
              local.angle = to[1];
              local.slideVel = 0;
              local.angleVel = 0;
            }
            return { slide: local.slide, angle: local.angle };
          }
        }
        return { slide: lerp(from[0], to[0], t), angle: lerp(from[1], to[1], t) };
      });

      // ---- predict own rods with the shared integrator ----
      if (myRodIndexes.length) {
        predAcc += dtMs;
        const stepMs = 1000 / MATCH.tickRate;
        let guard = 0;
        while (predAcc >= stepMs && guard++ < 8) {
          predAcc -= stepMs;
            for (const idx of myRodIndexes) {
            const rod = myRods.current[idx];
            if (!rod) continue;
            const spec = ROD_SPECS[idx];
            let slideIn = inputRef.current.slide;
            let rotIn: number;
            if (solo) {
              const pkt = (inputRef.current.allRods ?? {})[spec.slotIndex] ?? { slide: 0, rear: 0, front: 0 };
              const seatRoles = slotRodRoles(spec.slotIndex);
              slideIn = pkt.slide ?? 0;
              rotIn = seatRoles.rear === spec.id ? pkt.rear ?? 0 : pkt.front ?? 0;
            } else {
              const isRear = roles?.rear === spec.id;
              rotIn = isRear ? inputRef.current.rear : inputRef.current.front;
            }
            stepRodControl(rod, slideIn, rotIn, spec.team === 'A' ? 1 : -1, true, MATCH.dt);
          }
        }
        for (const idx of myRodIndexes) {
          const rod = myRods.current[idx];
          if (rod) rods[idx] = { slide: rod.slide, angle: rod.angle };
        }
      }

      // send inputs at 40 Hz
      if (now - lastSend > 25 && !opts.spectate) {
        lastSend = now;
        getSocket().emit('match:input', {
          matchId,
          slide: inputRef.current.slide,
          rear: inputRef.current.rear,
          front: inputRef.current.front,
          allRods: solo ? inputRef.current.allRods : undefined,
        });
      }

      frameRef.current = {
        allRods: solo,
        rods,
        ball: { x: ballX, z: ballZ, lift: Math.min(2.6, speed / 40), vx: ball[2], vz: ball[3] },
        score: b.score ?? scoreFallback,
        timeLeft: b.timeLeft,
        kickoffLeft: b.kickoffLeft,
        phase: b.phase,
        lastTouch: b.lastTouch,
        highlightRods: myRodIndexes,
        mySlot,
      };
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [matchId, mySlot, myRodIndexes, roles, view?.score, opts.spectate, solo]);

  const sendChat = (text: string, emoji = false) => {
    if (!matchId) return;
    getSocket().emit('match:chat', { matchId, text, emoji });
  };
  const leave = () => {
    if (matchId) getSocket().emit('match:leave', { matchId });
  };

  return {
    view,
    ready,
    mySlot,
    chat,
    goalFlash,
    endInfo,
    countdown,
    connected,
    latency,
    sendChat,
    leave,
    frameRef,
    inputRef,
  };
}
