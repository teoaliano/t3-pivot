import * as Option from "effect/Option";

export type JoinPath = (first: string, ...segments: string[]) => string;

// T3 Pivot keeps its own T3 home so it runs beside T3 Code without sharing
// data. Development runs keep upstream's ~/.t3/dev.
const PIVOT_T3_HOME_DIRNAME = ".t3-pivot";
const DEVELOPMENT_T3_HOME_DIRNAME = ".t3";

function normalizeConfiguredBaseDir(t3Home: Option.Option<string>): Option.Option<string> {
  if (Option.isNone(t3Home)) {
    return Option.none();
  }
  const trimmed = t3Home.value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
}

export function resolveDesktopBaseDir(input: {
  readonly homeDirectory: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
  readonly t3Home: Option.Option<string>;
}): string {
  return Option.getOrElse(normalizeConfiguredBaseDir(input.t3Home), () =>
    input.joinPath(
      input.homeDirectory,
      input.isDevelopment ? DEVELOPMENT_T3_HOME_DIRNAME : PIVOT_T3_HOME_DIRNAME,
    ),
  );
}

export function resolveDesktopStateDir(input: {
  readonly baseDir: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
  readonly t3Home: Option.Option<string>;
}): string {
  const useDevSubdir =
    input.isDevelopment && Option.isNone(normalizeConfiguredBaseDir(input.t3Home));
  return input.joinPath(input.baseDir, useDevSubdir ? "dev" : "userdata");
}
