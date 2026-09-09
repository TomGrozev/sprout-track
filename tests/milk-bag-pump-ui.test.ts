import { describe, it, expect } from 'vitest';
import { eligibleBagsForAppend, bagAppendOption, type EligibleBag } from '@/src/utils/milkBagPumpUi';
import type { MilkBagDTO } from '@/src/types/milk-bag';
import type { DayNight } from '@/src/utils/milk-bag-rules';

const FAKE_BAG = (
  overrides: Partial<MilkBagDTO> = {},
): MilkBagDTO => ({
  id: 'bag-1',
  label: null,
  dayNight: 'day' as DayNight,
  storageLocation: 'fridge',
  provenance: 'fresh',
  amount: 60,
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

const DAY_START = 7;
const DAY_END = 19;

describe('eligibleBagsForAppend', () => {
  it('filters to available, <=24h bags only', () => {
    // now = exactly 24h after the default startedAt → boundary is inclusive
    const now = new Date('2026-09-02T10:00:00.000Z').getTime();
    const bags: MilkBagDTO[] = [
      FAKE_BAG({ startedAt: '2026-09-01T10:00:00.000Z' }),             // 24h exactly — eligible
      FAKE_BAG({ startedAt: '2026-09-02T09:00:00.000Z' }),             // 1h ago — eligible
      FAKE_BAG({ startedAt: '2026-09-01T09:59:00.000Z' }),             // 24h+1m — too old
      FAKE_BAG({ status: 'used' }),                                    // used — excluded
      FAKE_BAG({ status: 'discarded' }),                               // discarded — excluded
      // null/missing startedAt is impossible in real DTO but handled defensively
      FAKE_BAG({ startedAt: '' }),                                     // invalid ISO date — excluded
    ];
    const result = eligibleBagsForAppend(bags, now, DAY_START, DAY_END);
    expect(result).toHaveLength(2);
    expect(result.every((b) => (b as EligibleBag)._eligible)).toBe(true);
  });

  it('sorts newest-start first', () => {
    const now = new Date('2026-09-02T10:00:00.000Z').getTime();
    const bags: MilkBagDTO[] = [
      FAKE_BAG({ id: 'oldest', startedAt: '2026-09-01T11:00:00.000Z' }),
      FAKE_BAG({ id: 'newest', startedAt: '2026-09-01T20:00:00.000Z' }),
      FAKE_BAG({ id: 'middle', startedAt: '2026-09-01T16:00:00.000Z' }),
    ];
    const result = eligibleBagsForAppend(bags, now, DAY_START, DAY_END);
    const ids = result.map((b) => b.id);
    expect(ids).toEqual(['newest', 'middle', 'oldest']);
  });

  it('returns empty array when no bags are eligible', () => {
    const now = Date.now();
    const bags: MilkBagDTO[] = [
      FAKE_BAG({ status: 'used' }),
    ];
    expect(eligibleBagsForAppend(bags, now, DAY_START, DAY_END)).toHaveLength(0);
  });

  it('rejects bags started more than 24h ago', () => {
    const now = new Date('2026-09-03T10:00:00.000Z').getTime();
    const bags: MilkBagDTO[] = [
      FAKE_BAG({ startedAt: '2026-09-01T10:00:00.000Z' }),
    ];
    expect(eligibleBagsForAppend(bags, now, DAY_START, DAY_END)).toHaveLength(0);
  });
});

describe('bagAppendOption', () => {
  it('returns label, volume, and remaining time', () => {
    const bag = FAKE_BAG({
      label: 'Day bag',
      startedAt: new Date('2026-09-01T15:00:00.000Z').toISOString(),
    });
    const eligible: typeof bag & { _eligible: true } = { ...bag, _eligible: true };
    // 12 hours after bag start = 12h remaining
    const now = new Date('2026-09-02T03:00:00.000Z').getTime();
    const opt = bagAppendOption(eligible, now, DAY_START, DAY_END);
    expect(opt.label).toBe('Day bag');
    expect(opt.volumeLine).toBe('60 ml');
    expect(opt.remainingText).toBe('12h 00m left');
  });

  it('uses dayNight default when label is null', () => {
    const bag = FAKE_BAG({ label: null, dayNight: 'night' as DayNight });
    const eligible: typeof bag & { _eligible: true } = { ...bag, _eligible: true };
    const opt = bagAppendOption(eligible, Date.now(), DAY_START, DAY_END);
    expect(opt.label).toBe('night bag');
  });

  it('formats remaining time accurately', () => {
    const bag = FAKE_BAG({
      startedAt: new Date('2026-09-01T10:00:00.000Z').toISOString(),
    });
    const eligible: typeof bag & { _eligible: true } = { ...bag, _eligible: true };
    // 1h 10m elapsed → 22h 50m remaining
    const now = new Date('2026-09-01T11:10:00.000Z').getTime();
    const opt = bagAppendOption(eligible, now, DAY_START, DAY_END);
    expect(opt.remainingText).toBe('22h 50m left');
  });

  it('defaults to ml when unitAbbr is null', () => {
    const bag = FAKE_BAG({ label: 'Test bag', unitAbbr: null as MilkBagDTO['unitAbbr'], amount: 2 });
    const eligible: typeof bag & { _eligible: true } = { ...bag, _eligible: true };
    const opt = bagAppendOption(eligible, Date.now(), DAY_START, DAY_END);
    expect(opt.volumeLine).toBe('2 ml');
  });

  it('identifies the id for API submission', () => {
    const bag = FAKE_BAG({ id: 'abc-123' });
    const eligible: typeof bag & { _eligible: true } = { ...bag, _eligible: true };
    const opt = bagAppendOption(eligible, Date.now(), DAY_START, DAY_END);
    expect(opt.id).toBe('abc-123');
  });
});
