import { assert, describe, it } from "@effect/vitest";

import { forgeMergeRefusal } from "./ShellForgeGuard.ts";

const refused = (command: string) => forgeMergeRefusal(command) !== null;

describe("ShellForgeGuard", () => {
  it("refuses a teammate's gh pr merge and close, however it is wrapped", () => {
    for (const command of [
      "gh pr merge 12 --squash",
      "gh pr merge --auto",
      "gh pr close 12",
      "gh pr merge -R o/r 12",
      "cd x && gh pr merge 12",
      "FOO=1 gh pr merge 12",
      "sudo -u me gh pr merge 12",
      "/usr/bin/gh pr merge 12",
      "bash -c 'gh pr merge 12'",
      'sh -c "git push && gh pr merge 12"',
      'echo "$(gh pr merge 12)"',
      "gh pr list | head; gh pr close 3",
      "glab mr merge 4",
      "glab mr close 4",
    ]) {
      assert.isTrue(refused(command), command);
    }
  });

  it("refuses a teammate's forge merge and close calls", () => {
    for (const command of [
      "gh api -X PUT repos/o/r/pulls/12/merge",
      "gh api repos/o/r/pulls/12/merge --method PUT -f merge_method=squash",
      "gh api -X PATCH repos/o/r/pulls/12 -f state=closed",
      "gh api -X PATCH repos/o/r/issues/12 -f state=closed",
      "gh api graphql -f query='mutation { mergePullRequest(input:{pullRequestId:\"x\"}) { clientMutationId } }'",
      "gh api graphql -f query='mutation { enablePullRequestAutoMerge(input:{pullRequestId:\"x\"}) { clientMutationId } }'",
      "curl -X PUT -H 'Authorization: token t' https://api.github.com/repos/o/r/pulls/12/merge",
      'curl -X PATCH -d \'{"state":"closed"}\' https://api.github.com/repos/o/r/pulls/12',
      "curl -X PUT https://gitlab.com/api/v4/projects/9/merge_requests/4/merge",
      "curl --request PUT --data state_event=close https://gitlab.com/api/v4/projects/9/merge_requests/4",
      "glab api -X PUT projects/9/merge_requests/4/merge",
      "git push -o merge_request.merge_when_pipeline_succeeds origin HEAD",
      "python3 -c \"import requests; requests.put('https://api.github.com/repos/o/r/pulls/1/merge')\"",
    ]) {
      assert.isTrue(refused(command), command);
    }
  });

  it("names the Pivot as the one who merges in a teammate's refusal", () => {
    assert.include(forgeMergeRefusal("gh pr merge 1")!, "The Pivot reviews every PR");
    assert.include(forgeMergeRefusal("gh pr close 1")!, "report_status");
  });

  it("lets a teammate create PRs, push and read PR state", () => {
    {
      for (const command of [
        "gh pr create --title 'fix' --body 'Do not run gh pr merge here'",
        'gh pr create --body "After review the Pivot runs gh pr merge 12"',
        "git push -u origin HEAD",
        "gh pr view 12 --json state,mergeable",
        "gh pr list --state closed",
        "gh pr checks 12",
        "gh pr diff 12",
        "gh pr ready 12",
        "gh pr edit 12 --title t",
        "gh issue close 3",
        "gh api repos/o/r/pulls/12 --jq .state",
        "gh api 'repos/o/r/pulls?state=closed'",
        "gh api repos/o/r/pulls/12/comments",
        "curl https://api.github.com/repos/o/r/pulls/12",
        "curl 'https://api.github.com/repos/o/r/pulls?state=closed'",
        "glab mr view 4",
        "glab mr create --fill",
        "git commit -m 'document the gh pr merge refusal'",
        "git merge main",
        "grep -rn 'gh pr merge' docs",
      ]) {
        assert.isFalse(refused(command), command);
      }
    }
  });
});
