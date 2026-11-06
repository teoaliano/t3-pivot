import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ManagedProcessPortOccupiedError,
  ThreadId,
} from "@t3tools/contracts";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { resolveProjectScripts } from "@t3tools/shared/projectScripts";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import * as Schema from "effect/Schema";
import { useCallback, useMemo } from "react";
import { Alert, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { IconButton } from "../../components/ui/IconButton";
import { NavigationRow } from "../../components/ui/NavigationRow";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { SheetHeader } from "../../components/ui/SheetHeader";
import { useEnvironmentServerConfig, useProject, useThreadShell } from "../../state/entities";
import { managedProcessEnvironment } from "../../state/managedProcesses";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { describeDevServerRow, devServerRows, type DevServerRow } from "./dev-servers";

type DevServersSheetProps = StaticScreenProps<{
  readonly environmentId: string;
  readonly threadId: string;
}>;

const isPortOccupied = Schema.is(ManagedProcessPortOccupiedError);

type StartCommand = (value: {
  readonly environmentId: EnvironmentId;
  readonly input: {
    readonly threadId: ThreadId;
    readonly scriptId: string;
    readonly reallocate?: boolean;
  };
}) => Promise<AtomCommandResult<unknown, unknown>>;

async function startDevServer(input: {
  readonly start: StartCommand;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly scriptId: string;
  readonly reallocate?: boolean;
}): Promise<void> {
  const { start, environmentId, threadId, scriptId, reallocate } = input;
  const result = await start({
    environmentId,
    input: { threadId, scriptId, ...(reallocate ? { reallocate } : {}) },
  });
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  if (isPortOccupied(error)) {
    const occupant = error.occupantProcessName ?? error.occupantCommand ?? "Another process";
    Alert.alert(
      `Port ${error.port} is taken`,
      `${occupant} holds this checkout's port. It was left running.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Use a new port",
          onPress: () => void startDevServer({ ...input, reallocate: true }),
        },
      ],
    );
    return;
  }
  Alert.alert(
    "Could not start the dev server",
    error instanceof Error ? error.message : String(error),
  );
}

/** Start, stop and pin the dev servers of a thread's checkout. Viewing holds no claim. */
export function DevServersSheet(props: DevServersSheetProps) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const environmentId = EnvironmentId.make(props.route.params.environmentId);
  const threadId = ThreadId.make(props.route.params.threadId);
  const thread = useThreadShell({ environmentId, threadId });
  const project = useProject(thread ? { environmentId, projectId: thread.projectId } : null);
  const serverConfig = useEnvironmentServerConfig(environmentId);
  const checkoutPath = thread?.worktreePath ?? project?.workspaceRoot ?? null;
  const { data } = useEnvironmentQuery(
    checkoutPath === null
      ? null
      : managedProcessEnvironment.checkout({ environmentId, input: { checkoutPath } }),
  );
  const start = useAtomCommand(managedProcessEnvironment.start, { reportFailure: false });
  const stop = useAtomCommand(managedProcessEnvironment.stop);
  const setPinned = useAtomCommand(managedProcessEnvironment.setPinned);

  const rows = useMemo(
    () =>
      devServerRows({
        processes: data?.processes ?? [],
        scripts: project
          ? resolveProjectScripts(serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS, project)
          : [],
        detectedScript: data?.detectedScript,
      }),
    [data, project, serverConfig?.settings],
  );

  const startScript = useCallback(
    (scriptId: string) => startDevServer({ start, environmentId, threadId, scriptId }),
    [environmentId, start, threadId],
  );

  const renderRow = (row: DevServerRow) => {
    const live = row.state !== "startable";
    const target = checkoutPath === null ? null : { checkoutPath, scriptId: row.scriptId };
    return (
      <NavigationRow
        key={row.scriptId}
        title={row.scriptName}
        subtitle={describeDevServerRow(row)}
        onPress={live ? undefined : () => void startScript(row.scriptId)}
        accessibilityLabel={live ? row.scriptName : `Start ${row.scriptName}`}
        trailing={
          <View className="flex-row items-center gap-1">
            {live || row.pinned ? (
              <IconButton
                accessibilityLabel={
                  row.pinned ? `Unpin ${row.scriptName}` : `Keep ${row.scriptName} running`
                }
                icon={row.pinned ? "pin.slash" : "pin"}
                selected={row.pinned}
                onPress={() => {
                  if (target === null) return;
                  void setPinned({ environmentId, input: { ...target, pinned: !row.pinned } });
                }}
              />
            ) : null}
            {live ? (
              <IconButton
                accessibilityLabel={`Stop ${row.scriptName}`}
                icon="stop.fill"
                onPress={() => {
                  if (target === null) return;
                  void stop({ environmentId, input: target });
                }}
              />
            ) : (
              <IconButton
                accessibilityLabel={`Start ${row.scriptName}`}
                icon="play"
                onPress={() => void startScript(row.scriptId)}
              />
            )}
          </View>
        }
      />
    );
  };

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <SheetHeader title="Dev servers" onClose={() => navigation.goBack()} />
      <ScreenContent>
        <ScrollView
          contentContainerClassName="gap-3 p-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 8 }}
        >
          {rows.length === 0 ? (
            <Text className="text-center text-sm text-foreground-muted">
              This project has no dev server to start. Add an action with a preview URL or the run
              icon, or a dev script in package.json.
            </Text>
          ) : (
            <View className="overflow-hidden rounded-2xl">{rows.map(renderRow)}</View>
          )}
          <Text className="px-1 text-xs text-foreground-muted">
            Servers nobody has used for 30 minutes stop on their own. Pin one to keep it running.
          </Text>
        </ScrollView>
      </ScreenContent>
    </View>
  );
}
