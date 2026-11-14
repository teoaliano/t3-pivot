import { toServerClock } from "@t3tools/client-runtime/clock";
import type { EnvironmentId } from "@t3tools/contracts";
import { useNowSecond } from "../../hooks/useNowSecond";
import { formatWorkingDurationLabel } from "@t3tools/client-runtime/state/models";

export function WorkingDuration(props: { environmentId: EnvironmentId; startedAt: string | null }) {
  const startedMs = props.startedAt !== null ? Date.parse(props.startedAt) : Number.NaN;
  if (Number.isNaN(startedMs)) return null;
  return <WorkingDurationLabel environmentId={props.environmentId} startedMs={startedMs} />;
}

// Self-ticking so only this span re-renders each second, not the whole row;
// the shared tick lands every working row's update in the same frame.
function WorkingDurationLabel(props: { environmentId: EnvironmentId; startedMs: number }) {
  const nowMs = useNowSecond();
  return (
    <span className="tabular-nums">
      {formatWorkingDurationLabel(toServerClock(props.environmentId, nowMs) - props.startedMs)}
    </span>
  );
}
