import {
  AlarmClockIcon,
  CheckIcon,
  CircleDashedIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  MessageSquareIcon,
} from "lucide-react";
import * as Schema from "effect/Schema";

import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export const SidebarTab = Schema.Literals(["pivots", "threads", "working", "snoozed", "settled"]);
export type SidebarTab = typeof SidebarTab.Type;

const SIDEBAR_TABS = [
  { value: "pivots", label: "Pivots", icon: LayoutDashboardIcon },
  { value: "threads", label: "Threads", icon: MessageSquareIcon },
  { value: "working", label: "Working", icon: CircleDashedIcon },
  { value: "snoozed", label: "Snoozed", icon: AlarmClockIcon },
  { value: "settled", label: "Settled", icon: CheckIcon },
] as const satisfies ReadonlyArray<{ value: SidebarTab; label: string; icon: LucideIcon }>;

export function SidebarTabBar(props: {
  value: SidebarTab;
  onValueChange: (tab: SidebarTab) => void;
  counts: Record<SidebarTab, number>;
  workingShelfEnabled: boolean;
}) {
  const tabs = props.workingShelfEnabled
    ? SIDEBAR_TABS
    : SIDEBAR_TABS.filter((tab) => tab.value !== "working");
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
