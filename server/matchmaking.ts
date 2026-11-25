/**
 * Matchmaking engine (pure + testable).
 *
 * - collects players in a rating queue
 * - widens the acceptable rating band the longer a player waits
 * - balances the two teams by combined rating (snake draft)
 * - avoids rematching players who just played together
 * - can fill a short queue with bots after a grace period (dev/demo mode)
 */
export interface QueueEntry {
  userId: string;
  rating: number;
  joinedAt: number;
  /** ms round-trip, used only as a tie-breaker when splitting teams */
  latency?: number;
  /** allow bot fill-in if the queue stays short */
  allowBots?: boolean;
  isBot?: boolean;
}

export interface FormedMatch {
  teamA: QueueEntry[];
  teamB: QueueEntry[];
  ratingSpread: number;
  waitedMs: number;
}

export interface MatchmakerOptions {
  /** base acceptable rating difference between the two teams */
  baseBand?: number;
  bandPerSecond?: number;
  maxBand?: number;
  /** how long before bots may fill the queue */
  botFillAfterMs?: number;
  now?: () => number;
}

export function balanceTeams(entries: QueueEntry[]): { teamA: QueueEntry[]; teamB: QueueEntry[]; spread: number } {
  const sorted = [...entries].sort((a, b) => b.rating - a.rating || (a.latency ?? 0) - (b.latency ?? 0));
  // snake draft: 1st+4th vs 2nd+3rd is the most balanced split for 4 players
  const teamA = [sorted[0], sorted[3]];
  const teamB = [sorted[1], sorted[2]];
  const sumA = teamA[0].rating + teamA[1].rating;
  const sumB = teamB[0].rating + teamB[1].rating;
  return { teamA, teamB, spread: Math.abs(sumA - sumB) };
}

/** Try every 4-player group until one satisfies band + history constraints. */
export function tryFormMatch(
  queue: QueueEntry[],
  opts: MatchmakerOptions & { recentPairs?: Set<string> } = {}
): FormedMatch | null {
  const now = opts.now?.() ?? Date.now();
  const baseBand = opts.baseBand ?? 120;
  const bandPerSecond = opts.bandPerSecond ?? 35;
  const maxBand = opts.maxBand ?? 700;
  const recent = opts.recentPairs ?? new Set<string>();

  if (queue.length < 4) return null;
  const sorted = [...queue].sort((a, b) => a.joinedAt - b.joinedAt);

  for (let i = 0; i < sorted.length - 3; i++) {
    // consider the 4 soonest-waiting players plus the closest-rated neighbours
    const anchor = sorted[i];
    const candidates = [...queue]
      .filter((e) => e.userId !== anchor.userId)
      .sort((a, b) => Math.abs(a.rating - anchor.rating) - Math.abs(b.rating - anchor.rating))
      .slice(0, 6);
    const group = [anchor, ...candidates].slice(0, 4);
    if (group.length < 4) continue;

    const waited = now - Math.min(...group.map((g) => g.joinedAt));
    const band = Math.min(maxBand, baseBand + (waited / 1000) * bandPerSecond);
    const ratings = group.map((g) => g.rating);
    if (Math.max(...ratings) - Math.min(...ratings) > band) continue;

    const { teamA, teamB, spread } = balanceTeams(group);
    if (spread > band * 1.6) continue;

    const recentConflict = [...teamA, ...teamB].some((p, idx, arr) =>
      arr.some(
        (q, jdx) =>
          jdx > idx && recent.has(pairKey(p.userId, q.userId))
      )
    );
    if (recentConflict && waited < 20_000) continue;

    return { teamA, teamB, ratingSpread: spread, waitedMs: waited };
  }
  return null;
}

export const pairKey = (a: string, b: string) => [a, b].sort().join('|');

/** Should we top up with bots? */
export function shouldFillWithBots(queue: QueueEntry[], nowMs: number, botFillAfterMs: number): boolean {
  if (queue.length === 0 || queue.length >= 4) return false;
  const oldest = Math.min(...queue.map((q) => q.joinedAt));
  return nowMs - oldest >= botFillAfterMs && queue.some((q) => q.allowBots);
}

export function estimateWait(queueLength: number): string {
  if (queueLength >= 4) return 'Match found!';
  if (queueLength === 3) return 'Almost there — 1 more player';
  if (queueLength === 2) return 'Waiting for 2 more players';
  if (queueLength === 1) return 'Searching for opponents…';
  return 'Waiting for players';
}
