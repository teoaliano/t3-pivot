import { OrchestratorMcpFailure, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as PivotService from "../../../pivot/PivotService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { PivotToolkit, TeammateToolkit } from "./tools.ts";

const toFailure = (error: PivotService.PivotServiceError) =>
  new OrchestratorMcpFailure({
    code:
      error._tag === "PivotCallerError"
        ? "capability_denied"
        : error._tag === "PivotRefusedError"
          ? "invalid_request"
          : "orchestration_error",
    message: error.message,
  });

/** Runs a Pivot service method as the calling thread. Credentials from outside T3 have none. */
const asCaller = <A>(
  run: (
    service: PivotService.PivotService["Service"],
    caller: ThreadId,
  ) => Effect.Effect<A, PivotService.PivotServiceError>,
) =>
  Effect.gen(function* () {
    const scope = yield* McpInvocationContext.McpInvocationContext;
    if (scope.thread === undefined) {
      return yield* new OrchestratorMcpFailure({
        code: "thread_credential_required",
        message: "Pivot and teammate tools are only for threads T3 launched.",
      });
    }
    const service = yield* PivotService.PivotService;
    return yield* run(service, scope.thread.threadId).pipe(Effect.mapError(toFailure));
  });

const pivotHandlers = {
  dispatch_teammate: McpToolAccess.actsAsCaller((input) =>
    asCaller((service, caller) => service.dispatchTeammate(caller, input)),
  ),
  promote_scout: McpToolAccess.actsAsCaller((input) =>
    asCaller((service, caller) => service.promoteScout(caller, input)),
  ),
  add_intent: McpToolAccess.actsAsCaller((input) =>
    asCaller((service, caller) => service.addIntent(caller, input)),
  ),
  open_decision: McpToolAccess.actsAsCaller((input) =>
    asCaller((service, caller) => service.openDecision(caller, input)),
  ),
  escalate_decision: McpToolAccess.actsAsCaller((input) =>
    asCaller((service, caller) => service.escalateDecision(caller, input)),
  ),
  answer_decision: McpToolAccess.actsAsCaller((input) =>
    asCaller((service, caller) => service.answerDecision(caller, input)),
  ),
  mark_decision_moot: McpToolAccess.actsAsCaller((input) =>
    asCaller((service, caller) => service.markDecisionMoot(caller, input)),
  ),
  list_teammates: McpToolAccess.readsAsCaller((input) =>
    asCaller((service, caller) => service.listTeammates(caller, input)),
  ),
  teammate_history: McpToolAccess.readsAsCaller((input) =>
    asCaller((service, caller) => service.teammateHistory(caller, input)),
  ),
  stop_teammate: McpToolAccess.actsAsCaller((input) =>
    asCaller((service, caller) => service.stopTeammate(caller, input)),
  ),
  relaunch_teammate: McpToolAccess.actsAsCaller((input) =>
    asCaller((service, caller) => service.relaunchTeammate(caller, input)),
  ),
  merge_teammate: McpToolAccess.actsAsCaller((input) =>
    asCaller((service, caller) => service.mergeTeammate(caller, input)),
  ),
  land_teammate: McpToolAccess.actsAsCaller((input) =>
    asCaller((service, caller) => service.landTeammate(caller, input)),
  ),
  teardown_teammate: McpToolAccess.actsAsCaller((input) =>
    asCaller((service, caller) => service.teardownTeammate(caller, input)),
  ),
} satisfies McpToolAccess.Handlers<typeof PivotToolkit.tools>;

const teammateHandlers = {
  report_status: McpToolAccess.actsAsCaller((input) =>
    asCaller((service, caller) => service.reportStatus(caller, input)),
  ),
  record_scout_report: McpToolAccess.actsAsCaller((input) =>
    asCaller((service, caller) => service.recordScoutReport(caller, input)),
  ),
} satisfies McpToolAccess.Handlers<typeof TeammateToolkit.tools>;

export const layerPivot = McpToolAccess.toLayer(PivotToolkit, pivotHandlers);
export const layerTeammate = McpToolAccess.toLayer(TeammateToolkit, teammateHandlers);
