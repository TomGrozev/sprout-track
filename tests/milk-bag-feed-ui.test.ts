import { describe, it, expect } from 'vitest';
import { bagOptionLabel, computeExpiryDate, mapBagsToOptions } from '@/src/utils/milkBagFeedUi';
import type { MilkBagDTO } from '@/src/types/milk-bag';

function makeBag(overrides: { id: string } & Omit<Partial<MilkBagDTO>, 'dayNight'> & { dayNight?: 'day' | 'night' | undefined }): MilkBagDTO {
  return {
    id: overrides.id,
    label: 'label' in overrides ? overrides.label! : null,
    dayNight: 'dayNight' in overrides ? (overrides.dayNight! as 'day' | 'night') : 'day',
    storageLocation: overrides.storageLocation ?? 'fridge',
    provenance: 'provenance' in overrides ? overrides.provenance! : 'fresh',
    amount: overrides.amount ?? 120,
    unitAbbr: 'unitAbbr' in overrides ? overrides.unitAbbr! : 'ml',
    status: overrides.status ?? 'available',
    startedAt: overrides.startedAt ?? '2026-09-07T10:00:00.000Z',
    lastLocationChangedAt: 'lastLocationChangedAt' in overrides ? overrides.lastLocationChangedAt! : null,
    usedAt: overrides.usedAt ?? null,
    discardedAmount: overrides.discardedAmount ?? null,
    babyId: overrides.babyId ?? 'baby-1',
    pumps: overrides.pumps ?? [],
  };
}

// ── bagOptionLabel ──────────────────────────────────────────────

describe('bagOptionLabel', () => {
  it('returns Day prefix for a daytime bag', () => {
    const bag = makeBag({ id: 'b1', dayNight: 'day' });
    expect(bagOptionLabel(bag, 'Day', 'Night')).toBe('Day 120 ml');
  });

  it('returns Night prefix for a nighttime bag', () => {
    const bag = makeBag({ id: 'b1', dayNight: 'night' });
    expect(bagOptionLabel(bag, 'Day', 'Night')).toBe('Night 120 ml');
  });

  it('falls back to nightLabel when dayNight is undefined', () => {
    const bag = makeBag({ id: 'b1', dayNight: undefined });
    // undefined?.toLowerCase() = undefined !== 'day' → nightLabel
    expect(bagOptionLabel(bag, 'Day', 'Night')).toBe('Night 120 ml');
  });

  it('appends label as a suffix when label is present', () => {
    const bag = makeBag({ id: 'b1', label: 'Morning pump', dayNight: 'day' });
    expect(bagOptionLabel(bag, 'Day', 'Night')).toBe('Day 120 ml — Morning pump');
  });

  it('omits the label suffix when label is null', () => {
    const bag = makeBag({ id: 'b1', label: null, dayNight: 'day' });
    expect(bagOptionLabel(bag, 'Day', 'Night')).toBe('Day 120 ml');
  });

  it('includes unitAbbr when present', () => {
    const bag = makeBag({ id: 'b1', unitAbbr: 'oz', amount: 4 });
    expect(bagOptionLabel(bag, 'Day', 'Night')).toBe('Day 4 oz');
  });

  it('omits unitAbbr when unitAbbr is null (no trailing space)', () => {
    const bag = makeBag({ id: 'b1', unitAbbr: null });
    expect(bagOptionLabel(bag, 'Day', 'Night')).toBe('Day 120');
  });

  it('includes both label and unitAbbr', () => {
    const bag = makeBag({ id: 'b1', label: 'Morning', unitAbbr: 'oz', amount: 4, dayNight: 'day' });
    expect(bagOptionLabel(bag, 'Day', 'Night')).toBe('Day 4 oz — Morning');
  });

  it('handles unitAbbr null with a label present', () => {
    const bag = makeBag({ id: 'b1', label: 'First feed', unitAbbr: null, dayNight: 'night' });
    expect(bagOptionLabel(bag, 'Day', 'Night')).toBe('Night 120 — First feed');
  });
});

// ── computeExpiryDate ───────────────────────────────────────────

describe('computeExpiryDate', () => {
  it('returns a YYYY-MM-DD date for a fresh fridge bag', () => {
    const bag = makeBag({ id: 'b1' });
    // fresh fridge: startedAt 09-07T10:00 + 72h = 09-10T10:00 → 2026-09-10
    const result = computeExpiryDate(bag, 'separate-door');
    expect(result).toEqual('2026-09-10');
  });

  it('returns a YYYY-MM-DD date for a room bag', () => {
    const bag = makeBag({ id: 'b1', storageLocation: 'room' });
    // fresh room: startedAt 09-07T10:00 + 8h = 09-07T18:00 → 2026-09-07
    const result = computeExpiryDate(bag, 'separate-door');
    expect(result).toEqual('2026-09-07');
  });

  it('returns a YYYY-MM-DD date for a freezer bag using freezer window', () => {
    const bag = makeBag({ id: 'b3', storageLocation: 'freezer' });
    // fresh freezer (separate-door): startedAt + 3 months = 2026-12-07
    const result = computeExpiryDate(bag, 'separate-door');
    expect(result).toEqual('2026-12-07');
  });

  it('returns a YYYY-MM-DD date for a compartment freezer bag', () => {
    const bag = makeBag({ id: 'b3', storageLocation: 'freezer' });
    // compartment: 14 days from startedAt = 2026-09-21
    const result = computeExpiryDate(bag, 'compartment');
    expect(result).toEqual('2026-09-21');
  });

  it('returns null for a thawed bag in a freezer', () => {
    const bag = makeBag({
      id: 'b2',
      storageLocation: 'freezer',
      provenance: 'thawed',
    });
    const result = computeExpiryDate(bag, 'separate-door');
    expect(result).toBeNull();
  });

  it('handles a bag moved from freezer to fridge (thawed)', () => {
    const bag = makeBag({
      id: 'b4',
      storageLocation: 'fridge',
      provenance: 'thawed',
      lastLocationChangedAt: '2026-09-08T08:00:00.000Z',
    });
    const result = computeExpiryDate(bag, 'separate-door');
    // thawed fridge: 24h from 08:00 on Sep 8 = Sep 9 08:00 → 2026-09-09
    expect(result).toEqual('2026-09-09');
  });
});

// ── mapBagsToOptions ────────────────────────────────────────────

describe('mapBagsToOptions', () => {
  const now = new Date('2026-09-08T10:00:00.000Z');
  const dayStart = 7;
  const dayEnd = 19;
  const labels = { day: 'Day', night: 'Night' };

  it('returns options for all available bags', () => {
    const bags = [
      makeBag({ id: 'a1' }),
      makeBag({ id: 'a2', dayNight: 'night' }),
    ];
    const result = mapBagsToOptions(bags, now, dayStart, dayEnd, 'separate-door', labels);
    expect(result.options).toHaveLength(2);
    expect(result.options.map((o) => o.id)).toEqual(['a1', 'a2']);
  });

  it('excludes non-available bags', () => {
    const bags = [
      makeBag({ id: 'a1', status: 'available' }),
      makeBag({ id: 'b1', status: 'used' }),
      makeBag({ id: 'c1', status: 'discarded' }),
    ];
    const result = mapBagsToOptions(bags, now, dayStart, dayEnd, 'separate-door', labels);
    expect(result.options).toHaveLength(1);
    expect(result.options[0].id).toBe('a1');
  });

  it('returns null suggestedId when no bags', () => {
    const result = mapBagsToOptions([], now, dayStart, dayEnd, 'separate-door', labels);
    expect(result.suggestedId).toBeNull();
    expect(result.options).toHaveLength(0);
  });

  it('returns null suggestedId when all bags are used', () => {
    const bags = [
      makeBag({ id: 'u1', status: 'used' }),
      makeBag({ id: 'u2', status: 'used' }),
    ];
    const result = mapBagsToOptions(bags, now, dayStart, dayEnd, 'separate-door', labels);
    expect(result.suggestedId).toBeNull();
    expect(result.options).toHaveLength(0);
  });

  it('produces correct labels for day and night bags', () => {
    const bags = [
      makeBag({ id: 'd1', dayNight: 'day', amount: 60, unitAbbr: 'ml', label: 'Pump 1' }),
      makeBag({ id: 'n1', dayNight: 'night', amount: 80, unitAbbr: 'ml', label: 'Night pump' }),
    ];
    const result = mapBagsToOptions(bags, now, dayStart, dayEnd, 'separate-door', labels);
    const optionLabels = result.options.map((o) => o.label);
    expect(optionLabels).toContain('Day 60 ml — Pump 1');
    expect(optionLabels).toContain('Night 80 ml — Night pump');
  });

  it('passes caller timing labels through into option labels (localization)', () => {
    const bags = [makeBag({ id: 'd1', dayNight: 'day', amount: 60, unitAbbr: 'ml' })];
    const result = mapBagsToOptions(bags, now, dayStart, dayEnd, 'separate-door', { day: 'Jour', night: 'Nuit' });
    expect(result.options[0].label).toBe('Jour 60 ml');
  });

  it('handles bags with unitAbbr null', () => {
    const bag = makeBag({ id: 'x1', unitAbbr: null });
    const result = mapBagsToOptions([bag], now, dayStart, dayEnd, 'separate-door', labels);
    expect(result.options[0].id).toBe('x1');
  });

  it('suggests the bag with the earliest useBy among same time-of-day label', () => {
    // now is 10:00 → day label (within 7-19)
    // room bag started Sep 1: useBy = Sep 1 + 8h = Sep 1 18:00
    // fridge bag started Sep 7: useBy = Sep 7 + 72h = Sep 10 10:00
    // Both are day bags, room bag's useBy is earlier → suggested
    const dayRoom = makeBag({
      id: 'room',
      dayNight: 'day',
      storageLocation: 'room',
      startedAt: '2026-09-01T10:00:00.000Z',
    });
    const dayFridge = makeBag({
      id: 'fridge',
      dayNight: 'day',
      storageLocation: 'fridge',
      startedAt: '2026-09-07T10:00:00.000Z',
    });
    const result = mapBagsToOptions(
      [dayRoom, dayFridge],
      now,
      dayStart,
      dayEnd,
      'separate-door',
      labels,
    );
    expect(result.suggestedId).toBe('room');
  });

  it('suggests any available bag when time-of-day does not match', () => {
    // now is 10:00 → day label
    // Only night bags available
    const nightBag = makeBag({ id: 'n1', dayNight: 'night' });
    const result = mapBagsToOptions([nightBag], now, dayStart, dayEnd, 'separate-door', labels);
    // suggestBagForFeed picks the only available bag regardless of label mismatch
    expect(result.suggestedId).toBe('n1');
  });
});
