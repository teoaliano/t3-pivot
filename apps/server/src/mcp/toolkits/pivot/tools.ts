import {
  OrchestratorMcpFailure,
  PivotMcpAddIntentInput,
  PivotMcpAnswerDecisionInput,
  PivotMcpControlResult,
  PivotMcpDecisionResult,
  PivotMcpDispatchTeammateInput,
  PivotMcpDispatchTeammateResult,
  PivotMcpEscalateDecisionInput,
  PivotMcpListTeammatesInput,
  PivotMcpListTeammatesResult,
  PivotMcpMarkDecisionMootInput,
  PivotMcpOpenDecisionInput,
  PivotMcpPromoteScoutInput,
  PivotMcpRecordScoutReportInput,
  PivotMcpRecordScoutReportResult,
  PivotMcpReportStatusInput,
  PivotMcpReportStatusResult,
  PivotMcpTeammateHistoryInput,
  PivotMcpTeammateHistoryResult,
  PivotMcpTeammateResult,
  PivotMcpTeammateTarget,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/ai";

import * as PivotService from "../../../pivot/PivotService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const pivotTool = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [McpInvocationContext.McpInvocationContext, PivotService.PivotService],
};

const PIVOT_ONLY = "Pivot only.";
const TEAMMATE_ONLY = "Teammates of a Pivot only.";

const DispatchTeammateTool = Tool.make("dispatch_teammate", {
  ...pivotTool,
  description: `${PIVOT_ONLY} Start a teammate on one task in its own worktree and branch, from the origin's default branch or baseBranch. intent is the user's words verbatim, spec your instructions. Returns once its first run started or failed.`,
  parameters: PivotMcpDispatchTeammateInput,
  success: PivotMcpDispatchTeammateResult,
}).annotate(Tool.Title, "Dispatch a teammate");

const PromoteScoutTool = Tool.make("promote_scout", {
  ...pivotTool,
  description: `${PIVOT_ONLY} Turn a scout into a ship in place, keeping its worktree and context, with a new spec. The original intent carries over.`,
  parameters: PivotMcpPromoteScoutInput,
  success: PivotMcpTeammateResult,
}).annotate(Tool.Title, "Promote a scout");

const AddIntentTool = Tool.make("add_intent", {
  ...pivotTool,
  description: `${PIVOT_ONLY} Record the user's new words for a running teammate verbatim on its intent and send them, with your own text, after its turn.`,
  parameters: PivotMcpAddIntentInput,
  success: PivotMcpTeammateResult,
}).annotate(Tool.Title, "Add to a teammate's intent");

const OpenDecisionTool = Tool.make("open_decision", {
  ...pivotTool,
  description: `${PIVOT_ONLY} Open a decision of your own, optionally about one teammate. Every wake lists open decisions until one closes.`,
  parameters: PivotMcpOpenDecisionInput,
  success: PivotMcpDecisionResult,
}).annotate(Tool.Title, "Open a decision");

const EscalateDecisionTool = Tool.make("escalate_decision", {
  ...pivotTool,
  description: `${PIVOT_ONLY} Hold an open decision for the user, with its questions, evidence, consequence, options and recommendation. It notifies the user.`,
  parameters: PivotMcpEscalateDecisionInput,
  success: PivotMcpDecisionResult,
}).annotate(Tool.Title, "Escalate a decision");

const AnswerDecisionTool = Tool.make("answer_decision", {
  ...pivotTool,
  description: `${PIVOT_ONLY} Answer an open decision: the answer goes to its teammate, then the decision closes. Refused while it waits for the user's answer.`,
  parameters: PivotMcpAnswerDecisionInput,
  success: PivotMcpDecisionResult,
}).annotate(Tool.Title, "Answer a decision");

const MarkDecisionMootTool = Tool.make("mark_decision_moot", {
  ...pivotTool,
  description: `${PIVOT_ONLY} Close a decision that no longer matters, with the evidence. Recorded as not the user's words.`,
  parameters: PivotMcpMarkDecisionMootInput,
  success: PivotMcpDecisionResult,
}).annotate(Tool.Title, "Close a moot decision");

const ListTeammatesTool = Tool.make("list_teammates", {
  ...pivotTool,
  description: `${PIVOT_ONLY} One line per teammate: title, kind, status, latest summary, branch, PR, last change and worktree.`,
  parameters: PivotMcpListTeammatesInput,
  success: PivotMcpListTeammatesResult,
})
  .annotate(Tool.Title, "List teammates")
  .annotate(Tool.Readonly, true);

const TeammateHistoryTool = Tool.make("teammate_history", {
  ...pivotTool,
  description: `${PIVOT_ONLY} A teammate's status reports, status changes and decisions, newest first. Page back with beforeSequence.`,
  parameters: PivotMcpTeammateHistoryInput,
  success: PivotMcpTeammateHistoryResult,
})
  .annotate(Tool.Title, "Read a teammate's history")
  .annotate(Tool.Readonly, true);

const StopTeammateTool = Tool.make("stop_teammate", {
  ...pivotTool,
  description: `${PIVOT_ONLY} Stop a teammate: interrupt its turn, hold its queue and end its session. Its worktree and history stay.`,
  parameters: PivotMcpTeammateTarget,
  success: PivotMcpControlResult,
})
  .annotate(Tool.Title, "Stop a teammate")
  .annotate(Tool.Destructive, true);

const RelaunchTeammateTool = Tool.make("relaunch_teammate", {
  ...pivotTool,
  description: `${PIVOT_ONLY} Restart a dead or wedged teammate in place: end its session and resume the conversation in a new one. Retries a launch whose setup failed. Reports a failed start.`,
  parameters: PivotMcpTeammateTarget,
  success: PivotMcpControlResult,
})
  .annotate(Tool.Title, "Relaunch a teammate")
  .annotate(Tool.Destructive, true);

export const PivotToolkit = Toolkit.make(
  DispatchTeammateTool,
  PromoteScoutTool,
  AddIntentTool,
  OpenDecisionTool,
  EscalateDecisionTool,
  AnswerDecisionTool,
  MarkDecisionMootTool,
  ListTeammatesTool,
  TeammateHistoryTool,
  StopTeammateTool,
  RelaunchTeammateTool,
);

const ReportStatusTool = Tool.make("report_status", {
  ...pivotTool,
  description: `${TEAMMATE_ONLY} Tell the Pivot where your task stands: working (with a phase line), needs-decision, blocked, paused (with until when known), done or failed. End every turn with a report.`,
  parameters: PivotMcpReportStatusInput,
  success: PivotMcpReportStatusResult,
}).annotate(Tool.Title, "Report status to the Pivot");

const RecordScoutReportTool = Tool.make("record_scout_report", {
  ...pivotTool,
  description: `${TEAMMATE_ONLY} Scouts: record your findings as a report that stands on its own. It is kept after your worktree is removed.`,
  parameters: PivotMcpRecordScoutReportInput,
  success: PivotMcpRecordScoutReportResult,
}).annotate(Tool.Title, "Record a scout report");

export const TeammateToolkit = Toolkit.make(ReportStatusTool, RecordScoutReportTool);
