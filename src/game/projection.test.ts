/**
 * The renderer's projection is the contract between physics and pixels: if it
 * disagrees with the simulation, the ball and figures end up in the wrong place.
 * These tests pin the invariants a real table's perspective must satisfy.
 */
import { describe, it, expect } from 'vitest';
import { project } from './renderer';
import { TABLE } from '../../shared/engine/constants';

const W = 1000;
const H = 600;
const p = (x: number, z: number) => project(x, z, W, H);

describe('projection', () => {
  it('maps x to screen x monotonically at every depth', () => {
    for (const z of [-TABLE.halfWidth, 0, TABLE.halfWidth]) {
      let prev = -Infinity;
      for (let x = -TABLE.halfLength; x <= TABLE.halfLength; x += 5) {
        const px = p(x, z).px;
        expect(px).toBeGreaterThan(prev);
        prev = px;
      }
    }
  });

  it('puts the near edge lower on screen than the far edge', () => {
    expect(p(0, TABLE.halfWidth).py).toBeGreaterThan(p(0, -TABLE.halfWidth).py);
  });

  it('foreshortens: the far edge is narrower than the near edge', () => {
    // A table seen from one end has the far end smaller and squeezed. Getting
    // this backwards was a real bug — it made the pitch flare outward.
    const nearW = p(TABLE.halfLength, TABLE.halfWidth).px - p(-TABLE.halfLength, TABLE.halfWidth).px;
    const farW = p(TABLE.halfLength, -TABLE.halfWidth).px - p(-TABLE.halfLength, -TABLE.halfWidth).px;
    expect(nearW).toBeGreaterThan(farW);
    expect(farW).toBeGreaterThan(nearW * 0.5); // still a table, not a triangle
  });

  it('keeps the whole pitch inside the drawing box', () => {
    for (let x = -TABLE.halfLength; x <= TABLE.halfLength; x += 6) {
      for (let z = -TABLE.halfWidth; z <= TABLE.halfWidth; z += 6) {
        const q = p(x, z);
        expect(q.px).toBeGreaterThanOrEqual(0);
        expect(q.px).toBeLessThanOrEqual(W);
        expect(q.py).toBeGreaterThanOrEqual(0);
        expect(q.py).toBeLessThanOrEqual(H);
      }
    }
  });

  it('places the goals at opposite ends of the centre line', () => {
    expect(p(-TABLE.halfLength, 0).px).toBeLessThan(p(0, 0).px);
    expect(p(TABLE.halfLength, 0).px).toBeGreaterThan(p(0, 0).px);
  });

  it('draws a goal mouth narrower than the pitch', () => {
    const mouthW = p(TABLE.halfLength, TABLE.goalHalfWidth).px - p(TABLE.halfLength, -TABLE.goalHalfWidth).px;
    const nearW = p(TABLE.halfLength, TABLE.halfWidth).px - p(-TABLE.halfLength, TABLE.halfWidth).px;
    expect(mouthW).toBeGreaterThan(0);
    expect(mouthW).toBeLessThan(nearW);
  });

  it('scales figures down toward the far end', () => {
    expect(p(0, TABLE.halfWidth).scale).toBeGreaterThan(p(0, -TABLE.halfWidth).scale);
  });
});
