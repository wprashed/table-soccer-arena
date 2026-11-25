import { describe, it, expect } from 'vitest';
import { balanceTeams, tryFormMatch, shouldFillWithBots, pairKey, estimateWait, type QueueEntry } from './matchmaking';

const entry = (id: string, rating: number, joinedAt = 0, extra: Partial<QueueEntry> = {}): QueueEntry => ({
  userId: id,
  rating,
  joinedAt,
  ...extra,
});

describe('team balancing', () => {
  it('splits four players into the most balanced pair', () => {
    const q = [entry('a', 1600), entry('b', 1500), entry('c', 1400), entry('d', 1300)];
    const { teamA, teamB, spread } = balanceTeams(q);
    expect(teamA.length + teamB.length).toBe(4);
    expect(spread).toBe(0); // 1600+1300 vs 1500+1400
  });

  it('keeps the spread small for uneven pools', () => {
    const q = [entry('a', 2000), entry('b', 1200), entry('c', 1150), entry('d', 1100)];
    const { spread } = balanceTeams(q);
    expect(spread).toBeLessThanOrEqual(2100);
  });
});

describe('tryFormMatch', () => {
  it('does not match fewer than four players', () => {
    expect(tryFormMatch([entry('a', 1000), entry('b', 1000), entry('c', 1000)])).toBeNull();
  });

  it('matches four closely-rated players immediately', () => {
    const q = [entry('a', 1000, 0), entry('b', 1030, 0), entry('c', 990, 0), entry('d', 1010, 0)];
    const m = tryFormMatch(q, { now: () => 1000 });
    expect(m).not.toBeNull();
    expect(new Set([...m!.teamA, ...m!.teamB].map((p) => p.userId)).size).toBe(4);
    expect(m!.ratingSpread).toBeLessThanOrEqual(40);
  });

  it('widens the band as players wait longer', () => {
    const q = [entry('a', 1000, 0), entry('b', 1400, 0), entry('c', 1000, 0), entry('d', 1400, 0)];
    // immediately: too wide
    expect(tryFormMatch(q, { now: () => 0, baseBand: 100, bandPerSecond: 0 })).toBeNull();
    // after 40s: widened band allows it
    const m = tryFormMatch(q, { now: () => 40_000, baseBand: 100, bandPerSecond: 20 });
    expect(m).not.toBeNull();
  });

  it('balances teams by combined rating', () => {
    const q = [entry('a', 1800, 0), entry('b', 1750, 0), entry('c', 1200, 0), entry('d', 1150, 0)];
    const m = tryFormMatch(q, { now: () => 60_000, baseBand: 1000 });
    expect(m).not.toBeNull();
    const sumA = m!.teamA.reduce((s, p) => s + p.rating, 0);
    const sumB = m!.teamB.reduce((s, p) => s + p.rating, 0);
    expect(Math.abs(sumA - sumB)).toBeLessThanOrEqual(100);
  });

  it('avoids repeating opponents when a fresh pairing exists', () => {
    const q = [entry('a', 1000, 0), entry('b', 1000, 0), entry('c', 1000, 0), entry('d', 1000, 0)];
    const recent = new Set([pairKey('a', 'b'), pairKey('c', 'd')]);
    const m = tryFormMatch(q, { now: () => 5000, recentPairs: recent, baseBand: 500 });
    // every 4-group has the same conflict, so it should refuse until the wait threshold
    expect(m).toBeNull();
    const later = tryFormMatch(q, { now: () => 30_000, recentPairs: recent, baseBand: 500 });
    expect(later).not.toBeNull();
  });

  it('never returns duplicate players', () => {
    const q = Array.from({ length: 9 }, (_, i) => entry(`p${i}`, 950 + i * 20, i * 100));
    const m = tryFormMatch(q, { now: () => 20_000, baseBand: 1200 });
    expect(m).not.toBeNull();
    const ids = [...m!.teamA, ...m!.teamB].map((p) => p.userId);
    expect(new Set(ids).size).toBe(4);
  });
});

describe('bot fill and status text', () => {
  it('fills with bots only after the grace period and only with consent', () => {
    const q = [entry('a', 1000, 0, { allowBots: true })];
    expect(shouldFillWithBots(q, 10_000, 12_000)).toBe(false);
    expect(shouldFillWithBots(q, 13_000, 12_000)).toBe(true);
    const noBots = [entry('b', 1000, 0, { allowBots: false })];
    expect(shouldFillWithBots(noBots, 60_000, 12_000)).toBe(false);
  });

  it('produces human-readable queue status', () => {
    expect(estimateWait(4)).toMatch(/found/i);
    expect(estimateWait(3)).toMatch(/1 more/i);
    expect(estimateWait(0)).toMatch(/waiting/i);
  });
});
