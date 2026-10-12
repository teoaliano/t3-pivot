# Pivot mode manual tests

A pass through Pivot mode as a user sees it. Each test names the spec story it covers
(`docs/specs/pivot-mode.md`), the steps, and what you should see. Run them in order: later
sections reuse the Pivot and teammates from earlier ones.

A full pass takes about an hour and runs real agents on your subscription. Each Pivot turn
and teammate run is small.

## Setup

1. Start an isolated dev server from the repo root. Never point it at `~/.t3/userdata`:

   ```sh
   node apps/server/scripts/migrate-dev-db.ts --base-dir "$PWD/.t3" --projects 3 --threads-per-project 5
   cp ~/.t3/userdata/settings.json .t3/userdata/settings.json
   node scripts/dev-runner.ts dev --home-dir "$PWD/.t3"
   ```

   Open the `pairingUrl` it prints. Pass `--home-dir` explicitly: in the main checkout the
   runner otherwise uses `~/.t3`.

2. Make two throwaway projects:
   - **Local:** `~/pivot-demo`, a git repo with no remote (`git init -b main`, add
     `src/calc.js` with `add` and `divide`, a `package.json` with `"test": "node --test"`,
     commit). Teammates land here by fast-forward.
   - **Remote (for section 6 only):** a private throwaway GitHub repo you can delete
     afterwards, cloned locally, with one CI check (a GitHub Action that runs `npm test`),
     and branch protection that requires it.

3. Settings → General → **Thread notifications**: Notifications only (or with sound).
   Turn on **In-app notifications**.

4. Add the local project: sidebar → Add project → Local folder → `~/pivot-demo`.

## 1. Creating a Pivot

| #   | Story | Steps                                                                                         | Expect                                                                                                               |
| --- | ----- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1.1 | 1, 2  | On an existing pivot-demo thread, click the sidebar's **New Pivot** icon.                     | The palette opens on "New Pivot in..." with projects only, pivot-demo first. No model picker.                        |
| 1.2 | 1     | Press **⌥⌘P**, then Escape. Open the command palette (⌘K) and type "pivot".                   | The shortcut opens the same picker. The palette shows "New Pivot in pivot-demo" and "New Pivot in...".               |
| 1.3 | 1     | Pick pivot-demo.                                                                              | You land in the new Pivot's chat, not on a blank draft. The sidebar shows the Pivot row with a Pivot strip under it. |
| 1.4 | 5     | Start another Pivot in pivot-demo, cancel the confirmation, then start one again and confirm. | Cancel creates nothing. Confirm replaces it: the old Pivot retires and its teammates and decisions move over.        |
| 1.5 | 3     | Add a folder that is not a git repo as a project, then try New Pivot there.                   | Creation fails with the reason in a toast.                                                                           |
| 1.6 | 22    | Look at the Pivot's right panel and its workspace path.                                       | The workspace is the Pivot home under `.t3/userdata/pivot-homes/<projectId>`, not your project.                      |

## 2. Dispatching work

Send the Pivot: _"Two things. Add a subtract(a, b) function to src/calc.js with a
node:test test. And have a scout look at what divide does when b is 0 and tell me if it's
worth changing; don't change it yet."_

| #    | Story  | Steps                                                                                      | Expect                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---- | ------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | 11, 21 | Wait about 20 seconds.                                                                     | The Pivot reports two teammates started: a ship and a scout, in parallel.                                                                                                                                                                                                                                                                                                                                 |
| 2.2  | 12     | `git -C ~/pivot-demo worktree list`                                                        | Two worktrees on branches `pivot/<slug>`, one per teammate.                                                                                                                                                                                                                                                                                                                                               |
| 2.3  | 64     | Look at the sidebar.                                                                       | The Pivot's own row ends with a Pivot icon, "2 teammates" and a fold chevron, plus "N need you" when any teammate is waiting on you. Expanded, each teammate is one line under it (status dot, title, tag such as "Needs you", "#14" or "Scout"), in dispatch order, with finished ones folded behind "N finished". Teammates are not listed again at top level, and their rows have no Settle or Snooze. |
| 2.3b | 64     | Turn on the legacy sidebar in Settings, then look at the project.                          | Each teammate sits right under its Pivot, indented, in dispatch order. Turn the setting back off afterwards.                                                                                                                                                                                                                                                                                              |
| 2.4  | 13     | Open a teammate from the sidebar.                                                          | The first message is labelled "Sent by the Pivot", collapsed, starting with "Your role". Your words appear verbatim in its intent section, apart from the Pivot's spec. Paragraphs don't break mid-sentence.                                                                                                                                                                                              |
| 2.5  | 16     | Watch the teammate run.                                                                    | It never stops for a permission prompt.                                                                                                                                                                                                                                                                                                                                                                   |
| 2.6  | 17     | In a project with a slow setup script (`sleep 20` in project scripts), dispatch something. | The card shows a setup progress line while the script runs; it disappears after. If the script fails, the Pivot says so.                                                                                                                                                                                                                                                                                  |

## 3. The Pivot view

| #    | Story  | Steps                                                                                                   | Expect                                                                                                                                                                                                      |
| ---- | ------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1  | 65     | Click **Pivot** in the header switch, then **Chat**, then press **⌥⌘V**.                                | Each click toggles the view. Nothing else opens: not the terminal, not the right panel.                                                                                                                     |
| 3.2  | 66     | Switch to the Pivot view and reload.                                                                    | The Pivot reopens in the Pivot view. A different Pivot keeps its own choice.                                                                                                                                |
| 3.3  | 67     | Look at the Pivot view.                                                                                 | No sidebar.                                                                                                                                                                                                 |
| 3.4  | 71, 72 | Look at the cards.                                                                                      | Each card: status dot and label, elapsed time, title, "Scout" or the PR, provider icon. "Needs you" and failure states have a warning border.                                                               |
| 3.5  | 73, 74 | Let one teammate finish and get torn down.                                                              | Cards keep their order. Finished teammates fold into an "N finished" chip that expands and collapses.                                                                                                       |
| 3.6  | 75     | Card ⋯ → View chat, View diff, View files, View preview.                                                | Each opens in a pane whose header names the teammate.                                                                                                                                                       |
| 3.7  | 76     | In the teammate chat pane, look for a composer.                                                         | Read-only (no composer) unless the teammate has a pending approval or question.                                                                                                                             |
| 3.8  | 68     | ⋯ (Pivot view menu) → Layout → try all four presets.                                                    | Each preset applies. In every preset the Pivot chat fills its pane: no narrow column, no one word per line.                                                                                                 |
| 3.9  | 69, 70 | ⋯ → Panes: hide and show panes. Drag a divider. Use a pane's ⋯ → Move to left/right/top/bottom. Reload. | The last visible pane can't be hidden. Size and arrangement survive the reload.                                                                                                                             |
| 3.10 | 78     | ⋯ → Set wallpaper…, pick an image, try the dim levels, then remove it.                                  | The wallpaper shows behind the panes, the cards area is see-through, and removing it restores the plain background. Check whether it is kept per Pivot or per device, and that this matches the user guide. |
| 3.11 | 79     | With 5+ teammates and a wallpaper, scroll and resize.                                                   | No dropped frames, and no constant GPU use while idle (Activity Monitor).                                                                                                                                   |

## 4. Decisions and approvals

| #    | Story  | Steps                                                                          | Expect                                                                                                                                                                                                      |
| ---- | ------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1  | 47, 53 | Wait for the ship to finish.                                                   | The Pivot asks to merge, with the branch name and commit. The ship card reads "Needs you".                                                                                                                  |
| 4.2  | 39, 41 | Look above the Pivot's composer in Chat mode and in the Pivot view.            | The decision shows the question, Evidence, Consequence, Recommended, and the options. It sits above the composer without covering the messages, and everything in it is readable and reachable.             |
| 4.3  | 49     | On the merge decision.                                                         | Approve and Decline buttons, and an optional note. No second set of option chips that duplicates them.                                                                                                      |
| 4.4  | 49, 53 | Click **Approve**.                                                             | `git -C ~/pivot-demo log --oneline main` shows the teammate's commit (fast-forward). The Pivot confirms in a line and tears the teammate down.                                                              |
| 4.5  | 49     | Ask for another change, and **Decline** its merge decision.                    | Nothing lands on main. The Pivot says the branch stays unmerged.                                                                                                                                            |
| 4.6  | 20     | Answer the scout's question with "make divide throw when b is 0, with a test". | The scout is promoted in place (same thread and card), makes the change, and comes back for merge approval.                                                                                                 |
| 4.7  | 42     | Answer a decision with leading or trailing spaces, or several lines.           | `sqlite3 -readonly .t3/userdata/pivot.sqlite "select user_answer from pivot_decisions"` shows your text exactly as typed.                                                                                   |
| 4.8  | 43     | Open the teammate the decision was about.                                      | The Pivot passed your answer on.                                                                                                                                                                            |
| 4.9  | 45     | While a decision is open, ask the Pivot to tear that teammate down.            | The decision stays open until someone answers it.                                                                                                                                                           |
| 4.10 | 44     | In the Pivot view menu, **Panes → Decisions**.                                 | Every decision, newest first. Ones the Pivot answered without you read "The Pivot answered on its own", yours read "You answered" with your exact words. A new decision appears without reopening the pane. |

## 5. Talking to teammates and the Pivot

| #   | Story  | Steps                                                          | Expect                                                                                                                                               |
| --- | ------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1 | 77     | Open a live teammate from the sidebar and type an instruction. | The teammate gets it. The Pivot gets a notice quoting your words ("The user wrote to it directly: …").                                               |
| 5.2 | 36     | Tell the Pivot something new about a running teammate.         | It's added to that teammate's intent verbatim, and the teammate is told.                                                                             |
| 5.3 | 29     | Scroll the Pivot's chat.                                       | Wake notices are collapsed one-liners ("1 teammate changed · 1 decision open"). Their action label makes sense for a teammate (not "Open subagent"). |
| 5.4 | 35     | Ask the Pivot to stop a teammate.                              | The card reads stopped. Stopping doesn't wake the Pivot by itself.                                                                                   |
| 5.5 | 63     | Ask the Pivot to relaunch a stopped or failed teammate.        | Same thread, new run.                                                                                                                                |
| 5.6 | 84, 83 | Tell the Pivot "always use Sonnet for scouts".                 | It writes the rule to `pivot-homes/<projectId>/preferences.md`. Later scouts use it.                                                                 |

## 6. Pull requests (remote project)

Repeat section 2 in the GitHub project.

| #   | Story  | Steps                                                                             | Expect                                                                                                                                                 |
| --- | ------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 6.1 | 47, 48 | Wait for a ship to finish.                                                        | It counts as done only once its PR exists with its latest commit pushed. The Pivot gives you the full PR URL.                                          |
| 6.2 | 52, 50 | Make CI fail on the PR, then approve the merge.                                   | The merge is refused, naming the red check.                                                                                                            |
| 6.3 | 52     | Answer again: "approve, waive <check name>".                                      | The merge goes through with that check red.                                                                                                            |
| 6.4 | 51     | After approving but before the merge, push a commit to the PR branch by hand.     | The merge is refused because the head moved.                                                                                                           |
| 6.5 | 54     | Merge or close a teammate's PR on GitHub yourself.                                | The Pivot hears about it and says so. It doesn't try to merge again.                                                                                   |
| 6.6 | 50     | Required check that never reported (a required check name that no workflow runs). | The merge is refused with `Required check "<name>" has not reported.` (classic branch protection; a check required only by a ruleset isn't named yet). |
| 6.7 | 55     | A project on another forge (Azure DevOps, Bitbucket, Forgejo).                    | The Pivot doesn't merge. It tells you to merge by hand.                                                                                                |

## 7. Notifications

Before each check, focus a different app so the T3 window has no focus (desktop
notifications), or stay in T3 on a different thread (in-app toasts).

| #   | Story | Steps                                                                                                                               | Expect                                                                                                                                     |
| --- | ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 7.1 | 80    | Ask the Pivot something, then switch away.                                                                                          | "Thread completed" when it replies to you.                                                                                                 |
| 7.2 | 80    | Let a teammate finish while you're away.                                                                                            | No "Thread completed" for the Pivot's wake turn, and nothing from the teammate thread.                                                     |
| 7.3 | 80    | Let the Pivot escalate a decision while you're away.                                                                                | "The Pivot needs you" with the Pivot's title. Clicking it opens the Pivot.                                                                 |
| 7.4 | 80    | Let a scout record its report while you're away.                                                                                    | "Scout findings ready" with the scout's title. Clicking it opens the Pivot.                                                                |
| 7.5 | 81    | Throughout.                                                                                                                         | Teammate threads never notify or play a sound for finishing, failing or hitting a limit.                                                   |
| 7.6 | 81    | Dispatch a ship whose task tells it to ask you a question with its question tool first (Claude: AskUserQuestion), then switch away. | "Input needed" with the teammate's title. Clicking it opens the teammate's chat, where you answer it. The sidebar shows it as "Needs you". |
| 7.7 | 82    | With the mobile app paired over the relay, let the Pivot escalate a decision.                                                       | A push on the phone. A teammate finishing sends none.                                                                                      |
| 7.8 | 81    | With the phone paired, repeat 7.6.                                                                                                  | A push for the teammate's question, which clears once you answer it.                                                                       |

## 8. Takeover and retired Pivots

| #   | Story | Steps                                                                  | Expect                                                                                                                                                                                            |
| --- | ----- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.1 | 4     | With a live teammate and an open decision, create another Pivot (⌥⌘P). | The dialog says "This takes over 1 live teammate and 1 open decision…" and the button reads **Take over**.                                                                                        |
| 8.2 | 5     | Click Take over.                                                       | You land in the new Pivot. Its view shows the live teammate and the open decision.                                                                                                                |
| 8.3 | 6     | Open the old Pivot.                                                    | Its composer is replaced by "This Pivot is retired…" with **Open the active Pivot**. In the sidebar its row reads "Retired · N teammates", with its cleaned-up teammates listed as done under it. |
| 8.4 | 7     | Read the new Pivot's first turn.                                       | It names the predecessor and can read its conversation.                                                                                                                                           |
| 8.5 | 8     | Pivot view ⋯ → **New Pivot conversation**.                             | Same takeover flow. The item is hidden on a retired Pivot.                                                                                                                                        |

## 9. Restart

| #   | Story  | Steps                                                                                     | Expect                                                                                                                                                |
| --- | ------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9.1 | 60, 61 | With a teammate mid-run, stop the dev server (Ctrl-C in its terminal) and start it again. | The teammate and the Pivot carry on by themselves. This doesn't depend on the continue-after-update setting.                                          |
| 9.2 | 62     | Restart with every teammate idle, then let one finish.                                    | The Pivot's next update starts "The server restarted since your last wake" and lists every teammate and open decision, not only the one that changed. |
| 9.3 | 60     | Restart while a decision is open and a wake is pending.                                   | Nothing is lost: the decision is still open, and the wake is delivered.                                                                               |
| 9.4 | 54     | Merge a teammate's PR on GitHub while the server is down, then start it.                  | Once T3 syncs the PR, the Pivot hears "Its PR merged outside T3".                                                                                     |

## 10. Mobile

| #    | Story | Steps                              | Expect                                                                                              |
| ---- | ----- | ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| 10.1 | 64    | Open the Pivot on the phone.       | The Pivot reads as a chat and teammates as ordinary threads (no Pivot view on mobile).              |
| 10.2 | 6     | Open a retired Pivot on the phone. | No composer: a bar says it's retired, and **Open the active Pivot** goes to the one that took over. |

## Clean up

- Stop the dev server with Ctrl-C in its terminal.
- Delete `~/pivot-demo` and the throwaway GitHub repo.
- Your real `~/.t3/userdata` was never touched.
