import { describe, it, expect } from 'vitest';
import {
  calculateTeamRating,
  expectedScore,
  tierFor,
  tierProgress,
  levelFromXp,
  xpForMatch,
  coinsForMatch,
  START_RATING,
  kFactorFor,
} from './rating';

const p = (id: string, rating: number, matchesPlayed = 100) => ({ id, rating, matchesPlayed });

describe('elo', () => {
  it('equal teams expect 50%', () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5, 6);
  });

  it('a win against an equal team yields a symmetric gain/loss', () => {
    const a: [any, any] = [p('a1', 1000), p('a2', 1000)];
    const b: [any, any] = [p('b1', 1000), p('b2', 1000)];
    const r = calculateTeamRating(a, b, 1);
    const aGain = r.players['a1'].delta + r.players['a2'].delta;
    const bLoss = r.players['b1'].delta + r.players['b2'].delta;
    expect(aGain).toBe(16); // +16 each -> +32 team
    expect(bLoss).toBe(-16);
    expect(aGain).toBe(-bLoss); // zero-sum
  });

  it('beating a stronger team gives more points than beating a weaker one', () => {
    const strong: [any, any] = [p('s1', 1500), p('s2', 1500)];
    const weak: [any, any] = [p('w1', 700), p('w2', 700)];
    const meStrong: [any, any] = [p('m1', 1000), p('m2', 1000)];
    const meWeak: [any, any] = [p('m3', 1000), p('m4', 1000)];
    const beatStrong = calculateTeamRating(meWeak, strong, 1);
    const beatWeak = calculateTeamRating(meStrong, weak, 1);
    expect(beatStrong.teamA.delta).toBeGreaterThan(beatWeak.teamA.delta);
  });

  it('draws move ratings toward each other', () => {
    const a: [any, any] = [p('a1', 1400), p('a2', 1400)];
    const b: [any, any] = [p('b1', 800), p('b2', 800)];
    const r = calculateTeamRating(a, b, 0.5);
    expect(r.teamA.delta).toBeLessThan(0);
    expect(r.teamB.delta).toBeGreaterThan(0);
  });

  it('is zero-sum across an entire match', () => {
    const teams: Array<[number, number, 0 | 0.5 | 1]> = [
      [1200, 1500, 1], [1500, 1200, 0], [1000, 1000, 0.5], [900, 1800, 1],
    ];
    for (const [ra, rb, sc] of teams) {
      const r = calculateTeamRating([p('a1', ra), p('a2', ra)], [p('b1', rb), p('b2', rb)], sc);
      const total = Object.values(r.players).reduce((acc, v) => acc + v.delta, 0);
      expect(total).toBe(0);
    }
  });

  it('never drops a rating below 100', () => {
    const r = calculateTeamRating([p('a1', 110), p('a2', 110)], [p('b1', 2200), p('b2', 2200)], 0);
    expect(r.players['a1'].after).toBeGreaterThanOrEqual(100);
    expect(r.players['a2'].after).toBeGreaterThanOrEqual(100);
  });

  it('new players use a larger K factor', () => {
    expect(kFactorFor(0)).toBe(48);
    expect(kFactorFor(50)).toBe(32);
  });
});

describe('tiers', () => {
  it('maps rating thresholds to the correct tier', () => {
    expect(tierFor(START_RATING).tier).toBe('Silver');
    expect(tierFor(999).tier).toBe('Bronze');
    expect(tierFor(1200).tier).toBe('Gold');
    expect(tierFor(1750).tier).toBe('Diamond');
    expect(tierFor(2600).tier).toBe('Legend');
  });

  it('computes tier progress between 0 and 1', () => {
    expect(tierProgress(1000)).toBe(0);
    expect(tierProgress(1100)).toBeGreaterThan(0.4);
    expect(tierProgress(3000)).toBe(1);
  });
});

describe('xp and coins', () => {
  it('levels grow with xp', () => {
    expect(levelFromXp(0).level).toBe(1);
    expect(levelFromXp(200).level).toBe(2);
    expect(levelFromXp(10000).level).toBeGreaterThan(5);
  });
  it('wins give more xp and coins than losses', () => {
    expect(xpForMatch(5, true, 1)).toBeGreaterThan(xpForMatch(5, false, 1));
    expect(coinsForMatch(5, true)).toBeGreaterThan(coinsForMatch(5, false));
  });
  it('streaks add xp', () => {
    expect(xpForMatch(0, true, 4)).toBeGreaterThan(xpForMatch(0, true, 1));
  });
});
