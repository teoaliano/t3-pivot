# Managed processes

A **managed process** is a long-running child process owned by a worktree and supervised
by the server: a dev server, a watch task, anything started from a project script that
does not exit on its own. See [CONTEXT.md](../../CONTEXT.md) for the surrounding
vocabulary, including why this is not called a session.

The implementation lives in `apps/server/src/managedProcess/`.
`docs/findings/dev-server-concurrency.md` holds the findings behind the effort, including
what was deliberately parked.

## Managed process state is not event-sourced

The event log is the source of truth for orchestration state. Managed processes are the
deliberate exception. Their state splits two ways, and neither is the event log.

**The live process is memory-only.** An Effect service owns the child process, its
`Scope`, its borrower count, its status, and its exit watcher. A server restart kills the
process and forgets the record.

**Port identity is durable, in a sidecar file.** One global, atomically written,
self-versioned file holds port reservations and `{pid, port, worktreePath, command}`.
It survives a restart so a worktree keeps its port, and so a process that outlived a
killed server can be found and reaped.

This follows the rule the rest of the server already applies: state describing a live
process or a live client view is memory-only, and state describing bytes on disk or user
intent is durable. `ThreadBackgroundLiveness`, `WorktreeSetupTracker`, `ProjectClone`,
`PreviewManager`, and `OpenCodeServerOwner` each state a version of this in their own
headers. `TerminalManager` is the closest parallel: scrollback is durable in log files
under the state directory, live PTYs are a memory-only map, the layer finalizer kills them
all on shutdown, and there is no reattach path.

### Why not the event log

Two reasons, and the second is the one that binds.

A new persisted entity touches roughly fifteen to twenty files, including the three
largest in the server: `ProjectionSnapshotQuery.ts`, `ProjectionPipeline.ts`, and
`decider.ts`. It also needs a migration registered by hand in two places.

More importantly, **persisted events carry no schema version**. `EventBaseFields` has no
version field, so compatibility means never breaking the struct, enforced by decode
failure at startup rather than by a migration path. The precedent for legacy event fields
in this codebase is explicit that their removal is not scheduled. Adding an event type is
effectively permanent. That is the wrong commitment for state whose entire subject is a
process that dies.

Provider sessions are the counter-example that prices this. They are projected into
SQLite, and they pay for it with a startup orphan sweep and a user-facing error that
exists only because of the choice: _"Provider session did not survive a server restart.
Send a new message to continue."_

For this fork there is a third reason. Those three files are among the ones upstream
changes most, so durable state would put our largest diff exactly where rebases hurt.

### What this means if you are changing it

If you find yourself adding a managed-process command, event, or projection, that is a
reversal of this decision and not a gap in it. The cost of reversing is the file count
above plus a permanent event type. The cost of keeping it is that managed-process state
never appears in the orchestration snapshot, so it needs its own subscription to reach
clients.

## Ownership and lifetime

A managed process is owned by a **checkout**, not a thread. Threads are borrowers.

A checkout is a worktree, or a project's main working directory. Both are ownable, because
the default thread mode runs in the main checkout rather than a worktree; restricting
managed processes to worktrees would leave the most common configuration with no stop
button and no port safety. The owning key is the thread's worktree path where it has one,
and the project's workspace root where it does not.

Deleting a thread **releases a borrow and never terminates the process.** A managed
process survives the deletion of every thread that borrows it; the reaper stops it once
nothing holds a lease. Any other rule means closing one thread silently kills a server
another thread, or a browser tab, is still using.

Records are per `(worktree, script)`. Port reservations are a **block per worktree**, which
every record in that worktree draws from. The grains differ on purpose: the block
guarantees two worktrees can never collide however many scripts each runs, while the
per-script record keeps start, stop, and reap operating on the single thing a user
clicked.

## What keeps a managed process alive

A managed process is alive because **a person is looking at it or an agent is working in
it**. Nothing else counts, and in particular client presence does not: when no client is
connected the background-policy lease set is empty, so a lease keyed on it would let a
headless agent's server be reaped out from under it.

Demand takes two forms.

**Declared** demand reuses the server's existing record of what each connected client is
watching. A preview registers a claim there against its checkout. That record already
expires claims on a timer, sweeps expired ones periodically, and drops a client's claims
the moment its connection closes, so a browser that crashes releases its claim without
anyone sending a message. Building a separate claim register for managed processes was
rejected: it would have needed its own expiry, and a release step that failed to run would
leave a process that nothing could ever stop.

Read that record through the plain presence check, never the one the other consumers use.
The common one also returns false when the machine is locked, thermally stressed, in low
power mode, or **on battery**, and when the window is not focused. Those are the right
rules for refreshing a status panel. For a running dev server they would mean unplugging
the laptop stops your server.

**Inferred** liveness is never declared. At sweep time, a process is in use if any thread
whose worktree path matches has a running turn or live background work. Those fields are
already denormalised onto the thread projection row and already consulted by three other
reapers. The consequence is that the agent case needs no lease plumbing at all, and keeps
working with no client attached.

### Starting

**Agents start managed processes automatically. Humans do not.** An agent that needs to
check something in a browser cannot wait for a person to press a button, and an agent
inside a turn is the one caller for which a multi-minute compile is acceptable. For a
person, a preview with no running process shows an empty state and a start button, so a
glance at the preview never triggers an unexplained wait.

This means the idle threshold must be longer than the usual gap between an agent's turns.
Otherwise a process started for one turn is reaped before the next, and every turn pays a
full startup.

It also means agent-initiated starts are unbounded. Limiting them is deliberately out of
scope here; see `docs/findings/dev-server-concurrency.md`.

### Stopping

Starting a process explicitly grants it no protection. If it did, idle shutdown would
never fire in the common case, because most processes are started deliberately.

The only protection is a **pin**: persisted user intent, stored beside the port
reservations and keyed on the worktree and script. It follows the existing override that
removes a thread from automatic settlement. A pin must be visible, so that a pinned
process is never mistaken for a leak.

When the last lease drops a process becomes **reapable, not dead**. A pinned process that
exits on its own **stays dead** and is surfaced as stopped. There is no restart policy: a
dev server usually exits because the code does not compile, and restarting it in a loop
produces noise instead of progress.

## Ports are reserved, not observed

A reservation is claimed for a worktree's lifetime, whether or not anything is currently
listening. A registry knows what is **claimed**; `lsof` only knows what is **listening**,
which is a strict subset.

Allocating by observation produces a silent failure: a worktree stops its dev server,
another worktree is created and is handed the now-free port, and the first worktree
returns to find a browser tab pointing at another checkout's application. Preventing that
is the reason this work exists.

### The scheme

Each worktree reserves a **contiguous block of ten ports** from **11000-12999**. The range
sits clear of the ports users' own configs default to, and below every OS ephemeral range
(Linux from 32768, macOS from 49152) so the kernel can never hand out a reserved port.
A fixed block keeps a worktree's whole range predictable and lets a multi-port stack move
together under one offset.

Reservations are keyed on **checkout path**, and **path reuse inherits the block**. Paths
are deterministic from the branch name, and recreating a vanished worktree at its original
path is deliberate behaviour elsewhere in the server, so inheritance is the only rule
consistent with how paths are already used.

Claiming is **idempotent and happens on use**, not only at worktree creation. Some paths
obtain a worktree without creating one, and some recreate one automatically, so any
creation-hook scheme has gaps. Creation is hooked as well, but only so the reservation
usually exists before anything asks for it.

**On conflict, refuse.** If a reserved port is occupied when a managed process starts, the
start fails and names the occupant, and reallocating the worktree's block is an explicit
user action. Sliding to the next free port is the failure mode this design exists to
prevent; T3 must not do internally what it asks users to disable with `--strictPort`.

Reservations are released when a worktree is removed, and a periodic reconcile frees any
whose path no longer exists on disk. Without the reconcile the range leaks, because
worktrees are removed from shells and while the server is down.

### Where the file lives

One global file under **`baseDir`**, beside `worktrees/`, not under `stateDir`.
A reservation is keyed on a worktree path, and worktrees are `baseDir`-scoped, while
`stateDir` splits into `dev` and `userdata`. Storing it under `stateDir` would make the
key's domain wider than the file's, and two server instances sharing worktrees would
allocate the same ports.

### Known limitation

Worktree paths are built from the repository _basename_, so two different repositories
with the same basename resolve into one directory and can collide on path. This is
inherited from existing worktree behaviour, where such repositories already collide before
reservations are involved. It is not addressed here.

## Proving which checkout a port belongs to

A port number carries no evidence of what is behind it. The general answer is to read the
working directory of the process holding the port, since that folder is the checkout it
serves. **We do not do that, on any platform.**

Two records make it unnecessary. Every worktree holds a distinct block of ports, so two
managed processes can never contend for one number and cross-wiring between them cannot
happen. And the process we started is recorded with its pid, so identifying our own server
is a lookup rather than an investigation.

It is also not currently available. Nothing in this codebase reads a process working
directory, the port scanner's command is documented as the only form relied on, and
Windows exposes no cheap way to read another process's working directory at all. A
POSIX-only implementation was rejected because the same feature would answer on macOS and
Linux and silently fail on Windows, with nothing to indicate the difference.

An occupant we did not start is named best-effort from its process name and command line.
Both are available everywhere today.

Attribution runs **before a start**, to check the reserved port is free, and **once after
boot**, to confirm the process that came up is ours and on the port requested. A startup
log naming a port states intent; the running process is the evidence. It does not run on
every scan: once proven, the only change that matters is the process exiting, which its
exit watcher already reports.

### Never stop a process we did not start

This is absolute, and it holds even behind a confirmation prompt. When a reserved port is
occupied, the managed process moves to a newly allocated block and the occupant is
reported, never stopped.

Reallocating costs one restart. Stopping the wrong process destroys work in a session that
is invisible from here. The two are not close enough for the choice to be worth offering.

This does not contradict orphan reaping, which does stop processes. There, the pid comes
from a record written when the process was spawned and is verified by liveness and command
line. Here it would come from inferring ownership of something found on a port.

## Which server a preview points at

When a checkout has a managed process running, that process **is** this checkout's server,
and the preview uses it. Anything else is inference, so the other sources rank below it: a
preview URL declared in the project file, then a server found by scanning, then recently
visited addresses. Those remain visible, because they still cover a server started outside
the app and a project that has not adopted managed scripts.

This is a change in behaviour rather than a gap being filled. Today nothing picks a URL:
the empty state lists what it found and a person clicks one.

**A preview waits for the server to answer before it navigates.** A dev server binds its
port seconds before it can serve, and a cold build can lag a minute behind that. Opening
at start produces a connection error that disappears if you happen to reload, which reads
as a broken application. It misleads agents worse than people: an agent that opens a
preview and sees a connection error will treat it as a fault in the code it is testing.

**A managed process that is not running still appears**, as a row that offers to start it.
This differs from a preview URL in the project file, which disappears from the list
whenever nothing is listening on it. The difference is deliberate. A managed process is a
named thing with a known owner and a reserved port. A URL in a configuration file is a
string that may never have worked.

Two threads in one checkout get independent preview tabs pointing at the same process.
Each holds its own claim, and the process outlives whichever closes first.

## Stopping a managed process, and what outlives one

A managed process runs in a T3 terminal rather than as a directly spawned child. Output,
scrollback, and the ability to type are then free, and scrollback already persists. The
cost is that the recorded process id belongs to the shell, not to the server underneath
it.

That cost is acceptable, because stopping the shell already stops the server. The shell is
a session leader, so when it dies the kernel signals the whole foreground process group,
and an ordinary dev server dies with it. This was measured rather than assumed. Two kinds
of child do survive: one that moves itself into a new session, and one that ignores the
hangup signal. Neither is normal behaviour for a dev server.

So there is no process-group killing here. A stop uses the existing terminal teardown,
then **confirms the reserved port was released**. Only if the port is still held does it
escalate, using the descendant process ids the terminal layer already tracks. Killing a
whole process group would be the more dangerous choice, since the group belongs to a shell
and may contain processes nobody here started.

**Removing a checkout stops its managed processes first.** This is part of removal, not a
courtesy performed by whoever remembers. One code path already does it correctly when a
thread is deleted; every other remover calls the same helper.

**A process can outlive the server that started it**, when that server is killed without
running its shutdown work. The record is re-read at the next start, and a process is only
stopped when its process id is still alive, its command line still matches, and it still
holds the port recorded for it. All three, because process ids are reused and stopping a
stranger is the failure to avoid.

The record is written when the port first answers, not at spawn, and it names the process
holding the port. The pid known at spawn is the shell's, which dies with the killed server;
the survivor worth finding is the listener. Each record also carries the pid of the server
that wrote it. The file is shared by every server on the base directory, dev and userdata
alike, and only a record whose server is dead is an orphan. Without that check, starting
one server would stop the other's running processes.

## When a managed process is stopped for you

A sweep runs every five minutes and stops any managed process that nobody has wanted for
thirty minutes. Both numbers match the server's existing session reaper, and the sweep is
built the same way: it runs on a fixed schedule whether or not anyone is connected, it
filters on a cheap timestamp before doing expensive work, and it records why it skipped
anything it left alone.

Thirty minutes is deliberately long. An agent that starts a process for one turn must
still find it running at the start of the next, or every turn pays a full rebuild.

The numbers are constants, not a setting. The existing session reaper has no setting
either, and the retention controls that are user-configurable work in days, so minutes
would need a new control as well as a new setting. Add one when the default is known to be
wrong.

A process is left alone when a thread that borrows it has a turn running, when such a
thread has live background work, when a client is holding a claim on it, or when it is
pinned.

Nothing tells you this happened. Both existing reapers only write to the log, and the one
automatic action that is surfaced to users needed a durable event this feature
deliberately avoids. The result is visible anyway, because a stopped process still appears
in the preview list with an offer to start it.

**A stopped process is never restarted automatically.** Nothing here re-arms on a timer.
The identity survives, and the next person or agent that wants the process starts it
again. That matches how a closed provider session, a removed worktree, and an idle
provider server all behave.

Freeing port reservations for checkouts that no longer exist is separate work on an hourly
schedule, because it only rewrites a file. A leaked reservation costs one block out of two
hundred and can wait. A dev server nobody wants should stop promptly.

## What an agent can do

An agent gets **one** tool here: start a managed process for its own checkout.

It needs nothing else. The server's own startup line in the terminal tells it when the
page is ready, and the existing browser tools let it look at the result. Stopping is the
reaper's job, and an agent has no business stopping a server a person may be watching.

This is the only place in the product where an agent is given a way to run something. No
tool executes a shell command, a script, or a terminal, and that stays true: this tool
starts a process the server already knows how to describe, not an arbitrary command.

The tool exists because an agent's own shell already runs in the right checkout, so an
agent can start a dev server today without any of this. Such a server gets no reserved
port, no record, and is never stopped for being idle. It is visible, because any listening
port is discovered, and unmanageable, because nothing owns it. In a product where several
agents work at once, leaving that as the normal agent path would bring back the port
conflicts this design exists to prevent.

An agent can still take that path, and without being told otherwise it does. The first real
test had a Claude agent run `npm run dev` in its shell even with the tool listed. So the
runtime instructions every provider session receives (`apps/server/src/provider/RuntimeInstructions.ts`,
beside the pull request linking rule) tell agents to prefer the tool and fall back to the
shell only when the tool is unavailable or fails. Nothing enforces it, and the design does
not depend on the tool being the only way in.

## A fresh checkout still has a dev server to start

Without a project action, the start button had nothing to run and the agent tool fell back
to the agent's own shell, which is the unmanaged path this design exists to replace. So a
project with no dev action is offered the checkout's `package.json` `dev` script, run with
the package manager its lockfile names. A project action always wins. The detected script
is read per checkout on each subscription and never written anywhere, so it follows the
file as the file changes.

This is the one command T3 builds. Because the preview looks at the reserved port, the
command passes `--port` to the few dev tools that ignore `PORT`, matched on the first word
of the script, with `--strictPort` for Vite. A command the user wrote is never edited: an
action that ignores `PORT` needs the flag written into it.

## The project file

A project file can name a preview address for a script. That address is a hint for
discovery: the server also probes it when looking for running servers. It has never opened
anything, and it still does not. Once a checkout has a managed process, the address stops
mattering, because a running managed process is what the preview uses.

The same file has a switch for opening the preview automatically when a script runs. That
switch has never done anything. It is declared, it can be turned on in settings, it is
saved, and it is published in the schema people validate their project file against, and
nothing reads it. This work honours it, because this work builds the only machinery that
could.

Honouring it does not contradict the rule that a preview never starts a process for a
person. That rule is about the preview. Here the person started the process, and the
preview follows once the server can answer.

**The fork publishes no schema of its own.** Project files keep pointing at the original.
Ports reach a script as environment variables, which the schema never sees, and every field
this fork adds is optional, so a file written for either side validates on the other. Publishing a rival schema would make people edit a file in their
own repository and would advertise a split that does not exist. Reconsider only if the
shape genuinely diverges, never for a difference in behaviour alone.
