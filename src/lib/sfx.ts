/**
 * Backwards-compatible SFX facade.
 *
 * The game used to synthesise tones in the browser. It now ships real baked
 * samples (see tools/gen_sounds.py + lib/audio.ts); this module keeps the old
 * call sites working and routes them at the new engine so every existing screen
 * immediately plays the good sounds.
 */
import { audio, setVolumes, unlockAudio } from './audio';

export function setSfxEnabled(on: boolean) {
  setVolumes({ enabled: on });
}

export const sfx = {
  kick: (power = 0.6) => audio.kick(power),
  wall: (power = 0.5) => audio.wall(power),
  goal: () => {
    audio.goalNet();
    audio.goalCheer();
  },
  concede: () => {
    audio.defeat();
  },
  win: () => audio.victory(),
  lose: () => audio.defeat(),
  click: () => {
    unlockAudio();
    audio.click();
  },
  countdown: () => audio.countdown(1),
  whistle: () => audio.whistle(false),
  coin: () => audio.coin(),
  chat: () => audio.click(),
  success: () => audio.success(),
  hover: () => audio.hover(),
};
