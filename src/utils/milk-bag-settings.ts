/**
 * Server-side helpers for the milk-bag feature: family settings blob resolution
 * and timezone-aware day/night derivation. Companion to the pure modules
 * (milk-storage.ts, milk-bag-rules.ts) which stay DB/UI agnostic.
 */
import type { PrismaClient } from '@prisma/client';
import { DEFAULT_FREEZER_TYPE } from '@/src/utils/milk-storage';
import type { FreezerType } from '@/src/utils/milk-storage';
import {
 DEFAULT_DAY_NIGHT_BOUNDARY,
 deriveDayNight,
} from '@/src/utils/milk-bag-rules';
import type { DayNight } from '@/src/utils/milk-bag-rules';
import type { MilkBagSettings } from '@/src/types/milk-bag';

/**
 * Validate a `Settings.milkBagSettings` JSON payload for write (issue #10):
 * the blob must be a JSON object whose known keys — if present — are of the
 * right shape. Unknown keys pass through untouched (forward compatibility);
 * the DB write stores the compacted JSON of the parsed payload so garbled
 * bytes never reach the lifecycle logic that reads this blob.
 */
export type ValidateMilkBagSettingsResult =
 | { ok: true; compacted: string }
 | { ok: false; error: string };

const FREEZER_TYPE_VALUES: readonly string[] = ['compartment', 'separate-door', 'chest'];

function isHour(value: unknown): boolean {
 return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23;
}

export function validateMilkBagSettings(raw: unknown): ValidateMilkBagSettingsResult {
 if (typeof raw !== 'string') return { ok: false, error: 'Milk bag settings must be a JSON string' };
 let parsed: unknown;
 try {
  parsed = JSON.parse(raw);
 } catch {
  return { ok: false, error: 'Milk bag settings must be valid JSON' };
 }
 if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
  return { ok: false, error: 'Milk bag settings must be a JSON object' };
 }
 const blob = parsed as Record<string, unknown>;
 if (blob.freezerType !== undefined && (typeof blob.freezerType !== 'string' || !FREEZER_TYPE_VALUES.includes(blob.freezerType))) {
  return { ok: false, error: 'Milk bag settings freezerType must be compartment, separate-door or chest' };
 }
 if (blob.dayStartHour !== undefined && !isHour(blob.dayStartHour)) {
  return { ok: false, error: 'Milk bag settings dayStartHour must be an integer between 0 and 23' };
 }
 if (blob.dayEndHour !== undefined && !isHour(blob.dayEndHour)) {
  return { ok: false, error: 'Milk bag settings dayEndHour must be an integer between 0 and 23' };
 }
 if (blob.milkBagsUpgradedAt !== undefined && blob.milkBagsUpgradedAt !== null && typeof blob.milkBagsUpgradedAt !== 'string') {
  return { ok: false, error: 'Milk bag settings milkBagsUpgradedAt must be a timestamp string' };
 }
 return { ok: true, compacted: JSON.stringify(parsed) };
}

/** Family milk-bag settings with the upgrade marker separated out. */
export type ResolvedMilkBagSettings = Omit<MilkBagSettings, 'milkBagsUpgradedAt'> & {
 milkBagsUpgradedAt: string | null;
};

/** Read the family's milk-bag settings, applying defaults for absent fields. */
export function resolveMilkBagSettings(raw: string | null | undefined): ResolvedMilkBagSettings {
 let parsed: Partial<MilkBagSettings> = {};
 if (raw) {
  try {
   parsed = JSON.parse(raw) as Partial<MilkBagSettings>;
  } catch {
   parsed = {};
  }
 }
 return {
  dayStartHour: parsed.dayStartHour ?? DEFAULT_DAY_NIGHT_BOUNDARY.dayStartHour,
  dayEndHour: parsed.dayEndHour ?? DEFAULT_DAY_NIGHT_BOUNDARY.dayEndHour,
  freezerType: parsed.freezerType ?? DEFAULT_FREEZER_TYPE,
  milkBagsUpgradedAt: parsed.milkBagsUpgradedAt ?? null,
 };
}

/**
 * Derive day/night for a timestamp in the family's display timezone (falls back
 * to the server timezone when tz is unknown — the same convention as dateFormat).
 */
export function deriveDayNightForZone(at: Date, dayStartHour: number, dayEndHour: number, timezone?: string): DayNight {
 if (!timezone) return deriveDayNight(at, dayStartHour, dayEndHour);
 const hour = Number(
  new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone }).format(at),
 );
 return deriveDayNight(new Date(2000, 0, 1, Number.isFinite(hour) ? hour % 24 : 0), dayStartHour, dayEndHour);
}

/** Loaded family milk-bag settings plus the timezone used for derivations. */
export type LoadedMilkBagSettings = {
 settings: ResolvedMilkBagSettings;
 timezone?: string;
};

/** Load the family's milk-bag settings from the Settings row (null family = defaults). */
export async function loadMilkBagSettings(
 db: PrismaClient,
 familyId: string,
 timezone?: string,
): Promise<LoadedMilkBagSettings> {
 const row = await db.settings.findFirst({
  where: { familyId },
  select: { milkBagSettings: true },
 });
 return { settings: resolveMilkBagSettings(row?.milkBagSettings), timezone };
}
