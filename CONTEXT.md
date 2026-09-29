# T3 Pivot

A fork of T3 Code that adds firstmate's crew-supervision model: one agent you talk to per
project, which dispatches and supervises teammates working in isolated checkouts.

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
The state of a project that has a Pivot. A project has at most one Pivot.

**Pivot**:
The supervising agent's thread in a project. The user talks to it, and it dispatches and
supervises the project's teammates.
_Avoid_: first mate (firstmate's word for the same role), supervisor, orchestrator. Do not
confuse it with T3 Pivot, the name of this fork.

**Teammate**:
A thread the Pivot dispatched and supervises, working in its own worktree.
_Avoid_: session (see below), crewmate (firstmate's word), worker, subagent (a
provider-native helper inside one thread, which is a different thing)

**Pivot view**:
The dedicated layout for a project in Pivot mode: the Pivot's chat next to a card for each
teammate. It has no sidebar.

### Inherited collisions

**Session**:
In T3 Code, the provider runtime attached to a thread. It is **not** a managed process or
a teammate, and this repo never uses the word for either.

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
