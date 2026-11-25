import {
  AlarmClockIcon,
  CheckIcon,
  CircleDashedIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  MessageSquareIcon,
} from "lucide-react";
import * as Schema from "effect/Schema";
import { type ReactNode, useState } from "react";
import { flushSync } from "react-dom";

import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  type CommittedWheel,
  createTabSwipeTracker,
  stepCommittedWheel,
  swipeTuning,
  type TabSwipeStep,
} from "./sidebarTabSwipe.logic";
import { SidebarSwipePreviewList } from "./SidebarSwipePreview";
import { SwipeTuningPanel } from "./SwipeTuningPanel";

export const SidebarTab = Schema.Literals(["pivots", "threads", "working", "snoozed", "settled"]);
export type SidebarTab = typeof SidebarTab.Type;

const SIDEBAR_TABS = [
  { value: "pivots", label: "Pivots", icon: LayoutDashboardIcon },
  { value: "threads", label: "Threads", icon: MessageSquareIcon },
  { value: "working", label: "Working", icon: CircleDashedIcon },
  { value: "snoozed", label: "Snoozed", icon: AlarmClockIcon },
  { value: "settled", label: "Settled", icon: CheckIcon },
] as const satisfies ReadonlyArray<{ value: SidebarTab; label: string; icon: LucideIcon }>;

const SIDEBAR_TABS_WITHOUT_WORKING = SIDEBAR_TABS.filter((tab) => tab.value !== "working");

// Ease-out with a fast start: the list keeps the finger's speed for the first frames.
const SWIPE_SETTLE_MS = 200;
const SWIPE_SETTLE_EASING = "cubic-bezier(0.2, 0, 0, 1)";

function visibleSidebarTabs(workingShelfEnabled: boolean) {
  return workingShelfEnabled ? SIDEBAR_TABS : SIDEBAR_TABS_WITHOUT_WORKING;
}

export function SidebarTabBar(props: {
  value: SidebarTab;
  onValueChange: (tab: SidebarTab) => void;
  counts: Record<SidebarTab, number>;
  workingShelfEnabled: boolean;
}) {
  const tabs = visibleSidebarTabs(props.workingShelfEnabled);
  return (
    // Wide sidebars label every tab, medium ones only the selected tab, and
    // narrow ones fall back to icons with tooltips.
    <div className="@container/sidebar-tabs mx-0.5 mb-1">
      <ToggleGroup
        aria-label="Sidebar threads"
        variant="segmented"
        className="w-full"
        value={[props.value]}
        onValueChange={(value) => {
          const next = SIDEBAR_TABS.find((tab) => tab.value === value[0]);
          if (next !== undefined) props.onValueChange(next.value);
        }}
      >
        {tabs.map((tab) => {
          const label = `${tab.label} (${props.counts[tab.value]})`;
          return (
            <Tooltip key={tab.value}>
              <TooltipTrigger
                render={
                  <Toggle
                    value={tab.value}
                    aria-label={label}
                    className="flex-auto"
                    data-testid={`sidebar-tab-${tab.value}`}
                  />
                }
              >
                <tab.icon aria-hidden className="size-3.5" />
                <span className="hidden @[17rem]/sidebar-tabs:in-data-pressed:inline @[28rem]/sidebar-tabs:inline">
                  {tab.label}
                </span>
              </TooltipTrigger>
              <TooltipPopup side="bottom">{label}</TooltipPopup>
            </Tooltip>
          );
        })}
      </ToggleGroup>
    </div>
  );
}

interface SidebarSwipePreview {
  readonly tab: SidebarTab;
  // The side the neighbouring tab enters from: 1 = right, -1 = left.
  readonly direction: 1 | -1;
}

interface SwipeSession {
  readonly tracker: ReturnType<typeof createTabSwipeTracker>;
  preview: SidebarSwipePreview | null;
  endTimer: ReturnType<typeof setTimeout> | undefined;
  settleTimer: ReturnType<typeof setTimeout> | undefined;
  pendingTab: SidebarTab | null;
  // Set once the offset crossed the commit threshold; the rest of the momentum is ignored.
  committed: boolean;
  committedWheel: CommittedWheel;
}

// Two-finger horizontal swipe over the thread list drags it with the finger and reveals the
// neighbouring tab beside it; releasing past a third of the width commits. The movement is
// written straight to the DOM and the swipe state lives here, so a gesture re-renders this
// wrapper only, never the `children` list.
export function SidebarSwipeArea(props: {
  value: SidebarTab;
  onValueChange: (tab: SidebarTab) => void;
  workingShelfEnabled: boolean;
  renderPreview: (tab: SidebarTab) => ReactNode;
  children: ReactNode;
}) {
  const { value, onValueChange, workingShelfEnabled, renderPreview, children } = props;
  const [swipePreview, setSwipePreview] = useState<SidebarSwipePreview | null>(null);
  const [session] = useState<SwipeSession>(() => ({
    tracker: createTabSwipeTracker(),
    preview: null,
    endTimer: undefined,
    settleTimer: undefined,
    pendingTab: null,
    committed: false,
    committedWheel: { sign: 0, floor: Infinity, previous: 0, decelerating: false },
  }));
  const tabs = visibleSidebarTabs(workingShelfEnabled);
  const index = tabs.findIndex((tab) => tab.value === value);
  const previous = tabs[index - 1];
  const next = tabs[index + 1];
  const attachSwipeArea = (area: HTMLElement | null) => {
    if (area === null) return;
    const panel = () => area.querySelector<HTMLElement>("[data-sidebar-swipe-panel]");
    const previewElement = (direction: 1 | -1) =>
      area.querySelector<HTMLElement>(
        `[data-sidebar-swipe-preview][data-direction="${direction}"]`,
      );

    const completeSettle = () => {
      clearTimeout(session.settleTimer);
      session.settleTimer = undefined;
      const committed = session.pendingTab;
      session.pendingTab = null;
      session.preview = null;
      flushSync(() => {
        if (committed !== null) onValueChange(committed);
        setSwipePreview(null);
      });
      const content = panel();
      if (content !== null) {
        content.style.transition = "";
        content.style.transform = "";
        content.style.willChange = "";
      }
      // Each neighbour stays mounted, so it goes back to its own resting offset, not an empty transform.
      for (const element of area.querySelectorAll<HTMLElement>("[data-sidebar-swipe-preview]")) {
        element.style.transition = "";
        element.style.transform = `translateX(${Number(element.dataset.direction) * 100}%)`;
        element.style.willChange = "";
      }
    };

    const settleGesture = () => {
      const width = panel()?.clientWidth ?? 0;
      const step: TabSwipeStep = session.tracker.settle(width * swipeTuning.commitFraction);
      const active = session.preview;
      if (active === null) return;
      session.pendingTab = step === 0 ? null : active.tab;
      const transition = `transform ${SWIPE_SETTLE_MS}ms ${SWIPE_SETTLE_EASING}`;
      const content = panel();
      if (content !== null) {
        content.style.transition = transition;
        content.style.transform = `translateX(${-step * width}px)`;
      }
      const overlay = previewElement(active.direction);
      if (overlay !== null) {
        overlay.style.transition = transition;
        overlay.style.transform = `translateX(${step === 0 ? active.direction * width : 0}px)`;
      }
      session.settleTimer = setTimeout(completeSettle, SWIPE_SETTLE_MS);
    };

    // The gap timer armed by the last event of a committed swipe only clears the flag.
    const endGesture = () => {
      session.endTimer = undefined;
      if (session.committed) {
        session.committed = false;
        return;
      }
      settleGesture();
    };

    const handleWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      clearTimeout(session.endTimer);
      session.endTimer = setTimeout(endGesture, swipeTuning.gapMs);
      if (session.committed) {
        const step = stepCommittedWheel(session.committedWheel, event.deltaX);
        session.committedWheel = step.state;
        if (step.momentum) return;
        session.committed = false;
        if (session.settleTimer !== undefined) {
          completeSettle();
          return;
        }
      }
      // The tabs changed under this closure, so the first event of the next gesture is dropped.
      if (session.settleTimer !== undefined) {
        completeSettle();
        return;
      }

      const content = panel();
      if (content === null) return;
      const width = content.clientWidth;
      const offset = session.tracker.move(
        { deltaX: event.deltaX, deltaY: event.deltaY },
        { min: previous === undefined ? 0 : -width, max: next === undefined ? 0 : width },
      );
      if (offset === null) return;

      const nextPreview: SidebarSwipePreview | null =
        offset > 0 && next !== undefined
          ? { tab: next.value, direction: 1 }
          : offset < 0 && previous !== undefined
            ? { tab: previous.value, direction: -1 }
            : null;
      if (nextPreview?.tab !== session.preview?.tab) {
        session.preview = nextPreview;
        setSwipePreview(nextPreview);
      }

      content.style.transition = "";
      content.style.transform = `translateX(${-offset}px)`;
      content.style.willChange = "transform";
      const overlay = session.preview === null ? null : previewElement(session.preview.direction);
      if (overlay !== null && session.preview !== null) {
        overlay.style.transition = "";
        overlay.style.transform = `translateX(${session.preview.direction * width - offset}px)`;
        overlay.style.willChange = "transform";
      }
      if (session.preview !== null && Math.abs(offset) >= width * swipeTuning.commitFraction) {
        session.committed = true;
        session.committedWheel = {
          sign: Math.sign(offset),
          floor: Infinity,
          previous: 0,
          decelerating: false,
        };
        settleGesture();
      }
    };

    area.addEventListener("wheel", handleWheel, { passive: false });
    return () => area.removeEventListener("wheel", handleWheel);
  };

  return (
    <div ref={attachSwipeArea} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div data-sidebar-swipe-panel className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>
      {previous !== undefined ? (
        <SidebarSwipePreviewList direction={-1} visible={swipePreview?.tab === previous.value}>
          {renderPreview(previous.value)}
        </SidebarSwipePreviewList>
      ) : null}
      {next !== undefined ? (
        <SidebarSwipePreviewList direction={1} visible={swipePreview?.tab === next.value}>
          {renderPreview(next.value)}
        </SidebarSwipePreviewList>
      ) : null}
      <SwipeTuningPanel />
    </div>
  );
}
