/**
 * The dev script a checkout offers when its project declares no dev action:
 * `package.json`'s `dev` script, run with the package manager its lockfile
 * names. This is the one command T3 builds itself. It never edits a command
 * the user wrote. See docs/internals/managed-processes.md.
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

export interface DetectedDevScript {
  readonly id: string;
  readonly name: string;
  readonly command: string;
}

/** Namespaced so it can never collide with a project action's id. */
export const DETECTED_DEV_SCRIPT_ID = "package-json:dev";

const LOCKFILE_MANAGERS = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
] as const;

/**
 * Dev tools that ignore `PORT` but take `--port`, keyed on the first word of
 * the script. Vite also gets `--strictPort`, so a taken port fails instead of
 * sliding to one the preview is not looking at.
 */
const PORT_FLAGS: Readonly<Record<string, (port: string) => string>> = {
  vite: (port) => `--port ${port} --strictPort`,
  next: (port) => `--port ${port}`,
  astro: (port) => `--port ${port}`,
  nuxt: (port) => `--port ${port}`,
  nuxi: (port) => `--port ${port}`,
  ng: (port) => `--port ${port}`,
};

const decodePackageJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ scripts: Schema.optional(Schema.Record(Schema.String, Schema.String)) }),
  ),
);

export function detectDevScript(input: {
  readonly packageJson: string | null;
  readonly lockfiles: ReadonlyArray<string>;
  readonly platform: NodeJS.Platform;
}): DetectedDevScript | null {
  if (input.packageJson === null) return null;
  const dev = Option.getOrUndefined(decodePackageJson(input.packageJson))?.scripts?.dev?.trim();
  if (!dev) return null;
  const manager =
    LOCKFILE_MANAGERS.find(([lockfile]) => input.lockfiles.includes(lockfile))?.[1] ?? "npm";
  const portFlag = PORT_FLAGS[dev.split(/\s+/, 1)[0] ?? ""];
  const port = input.platform === "win32" ? "$env:PORT" : "$PORT";
  // npm needs `--` to pass flags through to the script; the others forward them.
  const args = portFlag ? `${manager === "npm" ? " --" : ""} ${portFlag(port)}` : "";
  return { id: DETECTED_DEV_SCRIPT_ID, name: "Dev server", command: `${manager} run dev${args}` };
}

/** Reads the checkout's package.json and lockfiles. Missing files mean nothing detected. */
export const readDetectedDevScript = Effect.fn("readDetectedDevScript")(function* (
  checkoutPath: string,
  platform: NodeJS.Platform,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const packageJson = yield* fs
    .readFileString(path.join(checkoutPath, "package.json"))
    .pipe(Effect.orElseSucceed(() => null));
  if (packageJson === null) return null;
  const lockfiles: Array<string> = [];
  for (const [lockfile] of LOCKFILE_MANAGERS) {
    if (
      yield* fs.exists(path.join(checkoutPath, lockfile)).pipe(Effect.orElseSucceed(() => false))
    ) {
      lockfiles.push(lockfile);
    }
  }
  return detectDevScript({ packageJson, lockfiles, platform });
});
