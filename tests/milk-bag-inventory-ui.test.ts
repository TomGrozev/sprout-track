import { describe, it, expect } from 'vitest';
import {
  useByBadge,
  formatBagVolume,
  buildBagRow,
  displayedStoredLabel,
  type BagRowOptions,
} from '@/src/utils/milkBagInventoryUi';
import type { MilkBagDTO } from '@/src/types/milk-bag';
import type { DayNight } from '@/src/utils/milk-bag-rules';

const FAKE_BAG = (overrides: Partial<MilkBagDTO> = {}): MilkBagDTO => ({
  id: 'bag-1',
  label: null,
  dayNight: 'day' as DayNight,
  storageLocation: 'fridge',
  provenance: 'fresh',
  amount: 120,
  unitAbbr: 'ml',
  status: 'available',
  startedAt: new Date('2026-09-01T10:00:00.000Z').toISOString(),
  lastLocationChangedAt: null,
  usedAt: null,
  discardedAmount: null,
  babyId: 'baby-1',
  pumps: [],
  ...overrides,
});

const OPTS = (now: Date): BagRowOptions => ({
  freezerType: 'separate-door',
  now,
  dateFormat: 'YYYY-MM-DD',
  timeFormat: '12h',
  timezone: 'UTC',
});

describe('useByBadge', () => {
  it('fresh fridge bag not yet expired → expires-in with formatted use-by date', () => {
    // Fresh fridge window = 72h → use-by 2026-09-04T10:00Z.
    const timing = {
      startedAt: new Date('2026-09-01T10:00:00.000Z'),
      storageLocation: 'fridge' as const,
      provenance: 'fresh' as const,
    };
    const badge = useByBadge(timing, 'separate-door', new Date('2026-09-01T12:00:00.000Z'), 'YYYY-MM-DD', 'UTC');
    expect(badge).toEqual({ label: 'expires-in', detail: '2026-09-04', expired: false });
  });

  it('bag at/past its use-by → expired with the expired flag set', () => {
    const timing = {
      startedAt: new Date('2026-09-01T10:00:00.000Z'),
      storageLocation: 'fridge' as const,
      provenance: 'fresh' as const,
    };
    // now is exactly the use-by instant (72h later).
    const badge = useByBadge(timing, 'separate-door', new Date('2026-09-04T10:00:00.000Z'), 'YYYY-MM-DD', 'UTC');
    expect(badge.label).toBe('expired');
    expect(badge.expired).toBe(true);
    expect(badge.detail).toBe('2026-09-04');
  });

  it('invalid state (thawed-in-freezer) → expired with no detail', () => {
    const timing = {
      startedAt: new Date('2026-09-01T10:00:00.000Z'),
      lastLocationChangedAt: new Date('2026-09-02T10:00:00.000Z'),
      storageLocation: 'freezer' as const,
      provenance: 'thawed' as const,
    };
    const badge = useByBadge(timing, 'separate-door', new Date('2026-09-03T00:00:00.000Z'), 'YYYY-MM-DD', 'UTC');
    expect(badge).toEqual({ label: 'expired', detail: '', expired: true });
  });
});

describe('formatBagVolume', () => {
  it('formats amount with unit', () => {
    expect(formatBagVolume(120, 'ml')).toBe('120 ml');
    expect(formatBagVolume(4, 'oz')).toBe('4 oz');
  });

  it('omits the unit when absent', () => {
    expect(formatBagVolume(60, null)).toBe('60');
    expect(formatBagVolume(60, undefined)).toBe('60');
  });
});

describe('displayedStoredLabel', () => {
  it('formats a positive stored amount with the lowercase unit', () => {
    expect(displayedStoredLabel(250, 'ML')).toBe('250 ml');
  });

  it('converts ML to OZ and rounds to 2 decimals', () => {
    expect(displayedStoredLabel(1000, 'OZ')).toBe('33.81 oz');
  });

  it('rounds fractional values to 2 decimals', () => {
    expect(displayedStoredLabel(123.456, 'ML')).toBe('123.46 ml');
  });

  it('returns null for zero or non-finite stored amounts', () => {
    expect(displayedStoredLabel(0, 'ML')).toBeNull();
    expect(displayedStoredLabel(-5, 'ML')).toBeNull();
    expect(displayedStoredLabel(NaN, 'ML')).toBeNull();
    expect(displayedStoredLabel(Infinity, 'ML')).toBeNull();
  });
});

describe('buildBagRow', () => {
  it('uses the label when present', () => {
    const bag = FAKE_BAG({ label: 'Morning stash' });
    const row = buildBagRow(bag, OPTS(new Date('2026-09-01T12:00:00.000Z')));
    expect(row.title).toBe('Morning stash');
    expect(row.hasLabel).toBe(true);
  });

  it('leaves the title empty (fallback name) when there is no label', () => {
    const bag = FAKE_BAG({ label: null });
    const row = buildBagRow(bag, OPTS(new Date('2026-09-01T12:00:00.000Z')));
    expect(row.title).toBe('');
    expect(row.hasLabel).toBe(false);
  });

  it('shapes volume, day/night and location onto the row', () => {
    const bag = FAKE_BAG({ amount: 90, unitAbbr: 'ml', dayNight: 'night', storageLocation: 'freezer' });
    const row = buildBagRow(bag, OPTS(new Date('2026-09-01T12:00:00.000Z')));
    expect(row.volume).toBe('90 ml');
    expect(row.dayNight).toBe('night');
    expect(row.location).toBe('freezer');
  });

  it('includes formatted contained pump times (oldest order preserved)', () => {
    const bag = FAKE_BAG({
      pumps: [
        { id: 'p1', startTime: new Date('2026-09-01T08:30:00.000Z').toISOString(), totalAmount: 60, unitAbbr: 'ml' },
        { id: 'p2', startTime: new Date('2026-09-01T09:15:00.000Z').toISOString(), totalAmount: 60, unitAbbr: 'ml' },
      ],
    });
    const row = buildBagRow(bag, OPTS(new Date('2026-09-01T12:00:00.000Z')));
    expect(row.pumpTimes).toEqual(['8:30 AM', '9:15 AM']);
  });

  it('derives the use-by badge from the bag timing', () => {
    const bag = FAKE_BAG({ startedAt: new Date('2026-09-01T10:00:00.000Z').toISOString() });
    const row = buildBagRow(bag, OPTS(new Date('2026-09-01T12:00:00.000Z')));
    expect(row.useBy.label).toBe('expires-in');
    expect(row.useBy.detail).toBe('2026-09-04');
    expect(row.useBy.expired).toBe(false);
  });
});
