/**
 * Pure bag-lifecycle rules: day/night auto-labeling from the first pump's time,
 * the 24h add-a-pump-to-bag eligibility rule, feed-time bag suggestion, single-use
 * consumption with leftover discard, and the guided legacy-balance conversion math.
 * Companion to milk-storage.ts (use-by/provenance/location rules). Dependency-free.
 */
import type { BagTiming } from '@/src/utils/milk-storage';

export type DayNight = 'day' | 'night';

/** Family day/night boundary setting (hours). Default 07:00-19:00. */
export type DayNightBoundary = { dayStartHour: number; dayEndHour: number };

export const DEFAULT_DAY_NIGHT_BOUNDARY: DayNightBoundary = { dayStartHour: 7, dayEndHour: 19 };

export const DAY_NIGHT_BOUNDARY_LIMITS = { minStart: 0, maxStart: 23, minEnd: 1, maxEnd: 24 };

/**
 * Derive day/night from a local wall-clock hour and family boundary [start, end).
 * Hours >= end or < start are night. Used for the auto-label and never shown as
 * authoritative once the user overrides it — override wins downstream.
 */
export function deriveDayNight(at: Date, dayStartHour: number, dayEndHour: number): DayNight {
 return at.getHours() >= dayStartHour && at.getHours() < dayEndHour ? 'day' : 'night';
}

export type AddToBagResult = { ok: true } | { ok: false; reason: 'bag-unavailable' | 'not-supported' | 'too-old' };

/**
 * A pump may join an existing bag only while the bag was started within the last
 * 24h (top-ups are realistic and safe) and the bag is still available.
 */
export function canAddPumpToBag(
 bag: BagTiming & { status?: string | null },
 at: Date,
): { ok: true } | { ok: false; reason: 'bag-unavailable' | 'too-old' | 'not-supported' } {
 if (bag.status && bag.status !== 'available') return { ok: false, reason: 'bag-unavailable' };
 const elapsedMs = at.getTime() - bag.startedAt.getTime();
 if (elapsedMs < 0) return { ok: false, reason: 'not-supported' };
 if (elapsedMs > 24 * 60 * 60 * 1000) return { ok: false, reason: 'too-old' };
 return { ok: true };
}

export type SuggestableBag = {
 id: string;
 dayNight: DayNight | null | undefined;
 status: string | null | undefined;
 useByAt?: Date | null;
};

/**
 * Auto-suggest a bag for a feed: prefer the current time-of-day label, soonest
 * use-by first within matched label; fall back to the other label. Never suggests
 * unavailable bags.
 */
export function suggestBagForFeed<T extends SuggestableBag>(
 bags: T[],
 now: Date,
 dayStartHour: number,
 dayEndHour: number,
): T | undefined {
 const available = bags.filter((b) => !b.status || b.status === 'available');
 if (available.length === 0) return undefined;
 const label = deriveDayNight(now, dayStartHour, dayEndHour);
 const ranked = [...available].sort((a, b) => {
  const av = a.useByAt ? a.useByAt.getTime() : Number.POSITIVE_INFINITY;
  const bv = b.useByAt ? b.useByAt.getTime() : Number.POSITIVE_INFINITY;
  return av - bv;
 });
 return ranked.find((b) => b.dayNight === label) ?? ranked.find((b) => b.dayNight !== label || !b.dayNight) ?? undefined;
}

export type BalanceBag = { amountMl: number; status: string | null | undefined };

export type InventoryTotals = {
 availableBags: number;
 availableMl: number;
 usedMl: number;
 discardedMl: number;
 /** Displayed stored balance = legacy total + sum of available bags. */
 displayedStoredMl: number;
};

/** Balance model over a family's bags plus its legacy running total. */
export function inventoryTotals(legacyTotalMl: number, bags: BalanceBag[]): InventoryTotals {
 const isAvail = (s: string | null | undefined) => !s || s === 'available';
 const availableMl = bags.filter((b) => isAvail(b.status)).reduce((s, b) => s + b.amountMl, 0);
 return {
  availableBags: bags.filter((b) => isAvail(b.status)).length,
  availableMl,
  usedMl: bags.filter((b) => b.status === 'used').reduce((s, b) => s + b.amountMl, 0),
  discardedMl: bags.filter((b) => b.status === 'discarded').reduce((s, b) => s + b.amountMl, 0),
  displayedStoredMl: legacyTotalMl + availableMl,
 };
}
export type ConsumableBag = { id: string; amountMl: number; status: string | null | undefined };

export type ConsumptionResult = {
 bag: ConsumableBag;
 fedMl: number;
 discardedMl: number;
};

/** Single-use consumption: the bag closes, fed = min(fed, amount), leftover discards. */
export function consumeBag(bag: ConsumableBag, fedMl: number): ConsumptionResult {
 if (bag.status && bag.status !== 'available') {
  throw new Error(`Bag ${bag.id} is not available (status: ${bag.status ?? 'unknown'})`);
 }
 if (!Number.isFinite(fedMl) || fedMl <= 0) {
  throw new Error(`Fed amount must be positive, got ${fedMl}`);
 }
 const actuallyFed = Math.min(fedMl, bag.amountMl);
 return {
  bag: { ...bag, status: 'used' },
  fedMl: actuallyFed,
  discardedMl: bag.amountMl - actuallyFed,
 };
}

export type LegacyBagInput = {
 amountMl: number;
 baggedAt: Date;
 storageLocation: 'room' | 'fridge' | 'freezer';
 dayNight: DayNight;
};

export type ConversionResult =
 | { ok: true; leftoverMl: number }
 | { ok: false; reason: 'exceeds-total' | 'empty-for-nonzero-total' | 'invalid-amount' };

/**
 * Guided convert-to-bags: bag amounts must sum to <= the legacy total. A shortfall
 * is allowed but surfaces leftoverMl so the UI can ask "discard leftover X?"; an
 * overshoot is rejected. The legacy balance then decrements by the bagged amount.
 */
export function convertLegacyBalance(legacyTotalMl: number, bags: LegacyBagInput[]): ConversionResult {
 if (!Number.isFinite(legacyTotalMl) || legacyTotalMl < 0) return { ok: false, reason: 'invalid-amount' };
 if (bags.length === 0) {
  return legacyTotalMl === 0 ? { ok: true, leftoverMl: 0 } : { ok: false, reason: 'empty-for-nonzero-total' };
 }
 const invalid = bags.find((b) => !Number.isFinite(b.amountMl) || b.amountMl <= 0);
 if (invalid) return { ok: false, reason: 'invalid-amount' };
 const baggedMl = bags.reduce((s, b) => s + b.amountMl, 0);
 if (baggedMl > legacyTotalMl) return { ok: false, reason: 'exceeds-total' };
 return { ok: true, leftoverMl: legacyTotalMl - baggedMl };
}
