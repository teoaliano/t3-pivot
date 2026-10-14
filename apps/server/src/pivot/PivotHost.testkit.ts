/**
 * Pivot host harness for tests: the real PivotHost over the Pivot service harness, and a
 * fake home, which is only a client holding a host link's session and its own environment ID.
 */
import {
  AuthPivotHostScope,
  EnvironmentId,
  type PivotHostLaunchInput,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as PivotHost from "./PivotHost.ts";
import type { PivotHostServiceError } from "./PivotHost.ts";
import type { PivotHostCaller } from "./PivotHostAuthorization.ts";
import * as PivotHostStore from "./PivotHostStore.ts";
import { makeRepo, modelSelection, projectId, setup } from "./PivotService.testkit.ts";
import type { FakeThread, FakeV2 } from "./PivotThreads.testkit.ts";
import { TeammateHost } from "./TeammateHost.ts";

export const homeEnvironmentId = EnvironmentId.make("environment-home");
export const otherHomeEnvironmentId = EnvironmentId.make("environment-other-home");

/** The host with its service harness. `layer` is what tests provide. */
export const hostSetup = (options: Parameters<typeof setup>[0] = {}) => {
  const base = setup(options);
  return { ...base, layer: PivotHost.layer.pipe(Layer.provideMerge(base.layer)) };
};

/**
 * The host with `wrap` between PivotHost and the TeammateHost seam: a layer that provides
 * TeammateHost from the real one, to observe or hold a step of a launch.
 */
export const hostSetupWrapped = (
  wrap: Layer.Layer<TeammateHost, never, TeammateHost>,
  options: Parameters<typeof setup>[0] = {},
) => {
  // The service harness alone: the wrapped PivotHost must be the only one.
  const base = setup(options);
  return {
    ...base,
    layer: PivotHost.layer.pipe(Layer.provide(wrap), Layer.provideMerge(base.layer)),
  };
};

/** A fake home: one host link's session, speaking for one environment. */
export interface FakeHome {
  readonly caller: PivotHostCaller;
  readonly call: { readonly homeEnvironmentId: EnvironmentId };
  readonly grantId: string;
}

/** The session a host link issues. Its allowlist is not in it: the host reads that itself. */
export const homeOf = (
  grant: PivotHostStore.HostGrant,
  environmentId: EnvironmentId = homeEnvironmentId,
): FakeHome => ({
  caller: { subject: grant.subject, scopes: [AuthPivotHostScope] },
  call: { homeEnvironmentId: environmentId },
  grantId: grant.grantId,
});

/** A new host link for the project, and a fake home holding its session. */
export const newHome = (
  allowedProjectIds: ReadonlyArray<ProjectId> = [projectId],
  environmentId: EnvironmentId = homeEnvironmentId,
) =>
  Effect.gen(function* () {
    const host = yield* PivotHost.PivotHost;
    return homeOf(yield* host.createGrant({ allowedProjectIds }), environmentId);
  });

export const launchInput = (
  home: FakeHome,
  overrides: Partial<Omit<PivotHostLaunchInput, "homeEnvironmentId">> = {},
): PivotHostLaunchInput => ({
  ...home.call,
  dispatchId: "dispatch-1",
  projectId,
  pivotThreadId: ThreadId.make("pivot-on-the-home"),
  pivotLabel: "Pivot on Mac",
  title: "Fix the login bug",
  kind: "ship",
  intent: "Make the login button work on Safari.",
  spec: "Reproduce, fix, test.",
  modelSelection,
  ...overrides,
});

export const launch = (home: FakeHome, overrides: Parameters<typeof launchInput>[1] = {}) =>
  Effect.flatMap(PivotHost.PivotHost, (host) =>
    host.launchTeammate(home.caller, launchInput(home, overrides)),
  );

export const teammates = (fake: FakeV2) =>
  [...fake.threads.values()].filter((thread) => thread.kind === "teammate");

export const flipped = <A, R>(effect: Effect.Effect<A, PivotHostServiceError, R>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => ({
      code: error._tag === "PivotHostRefusedError" ? error.code : error._tag,
      message: error.message,
    })),
  );

export const docsProjectId = ProjectId.make("project-docs");

/** A thread a launch gave up on: stopped before it was archived, so no run goes on to start an agent. */
export const discarded = (thread: FakeThread) => [
  thread.archived,
  thread.stops,
  thread.stopsWhenArchived,
];

/** A second project of the host, in its own repository. */
export const addDocsProject = (fake: FakeV2, remote = false) => {
  const workspaceRoot = makeRepo({ remote });
  fake.projects.set(docsProjectId, {
    projectId: docsProjectId,
    title: "Docs",
    repositoryIdentity: null,
    workspaceRoot,
    defaultModelSelection: null,
  });
  return workspaceRoot;
};
