import { describe, expect, it } from "vite-plus/test";

import {
  createTabSwipeTracker,
  stepCommittedWheel,
  type CommittedWheel,
} from "./sidebarTabSwipe.logic";

const BOTH_NEIGHBOURS = { min: -300, max: 300 };

describe("createTabSwipeTracker", () => {
  it("follows the horizontal movement and accumulates it", () => {
    const track = createTabSwipeTracker();
    expect(track.move({ deltaX: 40, deltaY: 0 }, BOTH_NEIGHBOURS)).toBe(40);
    expect(track.move({ deltaX: 40, deltaY: 2 }, BOTH_NEIGHBOURS)).toBe(80);
    expect(track.move({ deltaX: -30, deltaY: 0 }, BOTH_NEIGHBOURS)).toBe(50);
  });

  it("ignores vertical scrolling", () => {
    const track = createTabSwipeTracker();
    expect(track.move({ deltaX: 5, deltaY: 200 }, BOTH_NEIGHBOURS)).toBeNull();
    expect(track.settle(100)).toBe(0);
  });

  it("clamps the offset to the neighbours that exist", () => {
    const track = createTabSwipeTracker();
    expect(track.move({ deltaX: 200, deltaY: 0 }, { min: 0, max: 0 })).toBe(0);
    expect(track.move({ deltaX: -200, deltaY: 0 }, { min: -120, max: 0 })).toBe(-120);
  });

  it("commits to the next or previous tab once the offset passes the threshold", () => {
    const forward = createTabSwipeTracker();
    forward.move({ deltaX: 150, deltaY: 0 }, BOTH_NEIGHBOURS);
    expect(forward.settle(100)).toBe(1);

    const backward = createTabSwipeTracker();
    backward.move({ deltaX: -150, deltaY: 0 }, BOTH_NEIGHBOURS);
    expect(backward.settle(100)).toBe(-1);
  });

  it("springs back when the offset stays below the threshold", () => {
    const track = createTabSwipeTracker();
    track.move({ deltaX: 60, deltaY: 0 }, BOTH_NEIGHBOURS);
    expect(track.settle(100)).toBe(0);
  });

  it("never commits without movement, even with a zero threshold", () => {
    expect(createTabSwipeTracker().settle(0)).toBe(0);
  });

  it("starts the next gesture from zero after settling", () => {
    const track = createTabSwipeTracker();
    track.move({ deltaX: 150, deltaY: 0 }, BOTH_NEIGHBOURS);
    track.settle(100);
    expect(track.move({ deltaX: 10, deltaY: 0 }, BOTH_NEIGHBOURS)).toBe(10);
  });
});

function classify(deltas: readonly number[], sign = 1): boolean[] {
  let state: CommittedWheel = { sign, floor: Infinity, previous: 0, decelerating: false };
  return deltas.map((deltaX) => {
    const step = stepCommittedWheel(state, deltaX);
    state = step.state;
    return step.momentum;
  });
}

describe("stepCommittedWheel", () => {
  it("keeps the finger's own acceleration and deceleration as one swipe", () => {
    expect(classify([1, 2, 4, 6, 7, 6, 4, 2, 1, 0.5, 0.2]).every(Boolean)).toBe(true);
  });

  it("keeps decaying momentum in the committed direction", () => {
    expect(classify([6, 5.4, 4.9, 4.4, 4, 3.6]).every(Boolean)).toBe(true);
  });

  it("starts a new swipe at once when the direction reverses", () => {
    expect(classify([6, 5.4, -0.5])).toEqual([true, true, false]);
  });

  it("starts a new swipe when a same-direction swipe rises above the momentum while it still decays", () => {
    // momentum decays from 6 to 4.4, a new swipe starts at 0.5 and rises
    const result = classify([6, 5.4, 4.9, 4.4, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]);
    expect(result.slice(0, 4).every(Boolean)).toBe(true);
    expect(result[11]).toBe(false);
  });

  it("keeps a finger that slows down and speeds up again as one swipe", () => {
    expect(classify([1, 2, 4, 6, 8, 6, 4, 2, 2.5, 3, 4, 5, 6, 7, 6, 5, 4, 3]).every(Boolean)).toBe(
      true,
    );
  });

  it("keeps a large swipe that slows to a few pixels and speeds up again as one swipe", () => {
    const large = [4, 8, 14, 20, 26, 30, 28, 24, 20, 16, 12, 9, 6, 4, 5, 7, 9, 11];
    expect(classify(large).every(Boolean)).toBe(true);
  });
});
