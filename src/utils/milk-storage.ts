/**
 * Pure safe-storage rules for breast-milk bags (ABA / NHMRC guidance, simplified):
 * - Fresh: Room 8h, Fridge 72h, Freezer = freezer-type window.
 * - Thawed (previously frozen): Room 4h, Fridge 24h, Freezer = not allowed.
 * - Freezer -> Fridge/Room derives Thawed and re-anchors the timer to the move time.
 * - Thawed -> Freezer is blocked (no refreezing).
 *
 * Timer semantics: the active window is anchored to the bag's expression time while
 * fresh, and re-anchored on every location change for thawed bags (a move into a
 * cell restarts that cell's clock). This module is the single source of truth for
 * use-by math — badges, suggestions, and expiry notifications all read it.
 *
 * Keep this file dependency-free and UI/DB agnostic.
 */

export type StorageLocation = 'room' | 'fridge' | 'freezer';
export type Provenance = 'fresh' | 'thawed';
/** compartment = freezer inside a fridge door unit; separate-door = upright/standalone; chest = deep freezer. */
export type FreezerType = 'compartment' | 'separate-door' | 'chest';
export type BagStatus = 'available' | 'used' | 'discarded';

export const FRESH_WINDOW_HOURS: Record<Exclude<StorageLocation, 'freezer'>, number> = {
 room: 8,
 fridge: 72,
};

export const THAWED_WINDOW_HOURS: Record<Exclude<StorageLocation, 'freezer'>, number> = {
 room: 4,
 fridge: 24,
};

/** Freezer windows by freezer type (family setting; default separate-door = 3 months). */
export const FREEZER_TYPE_WINDOWS: Record<FreezerType, { days: number } | { months: number }> = {
 compartment: { days: 14 },
 'separate-door': { months: 3 },
 chest: { months: 6 },
};

export const DEFAULT_FREEZER_TYPE: FreezerType = 'separate-door';

/** Opt-in expiry notification lead times: Room 2h / Fridge 6h / Freezer 1 day, plus at-expiry. */
export const EXPIRY_LEAD_HOURS: Record<StorageLocation, number> = {
 room: 2,
 fridge: 6,
 freezer: 24,
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Timing fields a bag carries; `lastLocationChangedAt` defaults to `startedAt` when never moved. */
export type BagTiming = {
 startedAt: Date;
 lastLocationChangedAt?: Date | null;
 provenance?: Provenance | null;
 storageLocation?: StorageLocation | null;
};

export type UseByResult = { ok: true; useByAt: Date } | { ok: false; reason: 'thawed-in-freezer' };

function normalize(timing: BagTiming) {
 return {
  provenance: timing.provenance ?? ('fresh' as Provenance),
  storageLocation: timing.storageLocation ?? ('fridge' as StorageLocation),
  startedAt: timing.startedAt,
  lastLocationChangedAt: timing.lastLocationChangedAt ?? timing.startedAt,
 };
}

function addFreezerWindow(from: Date, freezerType: FreezerType): Date {
 const w = FREEZER_TYPE_WINDOWS[freezerType];
 if ('days' in w) return new Date(from.getTime() + w.days * DAY_MS);
 const d = new Date(from);
 d.setUTCMonth(d.getUTCMonth() + w.months);
 return d;
}

/** Use-by instant for a bag, from provenance x location x timestamps x freezer type. */
export function computeUseBy(timing: BagTiming, freezerType: FreezerType): UseByResult {
 const t = normalize(timing);
 if (t.provenance === 'thawed') {
  if (t.storageLocation === 'freezer') return { ok: false, reason: 'thawed-in-freezer' };
  const useByAt = new Date(t.lastLocationChangedAt.getTime() + THAWED_WINDOW_HOURS[t.storageLocation] * HOUR_MS);
  return { ok: true, useByAt };
 }
 const useByAt =
  t.storageLocation === 'freezer'
   ? addFreezerWindow(t.startedAt, freezerType)
   : new Date(t.startedAt.getTime() + FRESH_WINDOW_HOURS[t.storageLocation] * HOUR_MS);
 return { ok: true, useByAt };
}

export type LocationChangeResult =
 | { ok: true; timing: { provenance: Provenance; storageLocation: StorageLocation; startedAt: Date; lastLocationChangedAt: Date } }
 | { ok: false; reason: 'refreeze-blocked' };

/**
 * Apply a one-tap location move. Freezer -> anything derives Thawed and re-anchors the
 * timer to the move; Thawed -> Freezer is blocked; a move into the same location is a no-op.
 */
export function applyLocationChange(timing: BagTiming, to: StorageLocation, movedAt: Date): LocationChangeResult {
 const t = normalize(timing);
 if (to === t.storageLocation) {
  return { ok: true, timing: { ...t, lastLocationChangedAt: t.lastLocationChangedAt } };
 }
 if (t.provenance === 'thawed' && to === 'freezer') {
  return { ok: false, reason: 'refreeze-blocked' };
 }
 const provenance: Provenance = t.storageLocation === 'freezer' ? 'thawed' : t.provenance;
 return {
  ok: true,
  timing: { provenance, storageLocation: to, startedAt: t.startedAt, lastLocationChangedAt: movedAt },
 };
}

/** Warn-and-flag on expiry: true at or past the use-by (or in an invalid state). */
export function isExpired(timing: BagTiming, freezerType: FreezerType, now: Date): boolean {
 const r = computeUseBy(timing, freezerType);
 if (!r.ok) return true;
 return now.getTime() >= r.useByAt.getTime();
}

export type ExpiryAlert = { kind: 'lead' | 'expired'; at: Date };

/**
 * Notification instants for a bag: one lead-time alert before use-by (Room 2h /
 * Fridge 6h / Freezer 1 day) plus one at-expiry alert, ascending.
 */
export function expiryAlertTimes(timing: BagTiming, freezerType: FreezerType): ExpiryAlert[] {
 const r = computeUseBy(timing, freezerType);
 if (!r.ok) return [];
 const leadHours = EXPIRY_LEAD_HOURS[normalize(timing).storageLocation];
 return [
  { kind: 'lead', at: new Date(r.useByAt.getTime() - leadHours * HOUR_MS) },
  { kind: 'expired', at: r.useByAt },
 ];
}
