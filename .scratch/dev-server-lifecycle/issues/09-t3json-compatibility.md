# t3.json compatibility for static previewUrl

Type: grilling
Status: resolved
Blocked-by: —

## Question

`T3ProjectFileScript` already ships `previewUrl` and `autoOpenPreview` as a checked-in,
team-shared contract, and the schema is published at `https://t3.codes/schema/t3.json`.
Existing projects have static values like `http://localhost:5173`.

Decide: do static URLs keep working unchanged, get rewritten to `{{port}}` form, or get
interpreted as a hint? What does a project with `previewUrl` but no `{{port}}` placeholder
do under allocation? Does `t3.json` gain new fields, and if so does the fork publish a
divergent schema — bearing in mind the standing preference to stay mergeable with upstream?

This is the most upstream-visible surface in the effort, so weigh it against the
fork-only-but-mergeable posture in the map's Notes.

---

## Unblocked, with a large finding from [Preview binding](05-preview-binding.md)

**`autoOpenPreview` is dead config.** It is declared in the schema, editable in the
settings UI, persisted in `t3.json` — and has **no runtime consumer**. Nothing opens a
preview when a script starts, despite the contract comment saying it should
(`orchestration.ts:421-422`). Verify this independently before relying on it, then decide
whether this ticket wires it up, removes it, or leaves it inert.

**Precedence is now settled above this ticket:** a running managed process wins over
`t3.json` `previewUrl`. So the question here is narrower than charted — not "which wins"
but what a static `previewUrl` *means* once a checkout has reserved ports. Candidates: a
discovery hint only (its role today), a fallback for projects that have not adopted
managed scripts, or something to migrate to `{{port}}` form.

**Relevant asymmetry** settled in preview binding: a configured URL that is not listening
vanishes from the UI entirely, while a stopped managed process shows as a startable row.
If static URLs are kept, that difference is user-visible and needs to be intentional.

---

## Resolution

**Decided 2026-09-22.**

### `previewUrl` is unchanged

It has exactly one consumer: `getConfiguredPreviewUrls`
(`previewEmptyStateLogic.ts:7-11`) flattens it into `configuredUrls` for the scanner. It
is a **discovery hint** — "also probe this address" — and has never opened anything.

That stays true. Precedence was settled in [Preview binding](05-preview-binding.md): a
running managed process wins, so a static `previewUrl` simply stops mattering once a
checkout has one. No migration, no rewriting of a file that lives in the user's repo, no
new meaning for an existing field.

The visible behaviour is already right: the scanner drops a configured URL that is not
listening, so it appears when it works and is absent when it does not.

### `autoOpenPreview` gets wired up

**Verified dead, independently.** Every reference in the codebase is a schema
declaration, the editor UI reading or writing the value, the `t3.json`-to-runtime-script
import mapping (`ProjectScriptsControl.tsx:132`, `ProjectActionsSettings.tsx:117`), or a
test. **Nothing reads it to open a preview.** The value round-trips from the settings
toggle into `t3.json` and back and is never acted on.

It is also published in a public JSON Schema generated from the contracts
(`apps/marketing/src/pages/schema/t3.json.ts`, `packages/shared/src/t3ProjectFile.ts:38`),
so users can see the field and reasonably expect it to work.

This work builds the only machinery that could honour it, so it is honoured: a managed
process started from a script carrying `autoOpenPreview` opens the preview once ready.

**No conflict with "humans get no implicit start."** That rule is about a *preview* never
starting a *process*. This is the reverse: the human explicitly started the process, and
the preview follows. The ordering composes with the readiness amendment — start, wait for
the port to appear in discovery, then open.

Removing the field was rejected: it breaks existing `t3.json` files for no gain. Leaving
it inert was rejected: it is a visible lie in a published schema.

### Schema URL: no competing schema, additions stay optional

The fork does **not** publish its own JSON Schema, and users' `$schema` keeps pointing at
`https://t3.codes/schema/t3.json`.

Reasoning:

- `{{port}}` support is a **string convention inside an existing string field**. It is
  invisible to JSON Schema in either direction, so a fork-written `t3.json` still
  validates upstream and an upstream-written one still validates here.
- Any field this fork adds must be **optional**, so upstream-authored files stay valid
  under the fork. That is the direction of compatibility that actually matters, since
  people share repos.
- Publishing a competing schema would force users to edit `$schema` in a file that lives
  in their repository. That is friction, and it advertises lock-in for a fork whose
  standing posture is to stay mergeable.

Revisit only on a **structural** divergence — a new required field, or a changed shape.
A behavioural difference alone is not a reason to fork the schema.
