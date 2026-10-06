import { OrchestratorMcpFailure, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as PivotService from "../../../pivot/PivotService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
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

export const PivotToolkitHandlersLive = PivotToolkit.toLayer({
  dispatch_teammate: (input) =>
    asCaller((service, caller) => service.dispatchTeammate(caller, input)),
  promote_scout: (input) => asCaller((service, caller) => service.promoteScout(caller, input)),
  add_intent: (input) => asCaller((service, caller) => service.addIntent(caller, input)),
  open_decision: (input) => asCaller((service, caller) => service.openDecision(caller, input)),
  escalate_decision: (input) =>
    asCaller((service, caller) => service.escalateDecision(caller, input)),
  answer_decision: (input) => asCaller((service, caller) => service.answerDecision(caller, input)),
  mark_decision_moot: (input) =>
    asCaller((service, caller) => service.markDecisionMoot(caller, input)),
  list_teammates: (input) => asCaller((service, caller) => service.listTeammates(caller, input)),
  teammate_history: (input) =>
    asCaller((service, caller) => service.teammateHistory(caller, input)),
  stop_teammate: (input) => asCaller((service, caller) => service.stopTeammate(caller, input)),
  relaunch_teammate: (input) =>
    asCaller((service, caller) => service.relaunchTeammate(caller, input)),
});

export const TeammateToolkitHandlersLive = TeammateToolkit.toLayer({
  report_status: (input) => asCaller((service, caller) => service.reportStatus(caller, input)),
  record_scout_report: (input) =>
    asCaller((service, caller) => service.recordScoutReport(caller, input)),
});
