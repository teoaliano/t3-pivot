import type { PullRequestCheck } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { mergeRefusals } from "./pivotDelivery.ts";

const check = (name: string, status: PullRequestCheck["status"]): PullRequestCheck => ({
  name,
  status,
  description: null,
  url: null,
});

const detail = (
  checks: ReadonlyArray<PullRequestCheck>,
  requiredChecks?: ReadonlyArray<string>,
): Parameters<typeof mergeRefusals>[0] => ({
  state: "open",
  isDraft: false,
  mergeability: "mergeable",
  headSha: "abc123",
  checks,
  ...(requiredChecks === undefined ? {} : { requiredChecks }),
});

describe("mergeRefusals", () => {
  it("names a required check that has never reported", () => {
    expect(mergeRefusals(detail([check("test", "success")], ["ci/build", "test"]), [])).toEqual([
      'Required check "ci/build" has not reported.',
    ]);
  });

  it("lets a required check that has not reported through when the user waived it", () => {
    expect(mergeRefusals(detail([], ["ci/build"]), ["ci/build"])).toEqual([]);
  });

  it("passes a required check that reported green", () => {
    expect(mergeRefusals(detail([check("ci/build", "success")], ["ci/build"]), [])).toEqual([]);
  });

  it("judges the reported checks alone where the forge does not say what is required", () => {
    expect(mergeRefusals(detail([check("ci/build", "pending")]), [])).toEqual([
      'Check "ci/build" is pending.',
    ]);
    expect(mergeRefusals(detail([]), [])).toEqual([]);
  });
});
