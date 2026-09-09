/**
 * Pure helpers for the milk-bag picker in the feed form.
 * No I/O, deterministic, fully unit-testable.
 */
import type { MilkBagDTO } from '@/src/types/milk-bag';
import { computeUseBy, BagTiming } from '@/src/utils/milk-storage';
import { suggestBagForFeed } from '@/src/utils/milk-bag-rules';

/**
 * Build a display label for a bag option.
 * e.g. `'Day 120 ml'`, `'Night 3 oz'`, `'Day 120 ml — expires 2026-09-10'`.
 */
export function bagOptionLabel(
  bag: MilkBagDTO,
  dayLabel: string,
  nightLabel: string,
): string {
  const timeLabel = bag.dayNight?.toLowerCase() === 'day' ? dayLabel : nightLabel;
  const amount = bag.amount;
  const unit = bag.unitAbbr ?? '';
  const unitPart = unit ? ` ${unit}` : '';
  const result = `${timeLabel} ${amount}${unitPart}`;
  if (bag.label) {
    return `${result} — ${bag.label}`;
  }
  return result;
}

/**
 * Compute a use-by date ISO string (YYYY-MM-DD) for a bag, given the freezer type.
 * Returns null if the bag is in an invalid state (e.g. thawed-in-freezer).
 */
export function computeExpiryDate(bag: MilkBagDTO, freezerType: string): string | null {
  const timing: BagTiming = {
    startedAt: new Date(bag.startedAt),
    lastLocationChangedAt: bag.lastLocationChangedAt ? new Date(bag.lastLocationChangedAt) : new Date(bag.startedAt),
    provenance: bag.provenance ? bag.provenance : undefined,
    storageLocation: bag.storageLocation ?? undefined,
  };
  try {
    const result = computeUseBy(timing, freezerType as 'compartment' | 'separate-door' | 'chest');
    if (!result.ok) return null;
    return result.useByAt.toISOString().split('T')[0]; // YYYY-MM-DD
  } catch {
    return null;
  }
}

/**
 * Map raw MilkBagDTOs to UI-friendly options plus a suggested bag.
 * Returns `{ suggestedId, options }` where each option has `id` and `label`.
 * Available bags (status === 'available') are included; consumed bags are excluded.
 * The suggestion is pre-computed using the family day/night boundary.
 */
export function mapBagsToOptions(
  bags: MilkBagDTO[],
  now: Date,
  dayStartHour: number,
  dayEndHour: number,
  freezerType: string,
): { suggestedId: string | null; options: Array<{ id: string; label: string }> } {
  const dayLabel = 'Day';
  const nightLabel = 'Night';

  // Enrich available bags for suggestion: compute useByAt from storage timing
  const enrichedBags: Array<MilkBagDTO & { useByAt: Date | null }> = [];
  for (const bag of bags) {
    if (bag.status && bag.status !== 'available') continue;
    const expiry = computeExpiryDate(bag, freezerType);
    const useByAt = expiry ? new Date(expiry + 'T00:00:00Z') : null;
    const bagWithUseBy = { ...bag, useByAt };
    enrichedBags.push(bagWithUseBy);
  }

  // Suggest the best bag
  const suggestion = suggestBagForFeed(enrichedBags, now, dayStartHour, dayEndHour);
  const suggestedId = suggestion?.id ?? null;

  // Build options list using bagOptionLabel
  const options = enrichedBags.map((bag) => ({
    id: bag.id,
    label: `${bagOptionLabel(bag, dayLabel, nightLabel)}`,
  }));

  return { suggestedId, options };
}
