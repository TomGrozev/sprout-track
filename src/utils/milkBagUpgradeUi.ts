/**
 * Pure UI helpers for the one-time milk-bag upgrade modal (issue #13).
 *
 * Keeps the guided convert-to-bags flow testable in the node-env Vitest setup:
 * - `rowsToBags` validates + maps the modal's row state to `MilkBagUpgradeRequest['bags']`.
 * - `computeUpgradeSum` mirrors `convertLegacyBalance` client-side for the live
 *   leftover readout, in the resolved display unit (`unit`).
 * - `setUpgradeMarker` merges the upgrade marker into the family's
 *   `Settings.milkBagSettings` JSON blob without dropping unknown keys.
 */
import type { MilkBagUpgradeRequest } from '@/src/types/milk-bag';
import type { StorageLocation } from '@/src/utils/milk-storage';
import type { DayNight } from '@/src/utils/milk-bag-rules';
import { convertVolume, normalizeVolumeUnit, type VolumeUnit } from '@/src/utils/unit-conversion';
import { mergeMilkBagBlob } from '@/src/utils/milkBagSettingsUi';

/** Default storage when adding a bag row (matches the backend default). */
export const DEFAULT_UPGRADE_STORAGE: StorageLocation = 'freezer';

/** A row of the convert dialog as the user edits it. */
export type UpgradeRowInput = {
 /** Amount in `unitAbbr` (or ML when unset). */
 amount: number;
 /** Local calendar day the milk was bagged; the DatePicker supplies midnight (00:00 local). */
 baggedDate: Date;
 storageLocation?: StorageLocation;
 dayNight: DayNight;
 unitAbbr?: string | null;
};

/**
 * Validate + map convert-dialog rows into `MilkBagUpgradeRequest['bags']`.
 * Non-finite/<=0 amounts and unparseable dates are rejected (throw), since the
 * request must never carry a malformed bag. No conversion happens here — each
 * row's `amount` passes through unchanged alongside its normalized `unitAbbr`
 * (absent = 'ML', the endpoint default), so the backend handles conversion.
 */
export function rowsToBags(rows: UpgradeRowInput[]): MilkBagUpgradeRequest['bags'] {
 return rows.map((r) => {
  if (!Number.isFinite(r.amount) || r.amount <= 0) {
   throw new Error('milk-bag-invalid-amount');
  }
  if (!(r.baggedDate instanceof Date) || Number.isNaN(r.baggedDate.getTime())) {
   throw new Error('milk-bag-invalid-date');
  }
  const unitAbbr = r.unitAbbr ? (normalizeVolumeUnit(r.unitAbbr) ?? 'ML') : undefined;
  return {
   amount: r.amount,
   baggedAt: serializeBagDate(r.baggedDate),
   storageLocation: r.storageLocation ?? DEFAULT_UPGRADE_STORAGE,
   dayNight: r.dayNight,
   ...(unitAbbr ? { unitAbbr } : {}),
  };
 });
}

/**
 * Bag rows are days; a midnight date D means 'day D'. Expiry compares
 * baggedAt + shelf-life against Date.now(), so midnight D would read ~24h
 * earlier than any moment of day D — emit end-of-day instead.
 */
function serializeBagDate(d: Date): string {
 if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).toISOString();
 }
 return d.toISOString();
}

export type UpgradeRunningSum = {
 /** Total bagged volume in the resolved display unit (`unit`). */
 baggedMl: number;
 /** Remaining legacy balance not yet bagged (in `unit`); 0 when the bags over-sum. */
 leftoverMl: number;
 /** True when the bagged total exceeds the legacy balance (blocked on submit). */
 exceeds: boolean;
 /** Amount in `unit` by which the bagged total exceeds the legacy balance (0 when not over-sum); drives the overshoot warning copy. */
 exceededMl: number;
};

/**
 * Client-side mirror of `convertLegacyBalance` for the live readout. Treats each
 * row amount as already in `unit` (per-row `unitAbbr` overrides) and compares the
 * sum against a legacy total given in `legacyUnit`, converting both into the
 * modal's resolved display `unit` via `convertVolume`. Every returned figure is
 * expressed in `unit`. A `tolerance` (in `unit`, default 0) mirrors the backend
 * `toleranceMl`, absorbing the float noise of a round-tripped display unit so an
 * exact visual OZ match isn't reported as an overshoot or a leftover.
 */
export function computeUpgradeSum(
 legacyTotal: number,
 rows: Array<{ amount: number; unitAbbr?: string | null }>,
 legacyUnit: VolumeUnit = 'ML',
 unit: VolumeUnit = 'ML',
 tolerance = 0,
): UpgradeRunningSum {
 const legacyInUnit = convertVolume(Number.isFinite(legacyTotal) && legacyTotal > 0 ? legacyTotal : 0, legacyUnit, unit);
 let bagged = 0;
 for (const r of rows) {
  if (!Number.isFinite(r.amount) || r.amount <= 0) continue;
  const rowUnit = r.unitAbbr ? (normalizeVolumeUnit(r.unitAbbr) ?? unit) : unit;
  bagged += convertVolume(r.amount, rowUnit, unit);
 }
 const exceeds = bagged > legacyInUnit + tolerance;
 const diff = legacyInUnit - bagged;
 return {
  baggedMl: bagged,
  leftoverMl: exceeds ? 0 : diff <= tolerance ? 0 : diff,
  exceeds,
  exceededMl: exceeds ? bagged - legacyInUnit : 0,
 };
}

/**
 * Merge the one-time upgrade marker into a `Settings.milkBagSettings` JSON blob,
 * preserving every existing key (never a blind replace — the blob may carry
 * family settings the client doesn't know about). Falsy/garbled input starts a
 * fresh blob that still only adds the marker.
 */
export function setUpgradeMarker(settingsRaw: string | null | undefined, now: Date): string {
 return mergeMilkBagBlob(settingsRaw, { milkBagsUpgradedAt: now.toISOString() });
}
