/**
 * Shared contracts for the milk-bag feature (issues #8-#13).
 * Single source of truth for API payloads and UI consumption — both sides import
 * from here instead of re-declaring shapes.
 */
import type { StorageLocation, Provenance, FreezerType } from '@/src/utils/milk-storage';
import type { DayNight } from '@/src/utils/milk-bag-rules';

/** A milk bag as returned by the API and consumed by the UI. */
export type MilkBagDTO = {
 id: string;
 label: string | null;
 dayNight: DayNight;
 storageLocation: StorageLocation;
 provenance: Provenance;
 amount: number;
 unitAbbr: string | null;
 status: 'available' | 'used' | 'discarded';
 /** First pump's start time — use-by anchor while fresh. */
 startedAt: string; // ISO
 /** Set after a location move (freezer->fridge thaw reset); null = never moved. */
 lastLocationChangedAt: string | null; // ISO
 usedAt: string | null; // ISO
 discardedAmount: number | null;
 babyId: string;
 /** Pump sessions aggregated into this bag (for the inventory modal). */
 pumps: Array<{
  id: string;
  startTime: string; // ISO
  totalAmount: number | null;
  unitAbbr: string | null;
 }>;
};

/** Bag-only totals returned alongside the bag list. */
export type MilkBagTotals = {
 availableBags: number;
 availableMl: number;
 usedMl: number;
 discardedMl: number;
 /** Displayed stored balance = legacy total + sum of available bags. */
 displayedStoredMl: number;
};

/** GET /api/milk-bags response envelope. */
export type MilkBagsResponse = {
 bags: MilkBagDTO[];
 totals: MilkBagTotals;
};

/** Family-level milk-bag settings (Settings.milkBagSettings JSON blob). */
export type MilkBagSettings = {
 dayStartHour: number; // default 7
 dayEndHour: number; // default 19 (exclusive)
 freezerType: FreezerType; // default 'separate-door'
 /** One-time upgrade marker (issue #13): present once the family has opted to
  *  track bags (either going-forward or after convert-to-bags). Gates all bag UI. */
 milkBagsUpgradedAt: string; // ISO
};

/** POST /api/milk-bags request body. */
export type MilkBagCreateRequest = {
 babyId: string;
 amount: number;
 unitAbbr?: string | null;
 label?: string | null;
 storageLocation?: StorageLocation; // default fridge
 dayNight?: DayNight; // derived from startedAt + family boundary when omitted
 startedAt?: string; // ISO; default now
 provenance?: Provenance; // default fresh
};

/** PATCH /api/milk-bags?id= request body (all optional, at least one present). */
export type MilkBagUpdateRequest = {
 storageLocation?: StorageLocation; // one-tap move; freezer->fridge derives thaw + 24h reset; thawed->freezer rejected
 label?: string | null;
 dayNight?: DayNight;
};

/** POST /api/milk-bags/upgrade (issue #13 guided convert-to-bags). */
export type MilkBagUpgradeRequest = {
 babyId: string;
 bags: Array<{
  amount: number;
  baggedAt: string; // ISO
  storageLocation: StorageLocation; // default freezer
  dayNight?: DayNight; // derived from baggedAt + boundary when omitted
  label?: string | null;
 }>;
 /** When bags under-sum the legacy total: true records the leftover as discarded. */
 discardLeftover: boolean;
};

// Feed-from-bag (`milkBagId`) and pump-to-bag (`appendToBagId`) fields live inline on
// `FeedLogCreate` and `PumpLogCreate` in `app/api/types.ts` — no separate contract type;
// `milkBagId` mirrors the `FeedLog.milkBagId` Prisma column directly.
