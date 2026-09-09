import { describe, it, expect } from 'vitest';
import {
  assertFeedAllowed,
  milkExpiryDueAlerts,
  advanceExpiryNotifiedAt,
  isBagExpired,
} from '@/src/utils/milkBagExpiryUi';
import { BagTiming, FreezerType } from '@/src/utils/milk-storage';
import type { MilkBagDTO } from '@/src/types/milk-bag';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function bag(overrides: Partial<MilkBagDTO> = {}): MilkBagDTO {
  return {
    id: 'b1',
    label: null,
    dayNight: 'day',
    storageLocation: 'room',
    provenance: 'fresh',
    amount: 120,
    unitAbbr: 'ml',
    status: 'available',
    startedAt: '2026-01-01T08:00:00Z',
    lastLocationChangedAt: null,
    usedAt: null,
    discardedAmount: null,
    babyId: 'baby1',
    pumps: [],
    ...overrides,
  };
}

function timing(overrides: Partial<BagTiming> = {}): BagTiming {
  return {
    startedAt: new Date('2026-01-01T08:00:00Z'),
    storageLocation: 'room',
    ...overrides,
  };
}

describe('milkExpiryDueAlerts — lead-time scheduling math', () => {
  // Fresh room bag: use-by = startedAt + 8h. Lead fires at use-by - 2h.
  it('fires the room lead alert at use-by minus 2 hours', () => {
    const start = new Date('2026-01-01T08:00:00Z');
    const useBy = new Date(start.getTime() + 8 * HOUR); // 16:00
    const now = new Date(useBy.getTime() - 2 * HOUR - 1000); // 1s before lead
    const due = milkExpiryDueAlerts(timing({ startedAt: start }), 'separate-door', now, null);
    expect(due.length).toBe(0);
    const onLead = new Date(useBy.getTime() - 2 * HOUR);
    expect(
      milkExpiryDueAlerts(timing({ startedAt: start }), 'separate-door', onLead, null).map((a) => a.kind)
    ).toEqual(['lead']);
  });

  // Fresh fridge bag: use-by = startedAt + 72h. Lead fires at use-by - 6h.
  it('fires the fridge lead alert at use-by minus 6 hours', () => {
    const start = new Date('2026-01-02T00:00:00Z');
    const useBy = new Date(start.getTime() + 72 * HOUR);
    const leadAt = new Date(useBy.getTime() - 6 * HOUR);
    const due = milkExpiryDueAlerts(
      timing({ startedAt: start, storageLocation: 'fridge' }),
      'separate-door',
      leadAt,
      null
    );
    expect(due.map((a) => a.kind)).toEqual(['lead']);
  });

  // Freezer bag: use-by = startedAt + freezer window (separate-door = 3 months).
  it('fires the freezer lead alert at use-by minus 1 day', () => {
    const start = new Date('2026-01-01T08:00:00Z');
    const useBy = new Date(start);
    useBy.setUTCMonth(useBy.getUTCMonth() + 3); // 2026-04-01
    const leadAt = new Date(useBy.getTime() - DAY);
    const due = milkExpiryDueAlerts(
      timing({ startedAt: start, storageLocation: 'freezer' }),
      'separate-door',
      leadAt,
      null
    );
    expect(due.map((a) => a.kind)).toEqual(['lead']);
  });

  it('fires the at-expiry alert exactly at the use-by instant', () => {
    const start = new Date('2026-01-01T08:00:00Z');
    const useBy = new Date(start.getTime() + 8 * HOUR);
    const before = new Date(useBy.getTime() - 2 * HOUR - 1000); // just before lead
    expect(
      milkExpiryDueAlerts(timing({ startedAt: start }), 'separate-door', before, null)
    ).toEqual([]);
    expect(
      milkExpiryDueAlerts(timing({ startedAt: start }), 'separate-door', useBy, null).map((a) => a.kind)
    ).toEqual(['lead', 'expired']);
  });

  it('returns no alerts before the lead time', () => {
    const start = new Date('2026-01-01T08:00:00Z');
    expect(
      milkExpiryDueAlerts(timing({ startedAt: start }), 'separate-door', start, null)
    ).toEqual([]);
  });
});

describe('milkExpiryDueAlerts — dedup state machine', () => {
  const start = new Date('2026-01-01T08:00:00Z');
  const useBy = new Date(start.getTime() + 8 * HOUR);
  const leadAt = new Date(useBy.getTime() - 2 * HOUR);
  const now = new Date(useBy.getTime() + HOUR); // well past both thresholds

  it('fires everything when nothing has been notified yet', () => {
    const due = milkExpiryDueAlerts(timing({ startedAt: start }), 'separate-door', now, null);
    expect(due.map((a) => a.kind)).toEqual(['lead', 'expired']);
  });

  it('older stored threshold does not refire the lead alert', () => {
    // Stored = leadAt (lead already fired). Only "expired" is strictly newer.
    const due = milkExpiryDueAlerts(timing({ startedAt: start }), 'separate-door', now, leadAt);
    expect(due.map((a) => a.kind)).toEqual(['expired']);
  });

  it('does not refire an identical stored threshold', () => {
    const due = milkExpiryDueAlerts(timing({ startedAt: start }), 'separate-door', now, useBy);
    expect(due).toEqual([]);
  });

  it('advances the stored timestamp to the latest fired threshold', () => {
    const stored = new Date('2026-01-01T00:00:00Z');
    const due = milkExpiryDueAlerts(timing({ startedAt: start }), 'separate-door', now, stored);
    expect(advanceExpiryNotifiedAt(stored, due)).toEqual(useBy);
  });

  it('never regresses the stored timestamp when nothing is due', () => {
    const stored = new Date('2026-01-05T00:00:00Z');
    expect(advanceExpiryNotifiedAt(stored, [])).toEqual(stored);
    const due = milkExpiryDueAlerts(timing({ startedAt: start }), 'separate-door', now, stored);
    expect(due).toEqual([]);
    expect(advanceExpiryNotifiedAt(stored, due)).toEqual(stored);
  });
});

describe('assertFeedAllowed — warn-not-block', () => {
  const start = new Date('2026-01-01T08:00:00Z');
  const useBy = new Date(start.getTime() + 8 * HOUR);

  it('allows feeding a bag before its use-by', () => {
    const before = new Date(useBy.getTime() - HOUR);
    expect(
      assertFeedAllowed(timing({ startedAt: start }), 'separate-door', before)
    ).toEqual({ ok: true });
  });

  it('flags a bag at its use-by instant as expired without blocking', () => {
    expect(
      assertFeedAllowed(timing({ startedAt: start }), 'separate-door', useBy)
    ).toEqual({ ok: false, expired: true });
  });

  it('flags a bag past its use-by as expired', () => {
    expect(
      assertFeedAllowed(timing({ startedAt: start }), 'separate-door', new Date(useBy.getTime() + HOUR))
    ).toEqual({ ok: false, expired: true });
  });
});

describe('isBagExpired — feed confirm predicate', () => {
  const start = '2026-01-01T08:00:00Z';
  const startMs = new Date(start).getTime();
  const useBy = startMs + 8 * HOUR; // fresh room bag: 8h use-by

  it('is false for a fresh bag still within its window', () => {
    expect(isBagExpired(bag(), 'separate-door', new Date(useBy - HOUR))).toBe(false);
  });

  it('is true at the use-by instant', () => {
    expect(isBagExpired(bag(), 'separate-door', new Date(useBy))).toBe(true);
  });

  it('is true past the use-by instant', () => {
    expect(isBagExpired(bag(), 'separate-door', new Date(useBy + HOUR))).toBe(true);
  });

  it('is true for a thawed bag sitting in the freezer (invalid state)', () => {
    expect(
      isBagExpired(
        bag({
          provenance: 'thawed',
          storageLocation: 'freezer',
          lastLocationChangedAt: '2026-01-01T09:00:00Z',
        }),
        'separate-door',
        new Date(startMs + 2 * HOUR)
      )
    ).toBe(true);
  });

  it('treats a missing lastLocationChangedAt like startedAt', () => {
    // lastLocationChangedAt null = never moved; use-by anchored to startedAt (8h room).
    expect(isBagExpired(bag(), 'separate-door', new Date(useBy - 1000))).toBe(false);
    expect(isBagExpired(bag(), 'separate-door', new Date(useBy))).toBe(true);
  });
});
