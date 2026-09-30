/**
 * Loads the Pivot's markdown texts (the contract, the teammate brief, and so on)
 * from `src/pivot/text/<name>.md`.
 *
 * Source runs (`node --watch`, tests) read the file beside this module. The
 * published bundle is a single file with no `text/` directory beside it, so its
 * build inlines every text into `__PIVOT_TEXTS__` (see `pack.define` in
 * `apps/server/vite.config.ts`); that map wins whenever it exists.
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

declare const __PIVOT_TEXTS__: Readonly<Record<string, string>> | undefined;

export class PivotTextError extends Schema.TaggedError<PivotTextError>()("PivotTextError", {
  name: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Pivot text "${this.name}" is not available.`;
  }
}

/** Returns the contents of `text/<name>.md`, e.g. `loadPivotText("AGENTS")`. */
export const loadPivotText = Effect.fn("pivot.loadPivotText")(function* (name: string) {
  if (typeof __PIVOT_TEXTS__ !== "undefined") {
    const inlined = __PIVOT_TEXTS__[name];
    return inlined === undefined ? yield* new PivotTextError({ name }) : inlined;
  }
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* fs
    .readFileString(path.join(import.meta.dirname, "text", `${name}.md`))
    .pipe(Effect.mapError((cause) => new PivotTextError({ name, cause })));
});
