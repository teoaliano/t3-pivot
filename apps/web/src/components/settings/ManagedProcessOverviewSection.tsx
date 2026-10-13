import type { EnvironmentId, ManagedProcess } from "@t3tools/contracts";
import { useMemo } from "react";

import { managedProcessEnvironment } from "~/state/managedProcesses";
import { useProjects, useThreadShells } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { managedProcessOverviewRows } from "./managedProcessOverview.logic";
import { SettingsRow, SettingsSection } from "./settingsLayout";

/** Every checkout in this environment with a dev server running or pinned. */
export function ManagedProcessOverviewSection({
  environmentId,
}: {
  environmentId: EnvironmentId | null;
}) {
  const { data } = useEnvironmentQuery(
    environmentId === null
      ? null
      : managedProcessEnvironment.overview({ environmentId, input: {} }),
  );
  const stop = useAtomCommand(managedProcessEnvironment.stop);
  const setPinned = useAtomCommand(managedProcessEnvironment.setPinned);
  const projects = useProjects();
  const threads = useThreadShells();
  const rows = useMemo(
    () =>
      managedProcessOverviewRows(data?.processes ?? [], {
        projects: projects.filter((project) => project.environmentId === environmentId),
        threads: threads.filter((thread) => thread.environmentId === environmentId),
      }),
    [data, environmentId, projects, threads],
  );
  if (environmentId === null) return null;

  return (
    <SettingsSection title="Dev servers">
      {rows.length === 0 ? (
        <SettingsRow
          title="No dev servers running"
          description="Servers you start from the browser preview, or that agents start, show up here."
        />
      ) : (
        rows.flatMap((row) =>
          row.processes.map((process) => (
            <SettingsRow
              key={`${process.checkoutPath}\u0000${process.scriptId}`}
              title={`${row.checkoutLabel} · ${process.scriptName}`}
              description={describeProcess(process)}
              control={
                process.status === "stopped" ? (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      void setPinned({
                        environmentId,
                        input: {
                          checkoutPath: process.checkoutPath,
                          scriptId: process.scriptId,
                          pinned: false,
                        },
                      })
                    }
                  >
                    Unpin
                  </Button>
                ) : (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      void stop({
                        environmentId,
                        input: { checkoutPath: process.checkoutPath, scriptId: process.scriptId },
                      })
                    }
                  >
                    Stop
                  </Button>
                )
              }
            />
          )),
        )
      )}
    </SettingsSection>
  );
}

function describeProcess(process: ManagedProcess): string {
  const pinned = process.pinned ? " · pinned" : "";
  switch (process.status) {
    case "running":
      return `localhost:${process.port}${pinned}`;
    case "starting":
      return `Starting on port ${process.port}${pinned}`;
    case "stopped":
      return `${process.lastError ?? "Stopped"}${pinned}`;
  }
}
