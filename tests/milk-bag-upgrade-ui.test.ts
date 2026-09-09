import { describe, it, expect } from 'vitest';
import {
  rowsToBags,
  computeUpgradeSum,
  setUpgradeMarker,
  DEFAULT_UPGRADE_STORAGE,
  UpgradeRowInput,
} from '@/src/utils/milkBagUpgradeUi';
import type { DayNight } from '@/src/utils/milk-bag-rules';

const day: DayNight = 'day';
const night: DayNight = 'night';

describe('rowsToBags', () => {
  it('maps valid rows to MilkBagUpgradeRequest bags with ISO dates', () => {
    const at = new Date(2026, 8, 9, 10, 30);
    const bags = rowsToBags([
      { amount: 120, baggedAt: at, storageLocation: 'fridge', dayNight: day },
    ]);
    expect(bags).toEqual([
      {
        amount: 120,
        baggedAt: at.toISOString(),
        storageLocation: 'fridge',
        dayNight: day,
      },
    ]);
  });

  it('defaults storageLocation to freezer when omitted', () => {
    const bags = rowsToBags([{ amount: 60, baggedAt: new Date(), dayNight: night }]);
    expect(bags[0].storageLocation).toBe(DEFAULT_UPGRADE_STORAGE);
    expect(bags[0].storageLocation).toBe('freezer');
  });

  it('converts non-ML amounts to ML when a unitAbbr is set', () => {
    const bags = rowsToBags([
      { amount: 4, baggedAt: new Date(), dayNight: day, unitAbbr: 'OZ' },
    ]);
    // 4 oz => 4 * 29.5735
    expect(bags[0].amount).toBeCloseTo(4 * 29.5735, 5);
  });

  it('keeps ML amounts unchanged', () => {
    const bags = rowsToBags([
      { amount: 90, baggedAt: new Date(), dayNight: night, unitAbbr: 'ML' },
    ]);
    expect(bags[0].amount).toBe(90);
  });

  it('rejects non-positive amounts', () => {
    expect(() =>
      rowsToBags([{ amount: 0, baggedAt: new Date(), dayNight: day }]),
    ).toThrow('milk-bag-invalid-amount');
    expect(() =>
      rowsToBags([{ amount: -5, baggedAt: new Date(), dayNight: day }]),
    ).toThrow('milk-bag-invalid-amount');
    expect(() =>
      rowsToBags([{ amount: NaN, baggedAt: new Date(), dayNight: day }]),
    ).toThrow('milk-bag-invalid-amount');
  });

  it('rejects unparseable dates', () => {
    expect(() =>
      rowsToBags([{ amount: 10, baggedAt: new Date('garbage'), dayNight: day }]),
    ).toThrow('milk-bag-invalid-date');
  });
});

describe('computeUpgradeSum', () => {
  it('reports leftover when bags under-sum the legacy total', () => {
    const sum = computeUpgradeSum(300, [
      { amount: 100 },
      { amount: 50 },
    ]);
    expect(sum).toEqual({ baggedMl: 150, leftoverMl: 150, exceeds: false });
  });

  it('reports zero leftover when bags exactly match the total', () => {
    const sum = computeUpgradeSum(100, [{ amount: 40 }, { amount: 60 }]);
    expect(sum).toEqual({ baggedMl: 100, leftoverMl: 0, exceeds: false });
  });

  it('flags exceeds when bags over-sum the legacy total', () => {
    const sum = computeUpgradeSum(100, [{ amount: 80 }, { amount: 40 }]);
    expect(sum.baggedMl).toBe(120);
    expect(sum.exceeds).toBe(true);
    expect(sum.leftoverMl).toBe(0);
  });

  it('converts per-row units to ML for the readout', () => {
    const sum = computeUpgradeSum(100, [
      { amount: 2, unitAbbr: 'OZ' }, // ~59.15 ml
      { amount: 40, unitAbbr: 'ML' },
    ]);
    expect(sum.baggedMl).toBeCloseTo(2 * 29.5735 + 40, 5);
    expect(sum.exceeds).toBe(false);
  });

  it('treats a legacy total given in a non-ML unit consistently', () => {
    const sum = computeUpgradeSum(4, [{ amount: 2, unitAbbr: 'OZ' }], 'OZ');
    const legacyMl = 4 * 29.5735;
    const baggedMl = 2 * 29.5735;
    expect(sum.baggedMl).toBeCloseTo(baggedMl, 5);
    expect(sum.leftoverMl).toBeCloseTo(legacyMl - baggedMl, 5);
    expect(sum.exceeds).toBe(false);
  });

  it('ignores empty/non-positive rows', () => {
    const sum = computeUpgradeSum(200, [{ amount: 0 }, { amount: NaN }, { amount: -3 }, { amount: 50 }]);
    expect(sum).toEqual({ baggedMl: 50, leftoverMl: 150, exceeds: false });
  });

  it('empty bags leave the full legacy as leftover', () => {
    const sum = computeUpgradeSum(120, []);
    expect(sum).toEqual({ baggedMl: 0, leftoverMl: 120, exceeds: false });
  });
});

describe('setUpgradeMarker', () => {
  const now = new Date('2026-09-09T10:00:00.000Z');

  it('sets the marker while preserving existing blob keys', () => {
    const raw = JSON.stringify({ dayStartHour: 6, dayEndHour: 20, freezerType: 'chest' });
    const out = JSON.parse(setUpgradeMarker(raw, now));
    expect(out).toEqual({
      dayStartHour: 6,
      dayEndHour: 20,
      freezerType: 'chest',
      milkBagsUpgradedAt: '2026-09-09T10:00:00.000Z',
    });
  });

  it('creates a marker-only blob when no blob exists', () => {
    expect(JSON.parse(setUpgradeMarker(null, now))).toEqual({
      milkBagsUpgradedAt: '2026-09-09T10:00:00.000Z',
    });
  });

  it('recovers from garbled JSON without corrupting the request', () => {
    expect(JSON.parse(setUpgradeMarker('not json{{{', now))).toEqual({
      milkBagsUpgradedAt: '2026-09-09T10:00:00.000Z',
    });
  });

  it('refreshes an existing marker', () => {
    const raw = JSON.stringify({ dayStartHour: 7, milkBagsUpgradedAt: '2020-01-01T00:00:00.000Z' });
    expect(JSON.parse(setUpgradeMarker(raw, now)).milkBagsUpgradedAt).toBe(
      '2026-09-09T10:00:00.000Z',
    );
  });
});
