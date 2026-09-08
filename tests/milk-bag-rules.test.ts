import { describe, it, expect } from 'vitest';
import {
  deriveDayNight,
  inventoryTotals,
  canAddPumpToBag,
  suggestBagForFeed,
  consumeBag,
  convertLegacyBalance,
  DEFAULT_DAY_NIGHT_BOUNDARY,
} from '@/src/utils/milk-bag-rules';
import type { BagTiming } from '@/src/utils/milk-storage';
import { DEFAULT_FREEZER_TYPE } from '@/src/utils/milk-storage';

const DAY_START = 7; // 07:00
const DAY_END = 19; // 19:00

describe('day/night boundary defaults', () => {
  it('defaults to 07:00-19:00 and separate-door freezer', () => {
    expect(DEFAULT_DAY_NIGHT_BOUNDARY).toEqual({ dayStartHour: 7, dayEndHour: 19 });
    expect(DEFAULT_FREEZER_TYPE).toBe('separate-door'); // from milk-storage
  });
});

describe('deriveDayNight (auto-label from first pump time, overridable)', () => {
  it('labels 07:00-18:59 as day and 19:00-06:59 as night', () => {
    expect(deriveDayNight(new Date('2026-09-01T07:00:00'), DAY_START, DAY_END)).toBe('day');
    expect(deriveDayNight(new Date('2026-09-01T18:59:00'), DAY_START, DAY_END)).toBe('day');
    expect(deriveDayNight(new Date('2026-09-01T19:00:00'), DAY_START, DAY_END)).toBe('night');
    expect(deriveDayNight(new Date('2026-09-01T23:30:00'), DAY_START, DAY_END)).toBe('night');
    expect(deriveDayNight(new Date('2026-09-01T03:15:00'), DAY_START, DAY_END)).toBe('night');
    expect(deriveDayNight(new Date('2026-09-01T06:59:00'), DAY_START, DAY_END)).toBe('night');
  });

  it('respects a custom family boundary', () => {
    expect(deriveDayNight(new Date('2026-09-01T08:00:00'), 9, 17)).toBe('night');
    expect(deriveDayNight(new Date('2026-09-01T10:00:00'), 9, 17)).toBe('day');
  });
});

describe('canAddPumpToBag (add only when bag started <= 24h ago)', () => {
  const bag: BagTiming = { startedAt: new Date('2026-09-01T10:00:00.000Z') };

  it('allows a pump well within 24h of bag start', () => {
    expect(canAddPumpToBag(bag, new Date('2026-09-02T09:59:00.000Z')).ok).toBe(true);
  });

  it('allows exactly 24h (inclusive boundary)', () => {
    const r = canAddPumpToBag(bag, new Date('2026-09-02T10:00:00.000Z'));
    expect(r.ok).toBe(true);
  });

  it('rejects a pump more than 24h after bag start with a reason', () => {
    const r = canAddPumpToBag(bag, new Date('2026-09-02T10:00:01.000Z'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('too-old');
  });

  it('rejects a pump before the bag started', () => {
    const r = canAddPumpToBag(bag, new Date('2026-09-01T09:00:00.000Z'));
    expect(r.ok).toBe(false);
  });

  it('rejects when the bag is no longer available', () => {
    const r = canAddPumpToBag({ ...bag, status: 'used' }, new Date('2026-09-01T11:00:00.000Z'));
    expect(r.ok).toBe(false);
  });
});

describe('suggestBagForFeed (auto-suggest day/night bag by current clock time)', () => {
  const dayBag = { id: 'day-1', dayNight: 'day' as const, amountMl: 90, status: 'available' as const };
  const nightBag = { id: 'night-1', dayNight: 'night' as const, amountMl: 120, status: 'available' as const };

  it('prefers a bag matching the current time-of-day label', () => {
    const noon = new Date('2026-09-01T12:00:00');
    expect(suggestBagForFeed([dayBag, nightBag], noon, DAY_START, DAY_END)?.id).toBe('day-1');
    const night = new Date('2026-09-01T22:00:00');
    expect(suggestBagForFeed([dayBag, nightBag], night, DAY_START, DAY_END)?.id).toBe('night-1');
  });

  it('prefers the soonest-expiring matching bag (first-in-first-out within a label)', () => {
    const soon = { ...dayBag, id: 'day-expiring', amountMl: 90, useByAt: new Date('2026-09-01T16:00:00.000Z') };
    const later = { ...dayBag, id: 'day-later', amountMl: 90, useByAt: new Date('2026-09-01T20:00:00.000Z') };
    const noon = new Date('2026-09-01T12:00:00');
    expect(suggestBagForFeed([later, soon], noon, DAY_START, DAY_END)?.id).toBe('day-expiring');
  });

  it('falls back to the other label when no matching bag exists', () => {
    const night = new Date('2026-09-01T22:00:00');
    expect(suggestBagForFeed([dayBag], night, DAY_START, DAY_END)?.id).toBe('day-1');
  });

  it('returns undefined for an empty inventory', () => {
    const noon = new Date('2026-09-01T12:00:00');
    expect(suggestBagForFeed([], noon, DAY_START, DAY_END)).toBeUndefined();
  });
});

describe('consumeBag (single-use consumption, leftover discarded)', () => {
  const bag = {
    id: 'bag-1',
    amountMl: 120,
    status: 'available' as const,
  };

  it('marks the bag used and discards the leftover', () => {
    const r = consumeBag(bag, 80);
    expect(r.bag.status).toBe('used');
    expect(r.discardedMl).toBe(40);
  });

  it('consumes min(fed, amount) — cannot feed more than the bag holds', () => {
    const r = consumeBag(bag, 150);
    expect(r.fedMl).toBe(120);
    expect(r.discardedMl).toBe(0);
  });

  it('rejects consuming a bag that is not available', () => {
    expect(() => consumeBag({ ...bag, status: 'used' }, 50)).toThrow(/not available/i);
    expect(() => consumeBag({ ...bag, status: 'discarded' }, 50)).toThrow(/not available/i);
  });

  it('rejects non-positive feed amounts', () => {
    expect(() => consumeBag(bag, 0)).toThrow();
    expect(() => consumeBag(bag, -5)).toThrow();
  });
});

describe('inventoryTotals (balance model: legacy total + available bags)', () => {
  const bags = [
    { amountMl: 90, status: 'available' as const },
    { amountMl: 120, status: 'available' as const },
    { amountMl: 80, status: 'used' as const },
    { amountMl: 30, status: 'discarded' as const },
  ];

  it('displayed stored = legacy total + sum of available bags', () => {
    const r = inventoryTotals(200, bags);
    expect(r.availableMl).toBe(210);
    expect(r.displayedStoredMl).toBe(410);
  });

  it('counts bags and tracks used/discarded volumes', () => {
    const r = inventoryTotals(200, bags);
    expect(r.availableBags).toBe(2);
    expect(r.usedMl).toBe(80);
    expect(r.discardedMl).toBe(30);
  });

  it('legacy-only inventory when no bags exist yet', () => {
    expect(inventoryTotals(250, [])).toEqual({
      availableBags: 0,
      availableMl: 0,
      usedMl: 0,
      discardedMl: 0,
      displayedStoredMl: 250,
    });
  });
});

describe('convertLegacyBalance (guided convert-to-bags math)', () => {
  it('accepts a set of bags summing exactly to the legacy total', () => {
    const r = convertLegacyBalance(300, [
      { amountMl: 150, baggedAt: new Date('2026-08-30T10:00:00.000Z'), storageLocation: 'freezer', dayNight: 'day' },
      { amountMl: 150, baggedAt: new Date('2026-08-31T10:00:00.000Z'), storageLocation: 'freezer', dayNight: 'night' },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.leftoverMl).toBe(0);
  });

  it('reports shortfall requiring confirmation when bags sum to less than the total', () => {
    const r = convertLegacyBalance(300, [{ amountMl: 250, baggedAt: new Date(), storageLocation: 'freezer', dayNight: 'day' }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.leftoverMl).toBe(50);
  });

  it('rejects when bags overshoot the legacy total', () => {
    const r = convertLegacyBalance(300, [
      { amountMl: 200, baggedAt: new Date(), storageLocation: 'freezer', dayNight: 'day' },
      { amountMl: 150, baggedAt: new Date(), storageLocation: 'freezer', dayNight: 'day' },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/exceed/i);
  });

  it('rejects empty conversion of a non-zero balance, accepts empty conversion of zero', () => {
    expect(convertLegacyBalance(300, []).ok).toBe(false);
    expect(convertLegacyBalance(0, []).ok).toBe(true);
  });
});
