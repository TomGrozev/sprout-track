/**
 * Pure UI helpers for the milk-bag inventory modal (issue #9/#10).
 *
 * These are the testable, DB/UI-agnostic pieces of the inventory surface:
 * deriving the use-by badge, formatting a bag's volume, and shaping a bag row
 * for the modal. The component stays thin — it just renders what these return.
 * Locale-aware display uses formatDateDisplay / formatTimeDisplay with the
 * family's format settings passed in as arguments (matching the repo's
 * compute-only-helper convention).
 */
import type { MilkBagDTO } from '@/src/types/milk-bag';
import type { BagTiming, FreezerType, StorageLocation } from '@/src/utils/milk-storage';
import { computeUseBy, isExpired } from '@/src/utils/milk-storage';
import type { DayNight } from '@/src/utils/milk-bag-rules';
import type { DateFormatSetting, TimeFormatSetting } from '@/src/utils/dateFormat';
import { formatDateDisplay, formatTimeDisplay } from '@/src/utils/dateFormat';

/** Shape of the derived use-by badge. */
export type UseByBadgeResult = {
  /** 'expired' when the bag is at/past its use-by (or in an invalid state). */
  label: 'expired' | 'expires-in';
  /** formatted use-by date ('' when no use-by can be derived). */
  detail: string;
  expired: boolean;
};

/**
 * Derive the use-by badge for a bag's current timing. Uses `computeUseBy` for
 * the instant and `isExpired` for the expired flag (the same source of truth
 * the expiry notifications read). `dateFormat` is the family display setting.
 */
export function useByBadge(
  timing: BagTiming,
  freezerType: FreezerType,
  now: Date,
  dateFormat: DateFormatSetting,
  timezone?: string
): UseByBadgeResult {
  const result = computeUseBy(timing, freezerType);
  if (!result.ok) {
    return { label: 'expired', detail: '', expired: true };
  }
  const expired = isExpired(timing, freezerType, now);
  return {
    label: expired ? 'expired' : 'expires-in',
    detail: formatDateDisplay(result.useByAt, dateFormat, timezone),
    expired,
  };
}

/** Format a bag's stored volume, e.g. `120 ml` / `4 oz` ('' unit omitted). */
export function formatBagVolume(amount: number, unitAbbr?: string | null): string {
  const unit = unitAbbr ? ` ${unitAbbr}` : '';
  return `${amount}${unit}`;
}

/** Map a bag's timestamps into the timing object `computeUseBy`/`isExpired` expect. */
export function bagTiming(bag: MilkBagDTO): BagTiming {
  return {
    startedAt: new Date(bag.startedAt),
    lastLocationChangedAt: bag.lastLocationChangedAt ? new Date(bag.lastLocationChangedAt) : new Date(bag.startedAt),
    provenance: bag.provenance ?? null,
    storageLocation: bag.storageLocation ?? null,
  };
}

/** Formatting settings needed to shape a bag row (family display settings + now). */
export type BagRowOptions = {
  freezerType: FreezerType;
  now: Date;
  dateFormat: DateFormatSetting;
  timeFormat: TimeFormatSetting;
  timezone?: string;
};

/** Presentational model for one inventory row. */
export type BagRowModel = {
  id: string;
  /** Bag label verbatim; '' when absent (caller renders the fallback name). */
  title: string;
  hasLabel: boolean;
  dayNight: DayNight;
  volume: string;
  location: StorageLocation;
  useBy: UseByBadgeResult;
  /** Formatted start times of the pump sessions contained in this bag. */
  pumpTimes: string[];
};

/** Shape a bag (DTO) into a presentational row for the inventory modal. */
export function buildBagRow(bag: MilkBagDTO, opts: BagRowOptions): BagRowModel {
  return {
    id: bag.id,
    title: bag.label ?? '',
    hasLabel: !!bag.label,
    dayNight: bag.dayNight,
    volume: formatBagVolume(bag.amount, bag.unitAbbr),
    location: bag.storageLocation,
    useBy: useByBadge(bagTiming(bag), opts.freezerType, opts.now, opts.dateFormat, opts.timezone),
    pumpTimes: (bag.pumps ?? []).map((p) =>
      formatTimeDisplay(new Date(p.startTime), opts.timeFormat, opts.timezone)
    ),
  };
}
