/**
 * Pure UI helpers for the "add to bag" feature on the pump form (issue #9).
 * Derives display options from the bag list and eligible-bag filtering.
 * All functions are deterministic — no locale APIs, no side effects.
 */
import type { MilkBagDTO } from '@/src/types/milk-bag';
import { canAddPumpToBag, deriveDayNight, type DayNight } from '@/src/utils/milk-bag-rules';

/**
 * Day/night label a new bag would get for a pump starting at `startTime`,
 * using the family boundary. Display-only preview: the same value is sent to
 * the server as `newBagDayNight` unless the user taps the other label.
 */
export function pumpBagDayNight(
 startTime: Date,
 dayStartHour: number,
 dayEndHour: number,
): DayNight {
 return deriveDayNight(startTime, dayStartHour, dayEndHour);
}

/** Day/night label values accepted for a new bag. */
const DAY_NIGHT_VALUES = ['day', 'night'] as const;

/** Decision for what POST /api/pump-log should do with the pumped milk (issue #9). */
export type PumpBagPlan =
 | { ok: true; mode: 'existing' } // append to appendToBagId (eligibility re-checked against the DB row)
 | { ok: true; mode: 'new'; dayNight: 'day' | 'night' } // label derived client-side from the pump start (user-overridable)
 | { ok: true; mode: 'none' } // no bag intent (tracking off / FED / DISCARDED without a bag)
 | { ok: false; status: number; error: string };

/**
 * Plan the bag side of a pump-log create from the form's submit fields.
 * Enforces the mutual exclusion (existing bag XOR new bag), the STORED-only and
 * amount>0 rules for creating a bag, and validates the day/night override.
 * Pure — the route still re-checks bag eligibility/ownership against the DB.
 */
export function planPumpBag(input: {
 appendToBagId?: string | null;
 newBagDayNight?: string | null;
 pumpAction: string;
 totalAmount: number | null | undefined;
}): PumpBagPlan {
 const { appendToBagId, newBagDayNight, pumpAction, totalAmount } = input;
 if (appendToBagId && newBagDayNight !== undefined && newBagDayNight !== null) {
  return {
   ok: false,
   status: 422,
   error: 'Choose either an existing bag or a new bag, not both.',
  };
 }
 if (appendToBagId) {
  if (pumpAction !== 'STORED') {
   return {
    ok: false,
    status: 422,
    error: 'Only stored milk can be saved into a bag.',
   };
  }
  return { ok: true, mode: 'existing' };
 }
 if (newBagDayNight === undefined || newBagDayNight === null) {
  // No explicit new-bag label: the UI always sends one with bag tracking on;
  // absent means no bag intent (or a plain API client).
  return { ok: true, mode: 'none' };
 }
 if (!DAY_NIGHT_VALUES.includes(newBagDayNight as 'day' | 'night')) {
  return { ok: false, status: 422, error: 'Bag label must be day or night.' };
 }
 if (pumpAction !== 'STORED') {
  return {
   ok: false,
   status: 422,
   error: 'Only stored milk can be saved into a new bag.',
  };
 }
 if (!totalAmount || Number(totalAmount) <= 0) {
  return {
   ok: false,
   status: 422,
   error: 'Enter an amount to save into a new bag.',
  };
 }
 return { ok: true, mode: 'new', dayNight: newBagDayNight as 'day' | 'night' };
}

/** Result of filtering bags for append eligibility. */
export type EligibleBag = MilkBagDTO & { _eligible: boolean };

/**
 * Return bags that are `available` and started within the last 24 hours,
 * sorted newest-start first.
 *
 * @param bags - bags as returned by the API (MilkBagDTO has `startedAt` as ISO string)
 * @param nowMs - current epoch-ms (allows deterministic test seeding)
 * @param dayStartHour / dayEndHour - family boundaries, forwarded for display
 */
export function eligibleBagsForAppend(
 bags: MilkBagDTO[],
 nowMs: number,
 dayStartHour: number,
 dayEndHour: number,
): EligibleBag[] {
 const now = new Date(nowMs);
 return bags
  .filter((bag) => {
   const startedAt = new Date(bag.startedAt);
   if (isNaN(startedAt.getTime())) return false;
   const result = canAddPumpToBag(
    { startedAt, status: bag.status },
    now,
   );
   return result.ok;
  })
  .map((bag) => ({
   ...bag,
   _eligible: true,
  }))
  .sort(
   (a, b) =>
    new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
}

/** Display fields that keep the form component thin. */
export type BagAppendOption = {
 /** The bag id to send as appendToBagId on submit. */
 id: string;
 /** Title line shown in the select option (human-readable label). */
 label: string;
 /** Already-stored volume string for context. */
 volumeLine: string;
 /** "HHh MMm left" text (<24h remaining). */
 remainingText: string;
};

/**
 * Build a display tuple for one eligible bag.
 * Time formatting uses pure arithmetic — no `Intl` — so tests are deterministic.
 *
 * @param bag - an eligible bag (already filtered by `canAddPumpToBag`)
 * @param nowMs - epoch-ms for the "now" reference
 * @param dayStartHour / dayEndHour - forwarded for display
 */
export function bagAppendOption(
 bag: EligibleBag,
 nowMs: number,
 dayStartHour: number,
 dayEndHour: number,
): BagAppendOption {
 const now = new Date(nowMs);
 const startedAt = new Date(bag.startedAt);
 const elapsedMs = now.getTime() - startedAt.getTime();
 const remainingMs = 24 * 60 * 60 * 1000 - elapsedMs;
 const remainingHr = Math.floor(remainingMs / (60 * 60 * 1000));
 const remainingMin = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));

 return {
  id: bag.id,
  label:
   bag.label ??
   `${bag.dayNight ?? 'day'} bag`,
  volumeLine: `${bag.amount} ${bag.unitAbbr ?? 'ml'}`,
  remainingText: `${remainingHr}h ${String(remainingMin).padStart(2, '0')}m left`,
 };
}
