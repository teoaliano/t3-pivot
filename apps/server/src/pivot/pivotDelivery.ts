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
 * when it passed or was skipped at the current head; a pending one, including a
 * required check that has not reported, is not. `waivedChecks` names checks the
 * user explicitly let through.
 */
export const mergeRefusals = (
  detail: Pick<PullRequestDetail, "state" | "isDraft" | "mergeability" | "headSha" | "checks">,
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
  for (const name of waived) {
    if (!detail.checks.some((check) => check.name === name)) {
      reasons.push(`No check named "${name}" to waive.`);
    }
  }
  return reasons;
};
