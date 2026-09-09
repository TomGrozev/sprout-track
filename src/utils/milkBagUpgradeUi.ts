/**
 * Pure UI helpers for the one-time milk-bag upgrade modal (issue #13).
 *
 * Keeps the guided convert-to-bags flow testable in the node-env Vitest setup:
 * - `rowsToBags` validates + maps the modal's row state to `MilkBagUpgradeRequest['bags']`.
 * - `computeUpgradeSum` mirrors `convertLegacyBalance` client-side for the live
 *   leftover readout (as ML, matching the ML-based backend semantics).
 * - `setUpgradeMarker` merges the upgrade marker into the family's
 *   `Settings.milkBagSettings` JSON blob without dropping unknown keys.
 */
import type { MilkBagUpgradeRequest } from '@/src/types/milk-bag';
import type { StorageLocation } from '@/src/utils/milk-storage';
import type { DayNight } from '@/src/utils/milk-bag-rules';
import { convertVolume, normalizeVolumeUnit } from '@/src/utils/unit-conversion';
import { mergeMilkBagBlob } from '@/src/utils/milkBagSettingsUi';

/** Default storage when adding a bag row (matches the backend default). */
export const DEFAULT_UPGRADE_STORAGE: StorageLocation = 'freezer';

/** A row of the convert dialog as the user edits it. */
export type UpgradeRowInput = {
 /** Amount in `unitAbbr` (or ML when unset). */
 amount: number;
 /** Local wall-clock bag date; serialized to ISO for the request. */
 baggedAt: Date;
 storageLocation?: StorageLocation;
 dayNight: DayNight;
 unitAbbr?: string | null;
};

/**
 * Validate + map convert-dialog rows into `MilkBagUpgradeRequest['bags']`.
 * Non-finite/<=0 amounts and unparseable dates are rejected (throw), since the
 * request must never carry a malformed bag. Amounts are normalised to ML once a
 * row carries a non-ML `unitAbbr` — the upgrade endpoint consumes ML.
 */
export function rowsToBags(rows: UpgradeRowInput[]): MilkBagUpgradeRequest['bags'] {
 return rows.map((r) => {
  if (!Number.isFinite(r.amount) || r.amount <= 0) {
   throw new Error('milk-bag-invalid-amount');
  }
  if (!(r.baggedAt instanceof Date) || Number.isNaN(r.baggedAt.getTime())) {
   throw new Error('milk-bag-invalid-date');
  }
  // Absent unitAbbr means the row is already in the modal's ML unit — only
  // convert when the row explicitly carries a non-ML unit.
  const unit = r.unitAbbr ? normalizeVolumeUnit(r.unitAbbr) : 'ML';
  const amount = unit && unit !== 'ML' ? convertVolume(r.amount, unit, 'ML') : r.amount;
  return {
   amount,
   baggedAt: r.baggedAt.toISOString(),
   storageLocation: r.storageLocation ?? DEFAULT_UPGRADE_STORAGE,
   dayNight: r.dayNight,
  };
 });
}

export type UpgradeRunningSum = {
 /** Total bagged volume in ML. */
 baggedMl: number;
 /** Remaining legacy balance not yet bagged (ML); 0 when the bags over-sum. */
 leftoverMl: number;
 /** True when the bagged total exceeds the legacy balance (blocked on submit). */
 exceeds: boolean;
};

/**
 * Client-side mirror of `convertLegacyBalance` for the live readout: sums the
 * bagged amounts (each converted to ML when it carries a `unitAbbr`) against a
 * legacy total given in `legacyUnit`. `legacyTotal`/`unitAbbr` round-tripping
 * through `convertVolume` keeps every figure in ML for a single-unit readout.
 */
export function computeUpgradeSum(
 legacyTotal: number,
 rows: Array<{ amount: number; unitAbbr?: string | null }>,
 legacyUnit = 'ML',
): UpgradeRunningSum {
 const legacyMl = convertVolume(Number.isFinite(legacyTotal) && legacyTotal > 0 ? legacyTotal : 0, legacyUnit, 'ML');
 let baggedMl = 0;
 for (const r of rows) {
  if (!Number.isFinite(r.amount) || r.amount <= 0) continue;
  const unit = r.unitAbbr ? (normalizeVolumeUnit(r.unitAbbr) ?? 'ML') : 'ML';
  baggedMl += convertVolume(r.amount, unit, 'ML');
 }
 const exceeds = baggedMl > legacyMl;
 return { baggedMl, leftoverMl: exceeds ? 0 : legacyMl - baggedMl, exceeds };
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
