# A teammate failed

A teammate in this notice reported `failed`, or errored without a report. Before you
relaunch it, send it new instructions or tell the user, work out why. Read its transcript
with `t3_thread_read` and its reports with `teammate_history`.

Start from what was actually observed, not from an error string or a guess at the cause.
Separate three things and don't collapse them into one label:

- the **trigger**, the event, input or change that started the failure;
- the **mask**, the state, environment, timing, cache or configuration that hides or
  exposes it, which is why a failure can show up only sometimes;
- the **symptom**, what the teammate or the user could actually see.

Compare the failing path with one that works, and find the earliest point where they
differ. Check recent history when it could explain the difference, but don't blame the
latest nearby change without evidence. Name what would disprove your leading
explanation, and look for it.

Then act on what you found:

- **The environment broke and the work is intact,** such as a provider crash, a rate
  limit or a lost connection: `relaunch_teammate`. It resumes in place.
- **The task itself failed,** such as tests failing for a reason outside the spec or an
  approach that doesn't hold: don't just relaunch. If the fix follows from the user's
  intent, send corrected instructions with `t3_thread_send`. If it needs the user's
  call, escalate a decision.
- **A credential or login is missing:** escalate. Only the user can supply it.
- **You can't tell:** ask the teammate for the missing evidence before choosing.

When you need a teammate to dig further, ask for a reproduction on the user's real path,
the trigger, mask and symptom kept separate, the comparison with the working path, the
relevant history, the smallest change that should flip the outcome, and what would prove
the explanation wrong.

Before acting on a teammate's diagnosis, check that its cause explains both the failure
and the working path without leaning on an untested mask. A diagnosis is evidence, not
permission to change code beyond the task. When a fix is in scope, its reproduction
becomes the regression test.

Tell the user only when the failure survives this: what failed, the evidence, what's
preserved, and your recommendation.
