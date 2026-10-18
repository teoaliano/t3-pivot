import { useEffect, useState } from "react";

import { formatWorkingDurationLabel } from "../Sidebar.logic";

// Self-ticking so only this span re-renders each second, not the whole row.
export function WorkingDuration(props: { startedAt: string | null }) {
  const startedMs = props.startedAt !== null ? Date.parse(props.startedAt) : Number.NaN;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (Number.isNaN(startedMs)) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [startedMs]);
  if (Number.isNaN(startedMs)) return null;
  return <span className="tabular-nums">{formatWorkingDurationLabel(nowMs - startedMs)}</span>;
}
