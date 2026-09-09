/**
 * Pure client helpers for the family's `Settings.milkBagSettings` JSON blob
 * (issue #10). Node-env testable. The blob may carry family settings the
 * caller doesn't know about (day/night boundary, upgrade marker, future
 * fields) — every write goes through `mergeMilkBagBlob`, which never drops
 * unknown keys, and falls back to a fresh blob for falsy/garbled/non-object
 * input.
 */
import type { FreezerType } from '@/src/utils/milk-storage';

/**
 * Merge one key into the blob, preserving every existing key. Shared by all
 * milkBagSettings writers (upgrade marker in milkBagUpgradeUi.ts, freezer
 * type here) so the never-blind-replace discipline lives in exactly one place.
 */
export function mergeMilkBagBlob(
 settingsRaw: string | null | undefined,
 entry: Record<string, unknown>,
): string {
 let blob: unknown = {};
 if (settingsRaw) {
  try {
   blob = JSON.parse(settingsRaw);
  } catch {
   blob = {};
  }
 }
 if (typeof blob !== 'object' || blob === null || Array.isArray(blob)) {
  blob = {};
 }
 return JSON.stringify({ ...(blob as Record<string, unknown>), ...entry });
}

/** Merge the family's freezer type into the Settings.milkBagSettings blob. */
export function setFreezerType(settingsRaw: string | null | undefined, freezerType: FreezerType): string {
 return mergeMilkBagBlob(settingsRaw, { freezerType });
}
