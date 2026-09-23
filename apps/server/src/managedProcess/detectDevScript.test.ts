import { describe, expect, it } from "@effect/vitest";

import { detectDevScript, missingInstallCommand } from "./detectDevScript.ts";

const packageJson = (scripts: Record<string, string>) => JSON.stringify({ name: "app", scripts });

describe("detectDevScript", () => {
  it("runs a Vite dev script on the reserved port and refuses to slide", () => {
    expect(
      detectDevScript({
        packageJson: packageJson({ dev: "vite --host" }),
        lockfiles: ["package-lock.json"],
        platform: "darwin",
      }),
    ).toEqual({
      id: "package-json:dev",
      name: "Dev server",
      command: "npm run dev -- --port $PORT --strictPort",
    });
  });

  it("uses the package manager the lockfile names", () => {
    const detect = (lockfile: string) =>
      detectDevScript({
        packageJson: packageJson({ dev: "next dev" }),
        lockfiles: [lockfile],
        platform: "linux",
      })?.command;

    expect(detect("pnpm-lock.yaml")).toBe("pnpm run dev --port $PORT");
    expect(detect("yarn.lock")).toBe("yarn run dev --port $PORT");
    expect(detect("bun.lock")).toBe("bun run dev --port $PORT");
  });

  it("leaves the port to PORT for a dev tool it does not know", () => {
    expect(
      detectDevScript({
        packageJson: packageJson({ dev: "node server.js" }),
        lockfiles: [],
        platform: "darwin",
      })?.command,
    ).toBe("npm run dev");
  });

  it("uses PowerShell's variable syntax on Windows", () => {
    expect(
      detectDevScript({
        packageJson: packageJson({ dev: "vite" }),
        lockfiles: [],
        platform: "win32",
      })?.command,
    ).toBe("npm run dev -- --port $env:PORT --strictPort");
  });

  it("finds nothing without a dev script or a readable package.json", () => {
    expect(
      detectDevScript({
        packageJson: packageJson({ build: "vite build" }),
        lockfiles: [],
        platform: "darwin",
      }),
    ).toBeNull();
    expect(
      detectDevScript({ packageJson: "{ not json", lockfiles: [], platform: "darwin" }),
    ).toBeNull();
    expect(detectDevScript({ packageJson: null, lockfiles: [], platform: "darwin" })).toBeNull();
  });
});

describe("missingInstallCommand", () => {
  const withDeps = '{"dependencies":{"react":"^19.0.0"},"scripts":{"dev":"vite"}}';

  it("asks for an install in a checkout with dependencies and no node_modules", () => {
    expect(
      missingInstallCommand({
        packageJson: withDeps,
        lockfiles: ["pnpm-lock.yaml"],
        installed: false,
      }),
    ).toBe("pnpm install");
  });

  it("needs nothing once dependencies are installed", () => {
    expect(missingInstallCommand({ packageJson: withDeps, lockfiles: [], installed: true })).toBe(
      null,
    );
  });

  it("needs nothing for a package.json that declares no dependencies", () => {
    expect(
      missingInstallCommand({
        packageJson: '{"scripts":{"dev":"python3 -m http.server"}}',
        lockfiles: [],
        installed: false,
      }),
    ).toBe(null);
  });
});
