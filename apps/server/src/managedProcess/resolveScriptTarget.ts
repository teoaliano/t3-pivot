import {
  ManagedProcessScriptNotFoundError,
  ManagedProcessThreadNotFoundError,
  type ThreadId,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { isDevProjectScript, resolveProjectScripts } from "@t3tools/shared/projectScripts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { DETECTED_DEV_SCRIPT_ID, readDetectedDevScript } from "./detectDevScript.ts";
import type { ManagedScriptTarget } from "./ManagedProcesses.ts";

/** Names an agent is likely to use for the detected script. */
const DETECTED_SCRIPT_NAMES = new Set([DETECTED_DEV_SCRIPT_ID, "dev", "dev server"]);

/**
 * Resolves a thread and one of its project's scripts to what the managed
 * process service runs. The checkout is the thread's worktree, or the
 * project's root for a thread that runs in the main checkout. `scriptId`
 * also matches a script's name, which is what an agent is likely to know.
 * Without one, the first dev action is the server. A project with no dev
 * action falls back to the checkout's detected `package.json` dev script.
 */
export const resolveManagedScriptTarget = Effect.fn("resolveManagedScriptTarget")(function* (
  threadId: ThreadId,
  scriptId: string | undefined,
) {
  const projections = yield* ProjectionSnapshotQuery;
  const settings = yield* ServerSettingsService;
  const thread = yield* projections.getThreadShellById(threadId).pipe(Effect.orDie);
  const project = Option.isSome(thread)
    ? yield* projections.getProjectShellById(thread.value.projectId).pipe(Effect.orDie)
    : Option.none();
  if (Option.isNone(thread) || Option.isNone(project)) {
    return yield* new ManagedProcessThreadNotFoundError({ threadId });
  }
  const scripts = resolveProjectScripts(
    yield* settings.getSettings.pipe(Effect.orDie),
    project.value,
  );
  const checkoutPath = thread.value.worktreePath ?? project.value.workspaceRoot;
  const named =
    scriptId === undefined
      ? scripts.find(isDevProjectScript)
      : (scripts.find((candidate) => candidate.id === scriptId) ??
        scripts.find((candidate) => candidate.name.toLowerCase() === scriptId.toLowerCase()));
  const wantsDetected =
    !scripts.some(isDevProjectScript) &&
    (scriptId === undefined || DETECTED_SCRIPT_NAMES.has(scriptId.toLowerCase()));
  const script =
    named ??
    (wantsDetected ? yield* readDetectedDevScript(checkoutPath, yield* HostProcessPlatform) : null);
  if (!script) {
    return yield* new ManagedProcessScriptNotFoundError({
      scriptId: scriptId ?? "",
      availableScripts: scripts.map((candidate) => candidate.name),
    });
  }
  return {
    checkoutPath,
    projectRoot: project.value.workspaceRoot,
    worktreePath: thread.value.worktreePath,
    script: { id: script.id, name: script.name, command: script.command },
  } satisfies ManagedScriptTarget;
});
