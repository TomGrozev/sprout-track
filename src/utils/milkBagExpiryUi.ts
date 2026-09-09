/**
 * Pure UI/check helpers for milk-bag expiry (issue #12).
 *
 * These are the testable, DB/UI-agnostic pieces of the milk-expiry feature:
 * the warn-not-block feed guard and the scheduling/dedup state machine used by
 * the scheduled `checkMilkBagExpirations` pass. Dependency-light on purpose so
 * they run in the node-env Vitest setup exactly like the other `src/utils`
 * modules.
 *
 * - `assertFeedAllowed` — warn, never block: a bag that is at/past its use-by
 *   is reported as `{ ok: false, expired: true }` so the caller can surface a
 *   warning, but nothing here ever refuses the feed.
 * - `milkExpiryDueAlerts` / `advanceExpiryNotifiedAt` — the dedup state machine
 *   behind `MilkBag.expiryNotifiedAt`: which lead/at-expiry thresholds still
 *   need a push, and what the bag's stored "last notified" timestamp becomes.
 */

import {
  BagTiming,
  FreezerType,
  ExpiryAlert,
  expiryAlertTimes,
  isExpired,
} from '@/src/utils/milk-storage';
import { makeBagTiming } from '@/src/utils/milkBagApi';
import type { MilkBagDTO } from '@/src/types/milk-bag';

export type FeedAllowedResult = { ok: true } | { ok: false; expired: true };

/**
 * Warn-not-block guard for the feed surface. Returns `{ ok: false, expired:
 * true }` when the bag is at or past its use-by (or in an invalid state);
 * otherwise `{ ok: true }`. The name and shape are chosen so callers treat it
 * as a warning signal — it never returns an error that blocks consumption.
 */
export function assertFeedAllowed(
  timing: BagTiming,
  freezerType: FreezerType,
  now: Date
): FeedAllowedResult {
  return isExpired(timing, freezerType, now)
    ? { ok: false, expired: true }
    : { ok: true };
}

/**
 * True when a bag is at/past its use-by (or in an invalid state such as a
 * thawed bag sitting in the freezer). Mirrors `assertFeedAllowed` over a
 * `MilkBagDTO`, defaulting missing timestamps to `startedAt` the same way
 * `computeExpiryDate` does. `now` defaults to the current time; the predicate
 * is warn-not-block, so it only flags — it never blocks consumption.
 */
export function isBagExpired(
  bag: MilkBagDTO,
  freezerType: FreezerType,
  now: Date = new Date()
): boolean {
  const timing: BagTiming = {
    ...makeBagTiming(
      new Date(bag.startedAt),
      bag.lastLocationChangedAt ? new Date(bag.lastLocationChangedAt) : null
    ),
    provenance: bag.provenance ?? undefined,
    storageLocation: bag.storageLocation ?? undefined,
  };
  return !assertFeedAllowed(timing, freezerType, now).ok;
}

/**
 * Alerts that are due (`at <= now`) AND strictly newer than the bag's stored
 * last-notified threshold (`expiryNotifiedAt`). A re-run never refires an
 * already-fired threshold (they are stored by their threshold instant); a
 * strictly later threshold (lead, then at-expiry) still fires. Alerts come
 * back ascending (lead before expired), matching `expiryAlertTimes`.
 *
 * A `null` stored value means nothing has been fired yet, so every due alert
 * qualifies.
 */
export function milkExpiryDueAlerts(
  timing: BagTiming,
  freezerType: FreezerType,
  now: Date,
  expiryNotifiedAt: Date | null
): ExpiryAlert[] {
  const stored = expiryNotifiedAt ? expiryNotifiedAt.getTime() : Number.NEGATIVE_INFINITY;
  return expiryAlertTimes(timing, freezerType).filter(
    (alert) =>
      alert.at.getTime() <= now.getTime() && alert.at.getTime() > stored
  );
}

/**
 * The bag's `expiryNotifiedAt` after firing the given due alerts: the latest
 * fired threshold instant, or the previous stored value when nothing fired —
 * it never regresses. Callers persist this back to the MilkBag row.
 */
export function advanceExpiryNotifiedAt(
  stored: Date | null,
  due: ExpiryAlert[]
): Date | null {
  let latest = stored;
  for (const alert of due) {
    if (!latest || alert.at.getTime() > latest.getTime()) {
      latest = alert.at;
    }
  }
  return latest;
}
