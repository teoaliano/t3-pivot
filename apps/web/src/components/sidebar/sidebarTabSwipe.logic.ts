// TEMPORARY tuning knobs, driven by SwipeTuningPanel. Remove together with the panel.
export const swipeTuning = {
  // Share of the panel width a swipe must cross to commit.
  commitFraction: 0.5,
  // Quiet time that ends a swipe; trackpad momentum keeps wheel events flowing inside it.
  gapMs: 90,
  // A same-direction rise this far above the lowest magnitude since deceleration is a new swipe.
  risePx: 3,
  // A new swipe starts from rest; a finger that only slows down is the same swipe.
  restPx: 1.5,
};

export interface TabSwipeInput {
  readonly deltaX: number;
  readonly deltaY: number;
}

// Limits the content offset to the neighbours that exist: a missing neighbour has zero room.
export interface TabSwipeBounds {
  readonly min: number;
  readonly max: number;
}

export type TabSwipeStep = -1 | 0 | 1;

// Positive offsets move toward the next tab, negative toward the previous one.
export function createTabSwipeTracker() {
  let offset = 0;

  return {
    // Returns the new offset in px, or null for a vertical wheel the swipe ignores.
    move(input: TabSwipeInput, bounds: TabSwipeBounds): number | null {
      if (Math.abs(input.deltaX) <= Math.abs(input.deltaY)) return null;
      offset = Math.min(bounds.max, Math.max(bounds.min, offset + input.deltaX));
      return offset;
    },
    // Ends the gesture: commits when the offset passed the threshold, otherwise stays put.
    settle(commitOffset: number): TabSwipeStep {
      const step =
        offset > 0 && offset >= commitOffset ? 1 : offset < 0 && -offset >= commitOffset ? -1 : 0;
      offset = 0;
      return step;
    },
  };
}

export interface CommittedWheel {
  // Direction of the committed swipe: -1 or 1.
  readonly sign: number;
  // Lowest magnitude since the finger started decelerating; Infinity until it does.
  readonly floor: number;
  readonly previous: number;
  readonly decelerating: boolean;
}

// Momentum keeps the committed direction. A reversal starts a new swipe at once. Otherwise the
// finger's own acceleration is ignored until the magnitude starts falling; after that, a rise well
// above a near-rest floor is a new swipe that landed on the momentum.
export function stepCommittedWheel(
  state: CommittedWheel,
  deltaX: number,
): { readonly momentum: boolean; readonly state: CommittedWheel } {
  const magnitude = Math.abs(deltaX);
  if (Math.sign(deltaX) !== state.sign) {
    return { momentum: false, state: { ...state, previous: magnitude } };
  }
  const decelerating = state.decelerating || magnitude < state.previous;
  const floor = decelerating ? Math.min(state.floor, magnitude) : Infinity;
  const rested = state.floor <= swipeTuning.restPx;
  const newSwipe = decelerating && rested && magnitude > state.floor + swipeTuning.risePx;
  return {
    momentum: !newSwipe,
    state: { sign: state.sign, floor, previous: magnitude, decelerating },
  };
}
