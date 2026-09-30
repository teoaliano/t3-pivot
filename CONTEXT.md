# T3 Pivot

A fork of T3 Code that adds firstmate's crew-supervision model: an agent you talk to,
which dispatches and supervises teammates working in isolated checkouts.

Terms are recorded here as they are resolved. Where the fork inherits a word from T3 Code
or firstmate with a _different_ meaning, that collision is called out explicitly, because
both upstreams appear in this repo's vocabulary.

## Language

### Managed processes

**Managed process**:
A long-running child process owned by a worktree and supervised by the server, such as a
dev server or a watch task.
_Avoid_: session (means something else here, see below), service, dev server (acceptable
as informal UI copy only when the process really is a server)

**Borrower**:
A thread that holds a claim on a managed process. Borrowing keeps the process alive;
releasing every borrow makes it eligible to be stopped.
_Avoid_: owner (a worktree owns; a thread only borrows), user, consumer

**Port reservation**:
A claim on a range of ports held for a worktree's lifetime, whether or not anything is
currently listening on them.
_Avoid_: port allocation when the distinction from an observed-free port matters

**Port block**:
The contiguous set of ports reserved to one worktree, from which every managed process in
that worktree draws.

**Foreign**:
Of a listening port: held by a process whose working directory is not this worktree's root.
The opposite is _mine_; a port with no listener is _free_.
_Avoid_: in use, occupied, taken — none of them say whose

### Pivot mode

**Pivot mode**:
The feature as a whole: Pivots, their teammates and the Pivot view. Not a state a project
or a thread is switched into.
_Avoid_: using it for the Pivot view (the layout) or for a Pivot (the thread)

**Pivot**:
A thread whose agent supervises teammates. The user talks to it, and it dispatches and
supervises its own teammates. A thread is a Pivot from creation and stays one. A project
has at most one active Pivot. Creating a new one moves the active Pivot's live teammates
and open decisions to it, and the old one is **retired**: read-only history.
_Avoid_: first mate (firstmate's word for the same role), supervisor, orchestrator,
settled (T3's thread lifecycle state, not a retired Pivot). Do not confuse it with T3
Pivot, the name of this fork.

**Teammate**:
A thread a Pivot dispatched and supervises, working in its own worktree. It belongs to one
Pivot at a time and stays a teammate for good. A teammate is either a **ship** (delivers
a change) or a **scout** (investigates and leaves a report), and a scout can be promoted
to a ship in place.
_Avoid_: session (see below), crewmate (firstmate's word), worker, subagent (a
provider-native helper inside one thread, which is a different thing)

**Teammate status**:
What a teammate is doing, as the user and the Pivot see it. It combines the teammate's
**reported status** (what it last said about its latest turn) with its runtime state
(running, waiting on an approval, errored). Runtime evidence wins while the teammate is
active. A teammate that stops without reporting is **unreported**.
_Avoid_: using the latest report alone as the teammate's status

**Decision**:
A question that stops work until someone answers it. A teammate opens one when it needs a
call or is blocked, and the Pivot can open one for itself. The Pivot answers it unless it
needs the user's authority. Then it is **escalated** and held for the user.
_Avoid_: question, prompt, user input (T3's user-input request is a provider-native
question inside one turn, which is a different thing)

**Pivot view**:
The full-screen layout of one Pivot: its chat next to a card for each teammate, with no
sidebar. The other way to show a Pivot is as an ordinary chat, with its teammates nested
under it in the sidebar.

### Inherited collisions

**Session**:
In T3 Code, the provider runtime attached to a thread. It is **not** a managed process or
a teammate, and this repo never uses the word for either.

**Task and endpoint**:
In firstmate, a task is the durable unit of work and an endpoint is the agent session
running it. Here a teammate thread is the task and a provider session is the endpoint.

**Captain**:
firstmate's word for the person directing the fleet. Here that is the **user**, as in
T3 Code.

**Teammate (Claude Code)**:
Claude Code's agent teams also call their helpers "teammates", and T3 surfaces those as
activities inside one thread. They are subagents in this repo's language, never teammates.

**Worktree**:
In T3 Code, a separate Git checkout a thread can use instead of the project's main
checkout. In firstmate the equivalent is a treehouse pool slot, claimed 1:1 per task.
Both mean the same thing here: the unit that owns managed processes.
