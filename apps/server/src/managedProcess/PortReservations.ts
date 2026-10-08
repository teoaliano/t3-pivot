/**
 * Port reservations: every checkout holds one contiguous block of ports for
 * its lifetime, whether or not anything is listening on it.
 *
 * Allocation reads only the registry of claims, never the sockets that are
 * listening. A stopped dev server leaves its block claimed, so another
 * checkout can never be handed the number a browser tab still points at.
 * See docs/internals/managed-processes.md.
 *
 * Everything here is pure: callers own storage and serialisation.
 */

export const PORT_BLOCK_SIZE = 10;

/** 200 blocks between the ports project configs default to and every OS ephemeral range. */
const DEFAULT_RANGE_START = 11000;
const DEFAULT_RANGE_END = 12999;

/** Checkout path to the first port of its block. */
export type PortReservations = ReadonlyMap<string, number>;

export interface PortRange {
  /** First port of the first block. Undocumented escape hatch; defaults to 11000. */
  readonly start?: number;
}

export interface ReservationResult {
  readonly reservations: PortReservations;
  readonly base: number;
}

export function blockPorts(base: number): ReadonlyArray<number> {
  return Array.from({ length: PORT_BLOCK_SIZE }, (_, index) => base + index);
}

function blockBases(range: PortRange | undefined): ReadonlyArray<number> {
  const start = range?.start ?? DEFAULT_RANGE_START;
  const blockCount = Math.floor((DEFAULT_RANGE_END - DEFAULT_RANGE_START + 1) / PORT_BLOCK_SIZE);
  return Array.from({ length: blockCount }, (_, index) => start + index * PORT_BLOCK_SIZE);
}

function firstFreeBase(
  reservations: PortReservations,
  range: PortRange | undefined,
  skip: number | undefined,
): number | null {
  const claimed = new Set(reservations.values());
  return blockBases(range).find((base) => base !== skip && !claimed.has(base)) ?? null;
}

/**
 * Idempotent: a checkout that already holds a block gets it back unchanged,
 * including after its directory was removed and recreated at the same path.
 * Returns null when the range is exhausted.
 */
export function ensureReservation(
  reservations: PortReservations,
  checkoutPath: string,
  range?: PortRange,
): ReservationResult | null {
  const existing = reservations.get(checkoutPath);
  if (existing !== undefined) return { reservations, base: existing };
  const base = firstFreeBase(reservations, range, undefined);
  if (base === null) return null;
  return { reservations: new Map(reservations).set(checkoutPath, base), base };
}

/** Moves a checkout to a different free block, the explicit answer to a port conflict. */
export function reallocateReservation(
  reservations: PortReservations,
  checkoutPath: string,
  range?: PortRange,
): ReservationResult | null {
  const current = reservations.get(checkoutPath);
  const others = new Map(reservations);
  others.delete(checkoutPath);
  const base = firstFreeBase(others, range, current);
  if (base === null) return null;
  return { reservations: others.set(checkoutPath, base), base };
}

export function releaseReservation(
  reservations: PortReservations,
  checkoutPath: string,
): PortReservations {
  if (!reservations.has(checkoutPath)) return reservations;
  const next = new Map(reservations);
  next.delete(checkoutPath);
  return next;
}

/** Frees every reservation whose checkout path no longer exists. */
export function reconcileReservations(
  reservations: PortReservations,
  exists: (checkoutPath: string) => boolean,
): PortReservations {
  const next = new Map([...reservations].filter(([checkoutPath]) => exists(checkoutPath)));
  return next.size === reservations.size ? reservations : next;
}
