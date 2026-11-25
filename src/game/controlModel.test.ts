import { describe, it, expect } from 'vitest';
import {
  createControlState,
  deriveSlide,
  deriveKick,
  isFlick,
  flickTarget,
  SLIDE_DEADZONE,
  DRAG_FULL_RANGE,
} from './controlModel';
import { ROD } from '../../shared/engine/constants';

const fresh = () => createControlState();

describe('deriveSlide — dead-zone', () => {
  it('reads zero inside the dead-zone', () => {
    const s = fresh();
    s.keySlide = SLIDE_DEADZONE * 0.9;
    expect(deriveSlide(s, 0)).toBe(0);
    s.keySlide = -SLIDE_DEADZONE * 0.99;
    expect(deriveSlide(s, 0)).toBe(0);
  });

  it('re-scales above the dead-zone so the usable range starts at zero', () => {
    const s = fresh();
    s.keySlide = 1;
    expect(deriveSlide(s, 0)).toBeCloseTo(1, 6);
    s.keySlide = SLIDE_DEADZONE + (1 - SLIDE_DEADZONE) / 2;
    expect(deriveSlide(s, 0)).toBeCloseTo(0.5, 6);
  });

  it('is symmetric for both directions', () => {
    const l = fresh();
    const r = fresh();
    l.keySlide = -0.7;
    r.keySlide = 0.7;
    expect(deriveSlide(l, 0)).toBeCloseTo(-deriveSlide(r, 0), 6);
  });

  it('stays inside -1..1', () => {
    const s = fresh();
    s.padSlide = 5;
    expect(Math.abs(deriveSlide(s, 0))).toBeLessThanOrEqual(1);
  });
});

describe('deriveSlide — precedence', () => {
  it('keyboard beats the on-screen pad', () => {
    const s = fresh();
    s.keySlide = 1;
    s.padSlide = -1;
    expect(deriveSlide(s, 0)).toBeGreaterThan(0);
  });

  it('an active drag beats both', () => {
    const s = fresh();
    s.keySlide = -1;
    s.padSlide = -1;
    s.dragTarget = 20;
    expect(deriveSlide(s, 0)).toBeGreaterThan(0);
  });

  it('falls back to the pad when no key is held', () => {
    const s = fresh();
    s.padSlide = -1;
    expect(deriveSlide(s, 0)).toBeLessThan(0);
  });
});

describe('deriveSlide — drag-to-position', () => {
  it('drives toward the finger', () => {
    const s = fresh();
    s.dragTarget = 10;
    expect(deriveSlide(s, 0)).toBeGreaterThan(0);
    expect(deriveSlide(s, 20)).toBeLessThan(0); // overshot, comes back
  });

  it('settles to a stop when the rods reach the target', () => {
    const s = fresh();
    s.dragTarget = 12;
    expect(deriveSlide(s, 12)).toBe(0);
    expect(deriveSlide(s, 11.9)).toBe(0); // inside the deadband
  });

  it('never teleports: a huge error still yields at most full speed', () => {
    const s = fresh();
    s.dragTarget = 10_000;
    expect(deriveSlide(s, 0)).toBeLessThanOrEqual(1);
  });

  it('converges on the target over repeated frames', () => {
    const s = fresh();
    s.dragTarget = 8;
    let slide = 0;
    for (let i = 0; i < 400; i++) slide += deriveSlide(s, slide) * 2.5;
    expect(Math.abs(slide - 8)).toBeLessThan(0.6);
  });

  it('a null drag target hands control back to the pad', () => {
    const s = fresh();
    s.dragTarget = null;
    s.padSlide = 1;
    expect(deriveSlide(s, 0)).toBeGreaterThan(0);
  });
});

describe('deriveKick', () => {
  it('fires for a held button', () => {
    const s = fresh();
    s.front = true;
    expect(deriveKick(s, 'front')).toBe(1);
    expect(deriveKick(s, 'rear')).toBe(0);
  });

  it('fires for a flick', () => {
    const s = fresh();
    s.flick.rear = true;
    expect(deriveKick(s, 'rear')).toBe(1);
  });

  it('is idle by default', () => {
    const s = fresh();
    expect(deriveKick(s, 'rear') + deriveKick(s, 'front')).toBe(0);
  });

  it('treats the two rod pairs independently', () => {
    const s = fresh();
    s.rear = true;
    s.front = true;
    expect(deriveKick(s, 'rear')).toBe(1);
    expect(deriveKick(s, 'front')).toBe(1);
    s.rear = false;
    expect(deriveKick(s, 'rear')).toBe(0);
    expect(deriveKick(s, 'front')).toBe(1);
  });
});

describe('isFlick', () => {
  it('ignores a slow positioning drag', () => {
    expect(isFlick(0)).toBe(false);
    expect(isFlick(20)).toBe(false);
    expect(isFlick(-45)).toBe(false);
  });

  it('fires on a fast swipe in either direction', () => {
    expect(isFlick(60)).toBe(true);
    expect(isFlick(-60)).toBe(true);
  });
});

describe('flickTarget', () => {
  it('picks the rod pair closest to the ball', () => {
    expect(flickTarget(-8, -10, 10, 1)).toBe('rear');
    expect(flickTarget(8, -10, 10, -1)).toBe('front');
    expect(flickTarget(30, -10, 10, 1)).toBe('front');
    expect(flickTarget(-30, -10, 10, 1)).toBe('rear');
  });

  it('breaks a tie toward the attacking rod', () => {
    expect(flickTarget(0, -5, 5, 1)).toBe('front');
    expect(flickTarget(0, -5, 5, -1)).toBe('rear');
  });
});

describe('constants', () => {
  it('a full-width drag spans the whole rod travel', () => {
    expect(DRAG_FULL_RANGE).toBeCloseTo(ROD.maxSlide * 2, 6);
  });

  it('keeps a thumb-sized dead-zone', () => {
    expect(SLIDE_DEADZONE).toBeGreaterThan(0.05);
    expect(SLIDE_DEADZONE).toBeLessThan(0.3);
  });
});
