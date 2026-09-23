# T3 Pivot

A fork of T3 Code that adds firstmate's crew-supervision model: one agent you talk to,
which dispatches and supervises a fleet of agents working in isolated checkouts.

Terms are recorded here as they are resolved. Where the fork inherits a word from T3 Code
or firstmate with a *different* meaning, that collision is called out explicitly, because
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
The opposite is *mine*; a port with no listener is *free*.
_Avoid_: in use, occupied, taken — none of them say whose

### Inherited collisions

**Session**:
In T3 Code, the provider runtime attached to a thread. It is **not** a managed process, and
this repo never uses the word for one.

**Worktree**:
In T3 Code, a separate Git checkout a thread can use instead of the project's main
checkout. In firstmate the equivalent is a treehouse pool slot, claimed 1:1 per task.
Both mean the same thing here: the unit that owns managed processes.
