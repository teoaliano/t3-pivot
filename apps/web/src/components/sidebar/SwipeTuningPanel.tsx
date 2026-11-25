import { useState } from "react";
import { createPortal } from "react-dom";

import { swipeTuning } from "./sidebarTabSwipe.logic";

// TEMPORARY: floating sliders for tuning the swipe thresholds. Remove with sidebarTabSwipe.logic's swipeTuning.
const SLIDERS = [
  { key: "commitFraction", label: "commit fraction", min: 0.1, max: 0.9, step: 0.01 },
  { key: "gapMs", label: "gap ms", min: 20, max: 300, step: 5 },
  { key: "risePx", label: "rise px", min: 0, max: 30, step: 0.5 },
  { key: "restPx", label: "rest px", min: 0, max: 15, step: 0.25 },
] as const;

export function SwipeTuningPanel() {
  const [values, setValues] = useState(() => ({ ...swipeTuning }));
  // Portaled so the sidebar's overflow clipping does not cut the panel off.
  return createPortal(
    <div className="fixed bottom-2 left-2 z-50 flex w-56 flex-col gap-2 rounded-md border bg-popover p-3 text-xs shadow-lg">
      {SLIDERS.map((slider) => (
        <label key={slider.key} className="flex flex-col gap-1">
          <span>
            {slider.label}: <strong>{values[slider.key]}</strong>
          </span>
          <input
            type="range"
            min={slider.min}
            max={slider.max}
            step={slider.step}
            value={values[slider.key]}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              swipeTuning[slider.key] = value;
              setValues((current) => ({ ...current, [slider.key]: value }));
            }}
          />
        </label>
      ))}
    </div>,
    document.body,
  );
}
