import { describe, expect, it } from "@effect/vitest";

import {
  blockPorts,
  ensureReservation,
  reallocateReservation,
  reconcileReservations,
  releaseReservation,
  type PortReservations,
} from "./PortReservations.ts";

const empty: PortReservations = new Map();

describe("PortReservations", () => {
  it("reserves the first block of ten ports for a checkout that has none", () => {
    const result = ensureReservation(empty, "/work/app");

    expect(result?.base).toBe(11000);
    expect(blockPorts(11000)).toEqual([
      11000, 11001, 11002, 11003, 11004, 11005, 11006, 11007, 11008, 11009,
    ]);
    expect(result?.reservations.get("/work/app")).toBe(11000);
  });

  it("gives a second checkout the next block", () => {
    const first = ensureReservation(empty, "/work/app");
    const second = ensureReservation(first!.reservations, "/work/app-feature");

    expect(second?.base).toBe(11010);
  });

  it("returns the same block for a checkout that already has one", () => {
    const first = ensureReservation(empty, "/work/app");
    const other = ensureReservation(first!.reservations, "/work/other");
    const again = ensureReservation(other!.reservations, "/work/app");

    expect(again?.base).toBe(11000);
    expect(again?.reservations).toBe(other?.reservations);
  });

  it("keeps a checkout's block when it is recreated at the path it was removed from", () => {
    const reservations: PortReservations = new Map([
      ["/work/app", 11000],
      ["/work/other", 11010],
    ]);
    // The directory came back before the reconcile ran, so it still exists.
    const reconciled = reconcileReservations(reservations, () => true);
    const again = ensureReservation(reconciled, "/work/app");

    expect(again?.base).toBe(11000);
  });

  it("never offers a block claimed by a live checkout, even when nothing listens on it", () => {
    // W1 reserves a block, then its dev server stops. Nothing is listening on
    // 11000 now, and reservations do not look at listeners at all.
    const w1 = ensureReservation(empty, "/work/w1");
    // W2 is created and starts a dev server.
    const w2 = ensureReservation(w1!.reservations, "/work/w2");
    // W1 returns.
    const w1Again = ensureReservation(w2!.reservations, "/work/w1");

    expect(w2?.base).not.toBe(11000);
    expect(w1Again?.base).toBe(11000);
  });

  it("fills a gap left by a released checkout before extending the range", () => {
    const reservations: PortReservations = new Map([
      ["/work/a", 11000],
      ["/work/c", 11020],
    ]);

    expect(ensureReservation(reservations, "/work/b")?.base).toBe(11010);
  });

  it("returns null when every block in the range is claimed", () => {
    const full: PortReservations = new Map(
      Array.from({ length: 200 }, (_, index) => [`/work/${index}`, 11000 + index * 10] as const),
    );

    expect(ensureReservation(full, "/work/new")).toBeNull();
  });

  it("honours a configured range base", () => {
    expect(ensureReservation(empty, "/work/app", { start: 20000 })?.base).toBe(20000);
  });

  it("moves a checkout to a different free block on reallocation", () => {
    const reservations: PortReservations = new Map([
      ["/work/app", 11000],
      ["/work/other", 11010],
    ]);
    const moved = reallocateReservation(reservations, "/work/app");

    expect(moved?.base).toBe(11020);
    expect(moved?.reservations.get("/work/app")).toBe(11020);
    expect(moved?.reservations.get("/work/other")).toBe(11010);
  });

  it("frees reservations whose checkout path no longer exists", () => {
    const reservations: PortReservations = new Map([
      ["/work/kept", 11000],
      ["/work/gone", 11010],
    ]);
    const reconciled = reconcileReservations(reservations, (path) => path !== "/work/gone");

    expect([...reconciled.keys()]).toEqual(["/work/kept"]);
    expect(ensureReservation(reconciled, "/work/new")?.base).toBe(11010);
  });

  it("frees a released checkout's block", () => {
    const reservations: PortReservations = new Map([["/work/app", 11000]]);

    expect(releaseReservation(reservations, "/work/app").size).toBe(0);
  });
});
