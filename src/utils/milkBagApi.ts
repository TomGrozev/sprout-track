/**
 * Pure helpers for milk-bag CRUD (issues #9, #10, #13).
 * DB/UI agnostic, unit-testable. Routes import these to map between
 * Prisma rows and the MilkBag contract, validate inputs, and derive values.
 */
import type { MilkBagDTO, MilkBagCreateRequest, MilkBagUpdateRequest, MilkBagUpgradeRequest, MilkBagSettings } from '@/src/types/milk-bag';
import type { MilkBagTotals, MilkBagsResponse } from '@/src/types/milk-bag';
import type { DayNight } from '@/src/utils/milk-bag-rules';
import { deriveDayNight, DEFAULT_DAY_NIGHT_BOUNDARY, convertLegacyBalance, type LegacyBagInput, type ConversionResult } from '@/src/utils/milk-bag-rules';
import { DEFAULT_FREEZER_TYPE } from '@/src/utils/milk-storage';
import { loadMilkBagSettings } from '@/src/utils/milk-bag-settings';
import { convertVolume, type VolumeUnit } from '@/src/utils/unit-conversion';

/* ------------------------------------------------------------------ */

/**
 * Format a Date to ISO-8601 string, or return null.
 * Mirrors formatForResponse from app/api/utils/timezone.ts but stays
 * pure-node so unit tests don't pull in prisma.db.
 */
export function formatDateIso(date: Date | string | null): string | null {
 if (!date) return null;
 const d = typeof date === 'string' ? new Date(date) : date;
 if (Number.isNaN(d.getTime())) return null;
 return d.toISOString();
}

/* ------------------------------------------------------------------ */

export type PrismaMilkBagRow = {
 id: string;
 label: string | null;
 dayNight: string;
 storageLocation: string;
 provenance: string;
 amount: number;
 unitAbbr: string | null;
 status: string;
 startedAt: Date | string;
 lastLocationChangedAt: Date | string | null;
 usedAt: Date | string | null;
 discardedAmount: number | null;
 babyId: string;
 pumps: Array<{
  id: string;
  startTime: Date | string;
  totalAmount: number | null;
  unitAbbr: string | null;
 }>;
};

/**
 * Map a Prisma MilkBag row (with eager-loaded pumps) to the DTO.
 * Null discipline: null stays null, never an empty string.
 */
export function rowToMilkBagDTO(row: PrismaMilkBagRow): MilkBagDTO {
 return {
  id: row.id,
  label: row.label,
  dayNight: (row.dayNight as DayNight) ?? 'day',
  storageLocation: row.storageLocation as MilkBagDTO['storageLocation'],
  provenance: row.provenance as MilkBagDTO['provenance'],
  amount: row.amount,
  unitAbbr: row.unitAbbr,
  status: row.status as MilkBagDTO['status'],
  startedAt: formatDateIso(row.startedAt) ?? '',
  lastLocationChangedAt: formatDateIso(row.lastLocationChangedAt),
  usedAt: formatDateIso(row.usedAt),
  discardedAmount: row.discardedAmount,
  babyId: row.babyId,
  pumps: row.pumps.map((p) => ({
   id: p.id,
   startTime: formatDateIso(p.startTime) ?? '',
   totalAmount: p.totalAmount,
   unitAbbr: p.unitAbbr,
  })),
 };
}

/* ------------------------------------------------------------------ */

/**
 * Derive day/night for a timestamp using the family's day/night boundary.
 * Falls back to the system boundary if settings are not provided.
 */
export function computeBagDayNight(
 startedAt: Date,
 settings?: Pick<MilkBagSettings, 'dayStartHour' | 'dayEndHour'>,
): DayNight {
 const dayStart = settings?.dayStartHour ?? DEFAULT_DAY_NIGHT_BOUNDARY.dayStartHour;
 const dayEnd = settings?.dayEndHour ?? DEFAULT_DAY_NIGHT_BOUNDARY.dayEndHour;
 return deriveDayNight(startedAt, dayStart, dayEnd);
}

/* ------------------------------------------------------------------ */

export type CreateValidationResult =
 | { ok: true }
 | { ok: false; error: string };

/**
 * Validate a MilkBagCreateRequest before hitting prisma.
 * Required: babyId (string), amount (> 0). unitAbbr defaults 'OZ'.
 */
export function validateCreateRequest(req: MilkBagCreateRequest): CreateValidationResult {
 if (!req.babyId || typeof req.babyId !== 'string') {
  return { ok: false, error: 'babyId is required' };
 }
 if (typeof req.amount !== 'number' || !Number.isFinite(req.amount) || req.amount <= 0) {
  return { ok: false, error: 'amount must be a number greater than 0' };
 }
 return { ok: true };
}

/* ------------------------------------------------------------------ */

/**
 * Map upgrade request bags + family settings to LegacyBagInput[] for
 * convertLegacyBalance, plus compute the bag-level dayNight.
 */
export function mapUpgradeInput(
 req: MilkBagUpgradeRequest,
 unit: VolumeUnit = 'ML',
): { bagInput: LegacyBagInput[]; conversionArg: LegacyBagInput[] } {
 return {
  bagInput: req.bags.map((b) => ({
   amountMl: convertVolume(b.amount, unit, 'ML'),
   baggedAt: new Date(b.baggedAt),
   storageLocation: b.storageLocation,
   dayNight: b.dayNight ?? 'day',
  })),
  // alias so the returned array can be passed directly to convertLegacyBalance
  conversionArg: req.bags.map((b) => ({
   amountMl: convertVolume(b.amount, unit, 'ML'),
   baggedAt: new Date(b.baggedAt),
   storageLocation: b.storageLocation,
   dayNight: b.dayNight ?? 'day',
  })),
 };
}

/**
 * The 'Converted to bags' BreastMilkAdjustment debit, in `unit` (the unit the
 * whole upgrade flow resolves to — stored as-is on the record). The caller
 * passes the already-clamped base (min of the bagged sum and the legacy total,
 * both in `unit`), so the legacy balance never goes negative when the user
 * overrides the overshoot warning. Rounded to 2 decimals for storage and never
 * returns -0.
 */
export function adjustmentDebit(amount: number, unit: VolumeUnit): number {
 const rounded = Math.round(amount * 100) / 100;
 return rounded === 0 ? 0 : -rounded;
}

/**
 * Validate a MilkBagUpdateRequest — at least one field must be present.
 */
export function validateUpdateRequest(req: MilkBagUpdateRequest): CreateValidationResult {
 const hasField = !!(
  req.storageLocation !== undefined ||
  req.label !== undefined ||
  req.dayNight !== undefined
 );
 if (!hasField) {
  return { ok: false, error: 'At least one of storageLocation, label, or dayNight is required' };
 }
 return { ok: true };
}

/* ------------------------------------------------------------------ */

/**
 * Build the bag-level timing object consumed by applyLocationChange and
 * computeUseBy. Reads directly from a Prisma row's timestamp fields.
 */
export function makeBagTiming(startedAt: Date, lastLocationChangedAt: Date | null): {
 startedAt: Date;
 lastLocationChangedAt: Date | null;
} {
 return {
  startedAt,
  lastLocationChangedAt: lastLocationChangedAt ?? startedAt,
 };
}
