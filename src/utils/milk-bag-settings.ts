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
