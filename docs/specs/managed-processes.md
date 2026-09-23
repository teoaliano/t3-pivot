# Managed processes

Synthesized from `.scratch/dev-server-lifecycle/map.md` and its eleven resolved decision
tickets. Those tickets hold the reasoning, the rejected alternatives, and the existing code
each decision reuses. `docs/internals/managed-processes.md` holds the durable prose.
`CONTEXT.md` defines the vocabulary used throughout.

## Problem statement

You run several checkouts at once. Agents work in some of them, you work in others. Each
one needs its dev server running at the moment somebody looks at it.

Three things go wrong today.

A port number says nothing about which checkout is behind it. Two checkouts both default
to 5173, so the second one to start either fails or slides to another number nobody
records. The preview then shows you one checkout's application while you believe you are
looking at another. You approve a change you never saw.

Nothing owns a dev server's lifetime. Starting one means typing a command in a terminal.
Stopping it means remembering which terminal. Removing a worktree leaves its server
running against deleted code. A server killed alongside the app keeps its port until you
reboot.

Nothing stops what nobody is using. Ten checkouts with ten dev servers is ten compilers
and ten file watchers on one laptop, most of them serving nobody.

## Solution

A managed process is a long-running project script owned by a checkout: a dev server, a
watch task, anything that does not exit on its own.

Every checkout reserves a block of ten ports for its lifetime. Two checkouts can never
contend for a number, so the preview always points at the right application.

Starting and stopping is one control. An agent starts its own when it needs to look at
something. You press a button. The preview waits until the server answers, then opens.

Anything nobody has wanted for thirty minutes stops. A person looking at the preview
counts. An agent working in the checkout counts. Pinning a process exempts it.

## User stories

1. As a developer, I want each checkout to get its own ports, so that two dev servers never
   contend for one number.
2. As a developer, I want a bookmarked preview URL to keep pointing at the same checkout,
   so that a tab I left open yesterday still shows the work I think it shows.
3. As a developer, I want to start a dev server with one control, so that I do not have to
   remember a command or which terminal ran it.
4. As a developer, I want to stop it with the same control, so that stopping is as easy as
   starting.
5. As a developer, I want to see which of my checkouts have a server running, so that I can
   tell at a glance what is consuming the machine.
6. As a developer, I want a stopped process to stay visible with an offer to start it, so
   that I can restart it without hunting for the command.
7. As a developer, I want the preview to open only once the server can answer, so that I
   never see a connection error that fixes itself on reload.
8. As a developer, I want a server nobody is using to stop on its own, so that ten idle
   checkouts do not sit on my RAM.
9. As a developer, I want a server I am actively previewing never to stop underneath me, so
   that watching a page is enough to keep it alive.
10. As a developer, I want my dev server to survive unplugging my laptop, so that going to
    battery does not kill my work.
11. As a developer, I want to pin a server so it is never stopped automatically, so that I
    can keep one running while I work outside the app.
12. As a developer, I want a pinned server to be visibly pinned, so that it never looks
    like something leaked.
13. As a developer, I want removing a worktree to stop its servers first, so that nothing
    keeps serving deleted code.
14. As a developer, I want a server orphaned by a crashed app to be found and stopped on
    the next start, so that its port is not held until I reboot.
15. As a developer, I want a process that is not mine to be left alone, so that this app
    never kills work from a session it cannot see.
16. As a developer, I want to be told which checkout is holding a port I expected, so that
    a conflict names the culprit instead of saying the port is in use.
17. As a developer, I want a conflict to offer me a new block rather than offering to kill
    the other process, so that the safe option is the default one.
18. As a developer, I want my project to work without editing its config or adding an action,
    so that pressing start on a fresh clone just works.
19. As a developer, I want the assigned port available to my dev command, so that I can
    pass it explicitly when my project needs that.
20. As a developer, I want my project's own port setting to keep winning, so that adopting
    this does not override what I already configured.
21. As a developer, I want two threads in one checkout to share one server, so that opening
    a second thread does not start a duplicate.
22. As a developer, I want each thread to have its own preview tab, so that two people or
    agents can look at the same application independently.
23. As a developer, I want a server started outside the app to still show up, so that this
    feature does not hide what I already had.
24. As a developer, I want the preview to prefer the managed server when there is one, so
    that I am not asked to choose between a definite answer and a guess.
25. As a developer, I want the preview switch in my project file to finally work, so that
    a setting I turned on does something.
26. As a developer, I want my project file to keep validating against the published schema,
    so that using this fork does not fork my repository's config.
27. As an agent, I want to start a dev server for my own checkout, so that I can verify my
    change without waiting for a human.
28. As an agent, I want my server to keep running while my turn is live, so that it is not
    stopped in the middle of my work.
29. As an agent, I want my server to still be running on my next turn, so that I do not pay
    a full rebuild every turn.
30. As an agent, I want a port conflict to tell me my new port, so that I can proceed
    without knowing anything about other checkouts.
31. As an agent, I want no detail about other checkouts, so that my context stays about my
    own task.
32. As a developer, I want a reaped server never to restart on a timer, so that a broken
    build does not loop in the background.
33. As a developer, I want a pinned server that crashed to stay stopped and say so, so that
    I see the failure rather than a restart loop hiding it.
34. As a developer, I want reservations for deleted checkouts freed, so that cycling
    worktrees does not exhaust the range.
35. As a developer, I want a reconnecting client to show the truth immediately, so that a
    reload never shows stale state.
36. As a developer, I want nothing about this written to the durable event history, so that
    a feature about running processes does not permanently widen the data model.

## Implementation decisions

### Ownership and identity

A managed process is owned by a checkout, not a thread. The owning key is the thread's
worktree path when it has one, and the project's workspace root when it does not. The
default thread mode runs in the main checkout, so excluding it would exclude most usage.

Records are per checkout and script. Port reservations are per checkout. The grains differ
so that a block guarantees no two checkouts collide however many scripts each runs, while
a per-script record keeps start, stop and reap operating on the single thing a user
pressed.

Threads are borrowers. Deleting a thread releases a borrow and never stops the process.

### State lives in two tiers, and the event log is not one of them

The live process, its scope, its borrower count, its status and its exit watcher are held
in memory by a service and forgotten when the server restarts. This matches the rule the
rest of the server already applies: state describing a live process is memory-only.

Port reservations, pins, and the process identity needed for orphan recovery live in one
global sidecar file written atomically and carrying its own version. It sits beside the
worktrees directory rather than under the per-mode state directory, because a reservation
is keyed on a checkout path and worktrees are shared across state directories. Storing it
per state directory would let two instances allocate the same ports.

Nothing is event-sourced. A new persisted entity touches the three largest modules in the
server, persisted events carry no schema version, and adding one is permanent. That is the
wrong commitment for state whose subject is a process that dies.

Process lifetime is ephemeral. Port identity is durable. A restart kills managed processes
and frees their ports, and the checkout keeps its block.

### Ports are reserved, not observed

Each checkout reserves ten contiguous ports from 11000 to 12999. The range clears the ports
project configs default to, and sits below every operating system ephemeral range so the
kernel never hands out a reserved number. The base is configurable but undocumented.

A reservation is held for the checkout's lifetime whether or not anything is listening. A
registry knows what is claimed. Listing sockets knows only what is listening, which is a
strict subset. Allocating by observation is what produces the stolen-port failure.

Reservations key on checkout path, and path reuse inherits the block. Paths are
deterministic from the branch name, and recreating a vanished worktree at its original
path is existing deliberate behaviour.

Claiming is idempotent and happens on use, not only at creation. Some paths obtain a
worktree without creating one and some recreate one automatically, so any creation-hook
scheme has gaps. Creation is also hooked, only so the reservation usually exists first.

On conflict, refuse. Naming the occupant and offering to reallocate the checkout's block
is the response. Sliding to the next free port is the failure this design prevents.

Reservations are released when a checkout is removed, plus an hourly reconcile that frees
any whose path no longer exists.

### Attribution reads no working directory

Identifying our own process is a lookup against the record, not an investigation. Blocks
make collision between managed processes impossible, so the failure that working-directory
checks exist to detect cannot occur among them.

Reading a process working directory is also unavailable. Nothing in the codebase does it,
the port scanner documents its command form as the only one relied on, and Windows exposes
no cheap way to read another process's working directory. A POSIX-only version was rejected
because the same feature would answer on two platforms and silently fail on the third.

An unknown occupant is named from its process name and its command line. Both work
everywhere today.

Attribution runs before a start, to check the reserved port is free, and once after boot,
to confirm what came up is ours on the port requested. Not on every scan.

Never stop a process we did not start. This is absolute and holds even behind a
confirmation prompt. It does not contradict orphan reaping, where the process id comes from
a record written at spawn and is verified by liveness and command line.

### Processes run in terminals

Not as directly spawned children. Output, scrollback and typing are then free, and
scrollback already persists. The recorded process id belongs to the shell rather than the
server underneath it, which is acceptable because stopping the shell already stops the
server.

That was measured, not assumed. The shell is a session leader, so its death makes the
kernel signal the whole foreground process group. An ordinary dev server dies with it. Two
kinds of child survive: one that moves itself into a new session, and one that ignores the
hangup signal. Neither is normal dev server behaviour.

So there is no process-group killing. A stop uses the existing terminal teardown, then
confirms the reserved port was released, and escalates only if it was not, using the
descendant process ids the terminal layer already tracks. Killing a whole process group
would be more dangerous, since the group belongs to a shell and may contain processes
nobody here started.

Removing a checkout stops its managed processes first, as part of removal rather than a
courtesy. One code path already performs the correct ordering when a thread is deleted.
That ordering becomes one helper, and every remover calls it.

A process can outlive the server that started it. The record written at spawn is re-read at
the next start, and a process is stopped only when its process id is still alive, its
command line still matches, and it still holds the recorded port. All three, because
process ids are reused.

### Demand is a person looking or an agent working

Never client presence on its own. With no client connected the existing activity record is
empty, so a lease keyed on it would let a headless agent's server be reaped mid-work.

Declared demand reuses the server's existing record of what each connected client is
watching, by adding one more scope to its fixed list. That record already expires claims on
a timer, sweeps expired ones, and drops a client's claims when its connection closes. A
preview registers a claim there against its checkout. Building a separate claim register
was rejected: it would need its own expiry, and a release that never ran would leave a
process nothing could stop.

Read that record through the plain presence check, never the one the other consumers use.
The common one also returns false when the machine is locked, thermally stressed, in low
power mode, on battery, or when the window is not focused. Those rules are right for
refreshing a status panel. For a dev server they would mean unplugging the laptop stops
your server.

Inferred demand is never declared. At sweep time a process is in use if any thread whose
checkout matches has a running turn or live background work. Those fields are already
denormalized onto the thread projection row and already read by three other reapers. The
agent case therefore needs no claim plumbing at all and keeps working with no client
attached.

### Starting and stopping

Agents start managed processes automatically. People do not. An agent that needs to check
something in a browser cannot wait for a person, and an agent inside a turn is the one
caller for which a multi-minute compile is acceptable. For a person, a preview with no
running process shows an empty state and a start button, so glancing at a preview never
triggers an unexplained wait.

The service interface is start, stop, stop-all-for-checkout, pin, borrow, stream and sweep.
Start is idempotent and serves both the human button and agent auto-start. A borrow
combinator alone was rejected: three of the four entry points outlive any single caller's
scope.

Starting explicitly grants no protection from reaping. Otherwise idle shutdown would never
fire in the common case, because most processes are started deliberately. The only
protection is a pin, which is persisted user intent following the existing override that
removes a thread from automatic settlement.

When the last claim drops a process becomes reapable, not dead. A pinned process that exits
on its own stays dead and is surfaced as stopped. There is no restart policy, because a dev
server usually exits when the code does not compile, and restarting it in a loop produces
noise instead of progress.

### Reaping

A sweep every five minutes stops any managed process idle for thirty minutes. Both numbers
match the existing provider session reaper, and the structure copies it: a fixed schedule
that runs whether or not anyone is connected, a cheap timestamp filter before the expensive
query, and a debug log naming why anything was skipped.

Thirty minutes is deliberately long. An agent that starts a process for one turn must find
it running at the start of the next.

The numbers are constants with a test-only override, not a setting. The existing session
reaper has none, and the user-configurable retention controls work in days, so minutes
would need a new control as well as a new setting.

Exemptions: a borrowing thread with a running turn, a borrowing thread with live background
work, a live client claim, and a pin.

Nothing notifies the user. Both existing reapers log only, and the one automatic action
that is surfaced needed a durable event this feature avoids. Visibility comes from the
process appearing as stopped and startable.

Freeing reservations for missing checkouts is separate work on the hourly disk cadence,
because it only rewrites a file.

### Which server a preview points at

Order: the checkout's managed process, then a preview URL declared in the project file,
then a scanned server, then recent history. A running managed process is this checkout's
server. Everything else is inference. This introduces precedence where none exists today.

The preview waits for the server to answer before navigating. The readiness signal already
exists and is reused rather than rebuilt: the port scanner publishes a port only after an
HTTP probe returns HTML or a redirect to it, so appearing in discovery is the signal. Do
not navigate until the port appears there.

The agent path is unchanged and gets nothing new. Agents already read the server's own
ready line from the terminal, then navigate, then wait on page conditions. Recording this
so nobody later adds agent-side waiting that duplicates a loop the agent already runs.

Two threads in one checkout get independent preview tabs against the same process. Each
holds its own claim.

A stopped managed process still appears, as a row offering to start it. This differs from a
project-file preview URL, which vanishes whenever nothing is listening. The difference is
deliberate: a managed process is a named thing with a known owner and a reserved port.

Running reserved ports are merged into discovery server-side from the registry. Not through
the client's configured-URL list, whose set is fixed for a subscription's lifetime and
which originates on the client.

### The project file

A declared preview URL stays a discovery hint and nothing more. It has one consumer and has
never opened anything. Precedence means it stops mattering once a checkout has a managed
process. No migration of a file that lives in the user's repository.

The switch for opening the preview automatically is honoured, because this work builds the
only machinery that could. Verified inert first: it is declared, editable, saved, published
in the schema, and read by nothing. Honouring it does not contradict the rule that a
preview never starts a process for a person. The person started the process. The preview
follows once the server answers.

The fork publishes no schema of its own. Every field this fork adds is optional, so a file
written for either side validates on the other. Revisit only on a structural divergence,
never for a behavioural difference.

### Reaching the command

Environment variables only. No placeholder syntax. The codebase has no templating
convention anywhere, so a placeholder means a parser, escaping rules and validation for an
out-of-range index, invented for a job the shell already does. The command field is already
a raw shell string that is not portable today, so a placeholder would fix a fraction of a
problem the field already has.

The existing helper that injects the project root and worktree path into a script run gains
the ports:

- the first port of the checkout's block, under a managed-port name
- the remaining nine, numbered
- the bare `PORT`, set to the first port

The bare name is set because most frameworks read it with no configuration, and the failure
without it is silent: an untouched project comes up on its own default, the preview looks
at the reserved port, finds nothing, and shows an empty page with no indication why. A
project that sets the name itself still wins, because its own environment file is loaded
after the process environment is inherited, and the helper spreads caller-supplied values
last.

The name used by the app's own server port is already taken and is not reused.

### A checkout with no dev action still gets one

A fresh repository has no project actions, and a person should not have to write one before
pressing start. An agent should not either: without one, the start tool has nothing to run
and the agent falls back to its own shell, which gets no reserved port and is never
stopped.

So when the project declares no dev action, the checkout's `package.json` supplies one.
Its `dev` script becomes a detected dev script, run with the package manager its lockfile
names. A project action always wins over it, and it is never written into the user's
settings or project file.

Because the preview must land on the reserved port, the detected command also passes the
port as a flag to the few dev tools known to ignore `PORT` and accept `--port`, with
`--strictPort` for Vite so a taken port fails rather than slides. This is the one place T3
builds a command. It never edits a command the user wrote.

This narrows the charting rule against framework detection rather than breaking it. T3
looks up one script name in one file and matches the first word of that script against a
short list. It never infers a framework from the project's contents.

### The agent surface

Exactly one new tool: start a managed process for the caller's checkout. The invocation
context already carries the calling thread, so resolving the checkout needs no new
plumbing, and the existing capability gate applies.

No stop tool, because the reaper handles it and an agent has no business stopping a server
a person may be watching. No status tool, because the browser status tool and the
discovered-server list already report it. No readiness tool, because the agent reads the
server's own ready line.

An agent can still bypass the tool by running a dev server through its own shell, which
already runs in the correct checkout. The tool description alone did not stop that: in the
first real test, a Claude agent asked to start a dev server ran `npm run dev` in its shell
and landed on 5173. So the runtime instructions T3 already appends to every provider's
session, which already carry the pull request linking rule, gain one more: use the start
tool rather than the shell, and use the port it returns. The shell stays the fallback when
the tool is unavailable or fails.

### The client wire

An ephemeral subscription over the service's stream, keyed on checkout, mirroring the
existing worktree setup subscription. A reconnecting client gets a fresh snapshot.

Not the durable half of that pattern. The existing tracker also upserts a thread activity
under a fixed id so a reload sees something. That cannot be keyed honestly here: a thread
activity belongs to one thread, and two threads can share a checkout. It is also
unnecessary, because a running process is held in memory for as long as it runs. After a
restart there genuinely is no process.

The snapshot carries the script name and its checkout, the status including a starting
state distinct from running, the reserved port, whether it is pinned, and the last error.
A stopped process stays in the stream.

Subscribing holds no claim. Demand comes from preview claims and inferred thread liveness,
never from watching status.

Refusals surface as a tagged error carrying structured fields, so the client composes its
own wording rather than parsing a message, and as a warning notice with an action,
following the existing pattern for a refusal that offers an escape hatch.

## Testing decisions

A good test here states a behaviour a user or an agent would notice, and says nothing about
how the code is arranged. Assert on what a caller gets back and what the world looks like
afterwards. Do not assert on call counts, internal ordering, or which private helper ran.

Timing tests drive a test clock rather than sleeping. The existing idle-close and
port-scanner tests are the prior art, and both are colocated with their module, which is
the house convention.

Five seams, four of which already exist.

**The managed processes service.** The primary seam and where most behaviour is proved:
lifecycle, refusal, demand, exemptions, reaping, orphan recovery, and the stream. Its
dependencies arrive as arguments rather than being constructed, so tests supply a fake
terminal layer, a fake port scanner, a test clock and an in-memory filesystem. The
allocator, the sidecar file, the refcount and the exit watcher are internal and do not
appear in the interface.

**Port reservations.** Its own module with its own tests, internal to the service and not
exposed at its interface. The rules are pure given a set of reservations and a checkout
path, so these tests run with no processes, no files and no clock. The stolen-port scenario
is the acceptance test for the whole feature and belongs here, where it is cheap enough
that it will still be run in a year.

**The script environment helper.** Already a pure function from plain inputs to a record.
Port variables test directly.

**The agent toolkit handlers.** Existing seam with existing prior art. The one new tool is
thin: resolve the caller's thread to a checkout and start.

**Preview resolution logic.** Existing pure client module. URL precedence, the startable
row and the starting state are functions over a snapshot.

The two worktree removers are not a seam. The behaviour that matters, processes stopped
before removal, is proved at the service. The call sites get a thin integration check.

The added demand scope is not unit-tested. It extends a closed set the compiler checks.
What is tested is that the service reads the plain presence check and not the
host-constrained one, because that is the decision that matters.

## Tasks

1. Reserve a block of ten ports for a checkout that has none. Seam: port reservations.
2. Return the same block for a checkout that already has one. Seam: same.
3. Inherit the block when a path is reused after its checkout was removed. Seam: same.
4. Never offer a block that is claimed by a live checkout, even when nothing is listening
   on it. This is the stolen-port acceptance test. Seam: same.
5. Free reservations whose checkout path no longer exists. Seam: same.
6. Round-trip the registry through the sidecar file so a restart keeps every block. Seam:
   managed processes service.
7. Start a managed process for a checkout, in a terminal, on its reserved port. Seam:
   managed processes service.
8. Return the running process rather than starting a second one when start is called again.
   Seam: same.
9. Refuse to start when the reserved port is occupied, naming the occupant from its process
   name and command line. Seam: same.
10. Reallocate the checkout's block on request after a refusal, and start on the new block.
    Seam: same.
11. Inject the block's ports and the bare port name into a script run, with a caller-supplied
    value winning. Seam: script environment helper.
12. Stop a managed process and confirm its reserved port was released. Seam: managed
    processes service.
13. Escalate to recorded descendant process ids when a stop leaves the port held. Seam:
    same.
14. Stop every managed process for a checkout in one call. Seam: same.
15. Stop a checkout's processes before its worktree is removed, from every remover. Seam:
    same, plus a thin check at the call sites.
16. Reap an orphan left by a killed server when its process id, command line and port all
    still match. Seam: same.
17. Leave an orphan alone when the process id has been recycled and the command line does
    not match. Seam: same.
18. Keep a process alive while a borrow is held, and make it reapable when the last one is
    released. Seam: same.
19. Do not reap a process whose borrowing thread has a running turn. Seam: same.
20. Do not reap a process whose borrowing thread has live background work. Seam: same.
21. Do not reap a process with a live client claim, and do reap one whose claim expired.
    Seam: same.
22. Do not reap a pinned process, however long it has been idle. Seam: same.
23. Reap a process idle for thirty minutes with no claim and no live thread. Seam: same,
    driven by a test clock.
24. Do not restart a reaped process, and do not restart a pinned process that exited on its
    own. Seam: same.
25. Emit a stopped process in the stream so it can be offered for starting. Seam: same.
26. Emit a starting state distinct from running while the port is not yet answering. Seam:
    same.
27. Give a reconnecting subscriber a fresh snapshot of the checkout's processes. Seam: same.
28. Start a managed process for the calling agent's checkout, and report only the new port
    after a refusal. Seam: agent toolkit handlers.
29. Prefer a running managed process over a project-file preview URL, a scanned server and
    recent history. Seam: preview resolution logic.
30. Do not navigate until the port appears in discovery, then navigate. Seam: same.
31. Open the preview after readiness when the script declares the automatic switch, and not
    otherwise. Seam: same.
32. Offer the checkout's `package.json` `dev` script, run with its lockfile's package manager
    and the reserved port, when the project declares no dev action. Seams: dev script
    detection (pure), managed processes service stream, agent toolkit handlers, preview
    resolution logic.

## Out of scope

**Concurrency capping.** Refusing to start a process when the machine is under pressure.
Deliberately parked in `docs/findings/dev-server-concurrency.md`, which records why a
count-based cap was rejected, the candidate mechanisms, and the measurements that would
settle it. Agent starts are therefore unbounded, and that is known.

**First-mate dispatch awareness.** A supervising agent modelling host capacity and
throttling what it dispatches. Admission control is exact work that belongs in the
allocator, not in a supervisor's judgement. Since capping is out, this is too.

**Remote environments.** A managed process on a host reached over SSH or a private network,
previewed locally. A second attribution domain and a port-forwarding problem. Two facts for
whoever picks it up: the existing URL rewrite swaps the host and keeps the port, so
reservations survive it, and remote previews already fail for anything not loopback or
private-network, so the limitation is pre-existing.

**Mobile previews.** A phone previewing a server bound to a laptop's loopback. Inherits
whatever remote environments decides.

**Cross-browser automation.** Driving Firefox or WebKit, or many headless browsers in
parallel. The existing browser tools cover the collaborative tab this feature needs, with
console and network entries a general-purpose driver does not provide.

## Further notes

Two decisions were corrected after being recorded, and both amendments are appended to
their tickets rather than edited in. The reservation key was first written as the worktree
path, which would collapse every default-mode thread into one bucket. Feeding reserved
ports to discovery was first routed through the client, which would churn subscriptions.

Two claims were measured rather than argued. The terminal teardown experiment corrected a
statement made twice in the findings and removed the need for process-group killing. The
plain presence check was read directly before being committed to, because the obvious
alternative would reap dev servers when the laptop goes to battery.

Three limitations are accepted rather than solved. Checkout paths use the repository
basename, so two repositories with the same basename can collide on path, which is
pre-existing. The discovered-server ownership field is unreliable for a reparented process,
so managed-process ownership never reads it. An agent can bypass the start tool with its own
shell.

Everything here targets a fork that keeps pulling updates from upstream. Prefer new modules
over edits to the largest existing ones, and keep additions optional wherever a contract is
shared.
