/**
 * Audio engine.
 *
 * Loads the baked WAV assets from /sounds and plays them through a small
 * WebAudio mixer:
 *
 *    samples ─┬─> sfx bus ──┐
 *             └─> ui bus  ──┼─> compressor/limiter ─> master gain ─> out
 *    crowd loop ─> crowd bus┘
 *
 * Design notes:
 *  - Every play gets a slightly randomised rate so repeated hits don't sound
 *    like a machine gun (a real table never sounds the same twice).
 *  - Sample pools: N voices per sample, round-robined, so overlapping hits can
 *    ring out instead of cutting each other off.
 *  - Nothing is fetched until the first sound is needed, and the whole thing
 *    no-ops gracefully if decoding fails (SSR, blocked autoplay, sandbox).
 *  - iOS/Safari require a user gesture to start audio: `unlock()` is bound to
 *    the first pointer/key event.
 */
import { storage } from './safeStorage';

type SampleName =
  | 'ball-soft' | 'ball-medium' | 'ball-hard'
  | 'wall-soft' | 'wall-hard'
  | 'rod-clack' | 'goal-net' | 'serve'
  | 'crowd-loop' | 'crowd-tense' | 'crowd-cheer'
  | 'whistle-short' | 'whistle-long'
  | 'countdown' | 'kickoff-beep'
  | 'ui-click' | 'ui-hover' | 'ui-success'
  | 'coin' | 'victory' | 'defeat';

const ALL: SampleName[] = [
  'ball-soft', 'ball-medium', 'ball-hard', 'wall-soft', 'wall-hard',
  'rod-clack', 'goal-net', 'serve', 'crowd-loop', 'crowd-tense', 'crowd-cheer',
  'whistle-short', 'whistle-long', 'countdown', 'kickoff-beep',
  'ui-click', 'ui-hover', 'ui-success', 'coin', 'victory', 'defeat',
];

/** critical samples: loaded up-front so a match never starts silent */
const CORE: SampleName[] = ['ball-medium', 'ball-hard', 'wall-hard', 'goal-net', 'whistle-short'];

const VOICES = 4;

interface Mixer {
  ctx: AudioContext;
  master: GainNode;
  sfx: GainNode;
  ui: GainNode;
  crowd: GainNode;
  buffers: Map<SampleName, AudioBuffer>;
  cursors: Map<SampleName, number>;
}

let mixer: Mixer | null = null;
let sfxVolume = 0.8;
let musicVolume = 0.5;
let enabled = true;
let unlocking = false;
let preloaded = false;

const CROWD_MIN = 0.05;

function readSettings() {
  const s = storage.get('tsa.audio');
  if (s) {
    try {
      const p = JSON.parse(s);
      if (typeof p.sfx === 'number') sfxVolume = p.sfx;
      if (typeof p.music === 'number') musicVolume = p.music;
      if (typeof p.enabled === 'boolean') enabled = p.enabled;
    } catch {
      /* keep defaults */
    }
  }
}
readSettings();

export function getVolumes() {
  return { sfx: sfxVolume, music: musicVolume, enabled };
}

export function setVolumes(v: { sfx?: number; music?: number; enabled?: boolean }) {
  if (typeof v.sfx === 'number') sfxVolume = Math.max(0, Math.min(1, v.sfx));
  if (typeof v.music === 'number') musicVolume = Math.max(0, Math.min(1, v.music));
  if (typeof v.enabled === 'boolean') enabled = v.enabled;
  storage.set('tsa.audio', JSON.stringify({ sfx: sfxVolume, music: musicVolume, enabled }));
  if (mixer) {
    mixer.master.gain.setTargetAtTime(enabled ? 1 : 0, mixer.ctx.currentTime, 0.05);
    mixer.sfx.gain.setTargetAtTime(sfxVolume, mixer.ctx.currentTime, 0.05);
    mixer.crowd.gain.setTargetAtTime(sfxVolume * musicVolume * 0.9, mixer.ctx.currentTime, 0.08);
  }
}

function build(): Mixer | null {
  if (mixer) return mixer;
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  let ctx: AudioContext;
  try {
    ctx = new Ctor({ latencyHint: 'interactive' });
  } catch {
    return null;
  }

  const master = ctx.createGain();
  master.gain.value = enabled ? 1 : 0;

  // A gentle limiter keeps a goal + cheer + whistle stack from clipping.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.knee.value = 18;
  comp.ratio.value = 6;
  comp.attack.value = 0.004;
  comp.release.value = 0.22;

  const sfx = ctx.createGain();
  sfx.gain.value = sfxVolume;
  const ui = ctx.createGain();
  ui.gain.value = sfxVolume * 0.9;
  const crowdBus = ctx.createGain();
  crowdBus.gain.value = sfxVolume * musicVolume * 0.9;

  // subtle room: short convolver-ish delay gives the table some space
  const send = ctx.createGain();
  send.gain.value = 0.16;
  const delay = ctx.createDelay(0.5);
  delay.delayTime.value = 0.11;
  const fb = ctx.createGain();
  fb.gain.value = 0.22;
  const damp = ctx.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 2600;
  sfx.connect(comp);
  ui.connect(comp);
  crowdBus.connect(comp);
  sfx.connect(send).connect(delay).connect(damp).connect(fb).connect(delay);
  damp.connect(comp);
  comp.connect(master).connect(ctx.destination);

  mixer = {
    ctx, master, sfx, ui, crowd: crowdBus,
    buffers: new Map(), cursors: new Map(),
  };
  return mixer;
}

async function load(m: Mixer, name: SampleName) {
  if (m.buffers.has(name)) return m.buffers.get(name)!;
  try {
    const res = await fetch(`/sounds/${name}.wav`);
    if (!res.ok) return null;
    const raw = await res.arrayBuffer();
    const buf = await m.ctx.decodeAudioData(raw);
    m.buffers.set(name, buf);
    return buf;
  } catch {
    return null;
  }
}

/** Load the sounds a match needs. Safe to call repeatedly. */
export async function preloadSounds(extra: SampleName[] = []) {
  const m = build();
  if (!m || preloaded) return;
  preloaded = true;
  await Promise.all([...CORE, ...extra].map((n) => load(m, n)));
  // the rest in the background
  setTimeout(() => {
    ALL.forEach((n) => void load(m, n));
  }, 400);
}

/** Must be called from a user gesture for iOS/Safari. */
export function unlockAudio() {
  const m = build();
  if (!m || unlocking) return;
  unlocking = true;
  const resume = () => m.ctx.resume().catch(() => {});
  resume();
  void preloadSounds();
  const once = () => {
    resume();
    window.removeEventListener('pointerdown', once);
    window.removeEventListener('keydown', once);
    window.removeEventListener('touchend', once);
  };
  window.addEventListener('pointerdown', once, { passive: true });
  window.addEventListener('keydown', once);
  window.addEventListener('touchend', once, { passive: true });
}

interface PlayOpts {
  gain?: number;
  /** playback-rate range, randomised per call (pitch/speed variation) */
  rate?: [number, number];
  pan?: number;
  bus?: 'sfx' | 'ui';
  /** ignore the global mute (used by nothing yet, kept for previews) */
  force?: boolean;
}

function play(name: SampleName, opts: PlayOpts = {}) {
  const m = mixer;
  if (!m || (!enabled && !opts.force)) return;
  const buf = m.buffers.get(name);
  if (!buf) {
    // not loaded yet: kick off the load so the next one plays
    void load(m, name);
    return;
  }
  const ctx = m.ctx;
  const [lo, hi] = opts.rate ?? [0.94, 1.06];
  const idx = (m.cursors.get(name) ?? 0) % VOICES;
  m.cursors.set(name, idx + 1);

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = lo + Math.random() * (hi - lo);

  const g = ctx.createGain();
  g.gain.value = opts.gain ?? 1;

  let node: AudioNode = g;
  if (opts.pan !== undefined && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, opts.pan));
    g.connect(p);
    node = p;
  }

  src.connect(g);
  node.connect(opts.bus === 'ui' ? m.ui : m.sfx);
  src.start(ctx.currentTime + idx * 0.004);
}

/* ------------------------------------------------------------------ the API */

export const audio = {
  /** ball struck by a figure; power 0..1 */
  kick(power: number, pan = 0) {
    const name: SampleName = power > 0.62 ? 'ball-hard' : power > 0.28 ? 'ball-medium' : 'ball-soft';
    play(name, { gain: 0.5 + power * 0.5, rate: [0.92, 1.12], pan });
  },
  wall(power: number, pan = 0) {
    play(power > 0.5 ? 'wall-hard' : 'wall-soft', { gain: 0.45 + power * 0.5, pan, rate: [0.95, 1.08] });
  },
  rodClack() {
    play('rod-clack', { gain: 0.5, rate: [0.96, 1.05] });
  },
  serve() {
    play('serve', { gain: 0.6 });
  },
  /** ball crossing the line */
  goalNet() {
    play('goal-net', { gain: 0.9 });
  },
  goalCheer() {
    play('crowd-cheer', { gain: 1.0 });
    setTimeout(() => play('crowd-cheer', { gain: 0.3, rate: [0.9, 1.0] }), 260);
  },
  whistle(long = false) {
    play(long ? 'whistle-long' : 'whistle-short', { gain: 0.8, rate: [0.98, 1.02] });
  },
  countdown(n: number) {
    play(n > 0 ? 'countdown' : 'kickoff-beep', { gain: 0.55 });
  },
  victory() {
    play('victory', { gain: 0.95 });
  },
  defeat() {
    play('defeat', { gain: 0.8 });
  },
  coin() {
    play('coin', { gain: 0.7, bus: 'ui', rate: [0.98, 1.06] });
  },
  success() {
    play('ui-success', { gain: 0.7, bus: 'ui' });
  },
  click() {
    play('ui-click', { gain: 0.5, bus: 'ui', rate: [0.97, 1.05] });
  },
  hover() {
    play('ui-hover', { gain: 0.35, bus: 'ui' });
  },
};

/* ------------------------------------------------------------ crowd ambience */

let crowdNodes: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
let crowdState: 'off' | 'calm' | 'tense' = 'off';

/** Start / change the looping crowd bed. `intensity` 0..1 swells with danger. */
export async function setCrowd(state: 'off' | 'calm' | 'tense', intensity = 0.5) {
  const m = build();
  if (!m) return;
  if (state === 'off') {
    if (crowdNodes) {
      const { src, gain } = crowdNodes;
      crowdNodes = null;
      gain.gain.setTargetAtTime(0, m.ctx.currentTime, 0.35);
      setTimeout(() => {
        try {
          src.stop();
        } catch {
          /* already stopped */
        }
      }, 1200);
    }
    crowdState = 'off';
    return;
  }

  const want = state === 'tense' ? 'crowd-tense' : 'crowd-loop';
  if (crowdNodes && crowdState === state) {
    // just re-level
    const target = Math.max(CROWD_MIN, intensity) * 0.9;
    crowdNodes.gain.gain.setTargetAtTime(target, m.ctx.currentTime, 0.4);
    return;
  }

  if (crowdNodes) {
    const { src, gain } = crowdNodes;
    crowdNodes = null;
    gain.gain.setTargetAtTime(0, m.ctx.currentTime, 0.25);
    setTimeout(() => {
      try {
        src.stop();
      } catch {
        /* noop */
      }
    }, 900);
  }

  const buf = await load(m, want);
  if (!buf) return;
  const src = m.ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.loopStart = 0;
  src.loopEnd = buf.duration;
  const gain = m.ctx.createGain();
  gain.gain.value = 0;
  // gentle low-pass so the bed sits under the action
  const lp = m.ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = state === 'tense' ? 4200 : 3200;
  src.connect(lp).connect(gain).connect(m.crowd);
  src.start(m.ctx.currentTime, Math.random() * buf.duration);
  gain.gain.setTargetAtTime(Math.max(CROWD_MIN, intensity) * 0.9, m.ctx.currentTime, 0.6);
  crowdNodes = { src, gain };
  crowdState = state;
}

export function stopAllAudio() {
  void setCrowd('off');
}

/** one-off preview used by the settings page */
export function previewSound(which: 'ball' | 'goal' | 'whistle' | 'cheer' | 'victory') {
  unlockAudio();
  if (which === 'ball') audio.kick(0.8);
  else if (which === 'goal') { audio.goalNet(); audio.goalCheer(); }
  else if (which === 'whistle') audio.whistle(false);
  else if (which === 'cheer') audio.goalCheer();
  else audio.victory();
}
