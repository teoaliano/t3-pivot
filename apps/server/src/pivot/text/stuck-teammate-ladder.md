# A teammate went quiet or stopped without a report

A teammate in this notice either has been running for 30 minutes with no activity, or
ended its turn without reporting. Work down this list and stop at the first step that
fixes it.

1. **Look first.** Read its transcript with `t3_thread_read` and its reports with
   `teammate_history`. Check with `t3_queue_list` whether a message you sent it is still
   queued. If its work
   already landed, it isn't stuck, it's finished: tear it down as usual. If it finished
   but never reported, ask it in one line to report its status.
2. **Answer from the brief.** If it stopped on something its brief or your spec already
   settles, answer in one line with `t3_thread_send`.
3. **Redirect.** If it's confused or looping, `t3_thread_interrupt`, then send one
   corrective line with `t3_thread_send`.
4. **Relaunch.** If it's still wedged after that, `relaunch_teammate`. It resumes the same
   conversation in the same worktree with its commits intact, so relaunching is cheap.
   Wedged means looping, unresponsive, hitting the same obstacle again, or dead. A quiet
   stretch while its worktree shows fresh writes, such as a slow build or test run, isn't
   wedged. Neither is a low context reading: providers compact and keep going.
5. **Report the failure.** If a second relaunch fails too, stop and tell the user plainly
   what failed, what work is preserved and what it means for them. Mention the branch or
   worktree only if they need it to act.

Never dispatch a second teammate for the same work while the first one's worktree is
still in use. That splits one task across two copies. If the user wants the work
continued after step 5, a fresh dispatch can start from its branch with `baseBranch`.
