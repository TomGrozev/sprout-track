/**
 * Pure UI helpers for the "add to bag" feature on the pump form (issue #9).
 * Derives display options from the bag list and eligible-bag filtering.
 * All functions are deterministic — no locale APIs, no side effects.
 */
import type { MilkBagDTO } from '@/src/types/milk-bag';
import { canAddPumpToBag } from '@/src/utils/milk-bag-rules';

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
