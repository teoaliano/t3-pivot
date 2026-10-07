/**
 * The delivery gate's judgments, pure: whether a PR may merge, and which
 * forges the Pivot merges on.
 */
import type { PullRequestCheck, PullRequestDetail } from "@t3tools/contracts";

/** The forges the Pivot merges on. Elsewhere the user merges by hand. */
export const PIVOT_MERGE_PROVIDERS: ReadonlySet<string> = new Set(["github", "gitlab"]);

const GREEN: ReadonlySet<PullRequestCheck["status"]> = new Set(["success", "skipped", "neutral"]);

/**
 * Every reason the PR may not merge now, empty when it may. A check is green only
 * when it passed or was skipped at the current head; a pending one is not, and
 * neither is a check in `requiredChecks` that has not reported at all, which the
 * forge leaves out of `checks`. `waivedChecks` names checks the user explicitly
 * let through, reported or required.
 */
export const mergeRefusals = (
  detail: Pick<
    PullRequestDetail,
    "state" | "isDraft" | "mergeability" | "headSha" | "checks" | "requiredChecks"
  >,
  waivedChecks: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const reasons: Array<string> = [];
  if (detail.state !== "open") reasons.push(`The PR is ${detail.state}.`);
  if (detail.isDraft) reasons.push("The PR is a draft.");
  if (detail.mergeability !== "mergeable") {
    reasons.push(
      detail.mergeability === "conflicting"
        ? "The PR has merge conflicts."
        : "The forge has not confirmed the PR is mergeable yet.",
    );
  }
  if (detail.headSha === undefined) {
    reasons.push("The forge did not report the PR's head commit, so the merge cannot be pinned.");
  }
  const waived = new Set(waivedChecks);
  for (const check of detail.checks) {
    if (GREEN.has(check.status) || waived.has(check.name)) continue;
    reasons.push(
      `Check "${check.name}"${check.required === true ? " (required)" : ""} is ${check.status}.`,
    );
  }
  const reported = new Set(detail.checks.map((check) => check.name));
  const required = detail.requiredChecks ?? [];
  for (const name of required) {
    if (reported.has(name) || waived.has(name)) continue;
    reasons.push(`Required check "${name}" has not reported.`);
  }
  for (const name of waived) {
    if (!reported.has(name) && !required.includes(name)) {
      reasons.push(`No check named "${name}" to waive.`);
    }
  }
  return reasons;
};
