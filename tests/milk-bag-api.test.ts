import { describe, it, expect } from 'vitest';
import {
  formatDateIso,
  rowToMilkBagDTO,
  computeBagDayNight,
  validateCreateRequest,
  validateUpdateRequest,
  convertLegacyToOz,
  mapUpgradeInput,
  makeBagTiming,
} from '@/src/utils/milkBagApi';
import type { MilkBagDTO, MilkBagCreateRequest, MilkBagUpdateRequest, MilkBagUpgradeRequest } from '@/src/types/milk-bag';

/* ------------------------------------------------------------------ */
/* formatDateIso                                                       */
/* ------------------------------------------------------------------ */

describe('formatDateIso', () => {
  it('returns ISO string for a Date', () => {
    const d = new Date('2026-09-01T12:00:00.000Z');
    expect(formatDateIso(d)).toBe('2026-09-01T12:00:00.000Z');
  });
  it('returns ISO string for an ISO string', () => {
    expect(formatDateIso('2026-09-01T12:00:00.000Z')).toBe('2026-09-01T12:00:00.000Z');
  });
  it('returns null for null input', () => {
    expect(formatDateIso(null)).toBeNull();
  });
  it('returns null for undefined (coerced via !date)', () => {
    // undefined is falsy in the `!date` check
    expect(formatDateIso(undefined as unknown as Date | string | null)).toBeNull();
  });
  it('returns null for NaN date', () => {
    expect(formatDateIso('not-a-date')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* rowToMilkBagDTO                                                   */
/* ------------------------------------------------------------------ */

describe('rowToMilkBagDTO', () => {
  const row = {
    id: 'bag-1',
    label: 'Morning stash',
    dayNight: 'day',
    storageLocation: 'fridge',
    provenance: 'fresh',
    amount: 4.5,
    unitAbbr: 'OZ',
    status: 'available',
    startedAt: new Date('2026-09-08T07:30:00.000Z'),
    lastLocationChangedAt: null,
    usedAt: null,
    discardedAmount: null,
    babyId: 'baby-abc',
    pumps: [
      {
        id: 'pump-1',
        startTime: new Date('2026-09-08T07:30:00.000Z'),
        totalAmount: 2,
        unitAbbr: 'OZ',
      },
      {
        id: 'pump-2',
        startTime: new Date('2026-09-08T07:30:00.000Z'),
        totalAmount: 2.5,
        unitAbbr: 'OZ',
      },
    ],
  };

  it('maps all fields correctly', () => {
    const dto = rowToMilkBagDTO(row as any);
    const expected: MilkBagDTO = {
      id: 'bag-1',
      label: 'Morning stash',
      dayNight: 'day',
      storageLocation: 'fridge',
      provenance: 'fresh',
      amount: 4.5,
      unitAbbr: 'OZ',
      status: 'available',
      startedAt: '2026-09-08T07:30:00.000Z',
      lastLocationChangedAt: null,
      usedAt: null,
      discardedAmount: null,
      babyId: 'baby-abc',
      pumps: [
        { id: 'pump-1', startTime: '2026-09-08T07:30:00.000Z', totalAmount: 2, unitAbbr: 'OZ' },
        { id: 'pump-2', startTime: '2026-09-08T07:30:00.000Z', totalAmount: 2.5, unitAbbr: 'OZ' },
      ],
    };
    expect(dto).toEqual(expected);
  });

  it('preserves null for lastLocationChangedAt and usedAt', () => {
    const dto = rowToMilkBagDTO(row as any);
    expect(dto.lastLocationChangedAt).toBeNull();
    expect(dto.usedAt).toBeNull();
  });

  it('maps non-null lastLocationChangedAt as ISO string', () => {
    const movedRow = { ...row, lastLocationChangedAt: new Date('2026-09-08T10:00:00.000Z'), usedAt: new Date('2026-09-08T08:00:00.000Z') };
    const dto = rowToMilkBagDTO(movedRow as any);
    expect(dto.lastLocationChangedAt).toBe('2026-09-08T10:00:00.000Z');
    expect(dto.usedAt).toBe('2026-09-08T08:00:00.000Z');
  });
});

/* ------------------------------------------------------------------ */
/* computeBagDayNight                                                */
/* ------------------------------------------------------------------ */

describe('computeBagDayNight', () => {
  it('derives day within [7, 19)', () => {
    // 00:00 UTC = 10:00 Sydney (day)
    expect(computeBagDayNight(new Date('2026-09-08T00:00:00.000Z'))).toBe('day');
  });
  it('derives night before 7am', () => {
    // 19:00 UTC prev day = 05:00 Sydney (night)
    expect(computeBagDayNight(new Date('2026-09-07T19:00:00.000Z'))).toBe('night');
  });
  it('derives night at 19:00 (exclusive end)', () => {
    // 09:00 UTC = 19:00 Sydney (night — end is exclusive)
    expect(computeBagDayNight(new Date('2026-09-08T09:00:00.000Z'))).toBe('night');
  });
  it('uses custom settings when provided', () => {
    const settings = { dayStartHour: 17, dayEndHour: 23 };
    // 13:00 Sydney = 03:00 UTC -> hour 13 is night (before 17)
    expect(computeBagDayNight(new Date('2026-09-08T03:00:00.000Z'), settings as any)).toBe('night');
    // 20:00 Sydney = 10:00 UTC -> hour 20 is day (>= 17 && < 23)
    expect(computeBagDayNight(new Date('2026-09-08T10:00:00.000Z'), settings as any)).toBe('day');
  });


});

/* ------------------------------------------------------------------ */
/* validateCreateRequest                                             */
/* ------------------------------------------------------------------ */

describe('validateCreateRequest', () => {
  it('passes for valid input', () => {
    const req: MilkBagCreateRequest = { babyId: 'b1', amount: 2.5, unitAbbr: 'OZ', label: 'Test' };
    expect(validateCreateRequest(req)).toEqual({ ok: true });
  });
  it('rejects missing babyId', () => {
    const req: MilkBagCreateRequest = { babyId: '', amount: 2.5 };
    expect(validateCreateRequest(req)).toEqual({ ok: false, error: 'babyId is required' });
  });
  it('rejects zero amount', () => {
    const req: MilkBagCreateRequest = { babyId: 'b1', amount: 0 };
    expect(validateCreateRequest(req)).toEqual({ ok: false, error: 'amount must be a number greater than 0' });
  });
  it('rejects negative amount', () => {
    const req: MilkBagCreateRequest = { babyId: 'b1', amount: -1 };
    expect(validateCreateRequest(req)).toEqual({ ok: false, error: 'amount must be a number greater than 0' });
  });
  it('rejects NaN amount', () => {
    const req: MilkBagCreateRequest = { babyId: 'b1', amount: NaN };
    expect(validateCreateRequest(req)).toEqual({ ok: false, error: 'amount must be a number greater than 0' });
  });
});

/* ------------------------------------------------------------------ */
/* validateUpdateRequest                                             */
/* ------------------------------------------------------------------ */

describe('validateUpdateRequest', () => {
  it('passes when at least one field present', () => {
    const req: Partial<MilkBagUpdateRequest> = { storageLocation: 'freezer' };
    expect(validateUpdateRequest(req as MilkBagUpdateRequest)).toEqual({ ok: true });
  });
  it('rejects empty request', () => {
    const req: MilkBagUpdateRequest = {};
    expect(validateUpdateRequest(req)).toEqual({ ok: false, error: 'At least one of storageLocation, label, or dayNight is required' });
  });
  it('passes for label only', () => {
    const req: Partial<MilkBagUpdateRequest> = { label: 'new label' };
    expect(validateUpdateRequest(req as MilkBagUpdateRequest)).toEqual({ ok: true });
  });
});

/* ------------------------------------------------------------------ */
/* convertLegacyToOz                                                 */
/* ------------------------------------------------------------------ */

describe('convertLegacyToOz', () => {
  it('converts ML to OZ', () => {
    // 30 ML ≈ 1.01443 oz
    expect(convertLegacyToOz(30)).toBeCloseTo(1.014, 3);
  });
  it('passes through 0', () => {
    expect(convertLegacyToOz(0)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* mapUpgradeInput                                                   */
/* ------------------------------------------------------------------ */

describe('mapUpgradeInput', () => {
  it('maps bags to LegacyBagInput format', () => {
    const req: MilkBagUpgradeRequest = {
      babyId: 'b1',
      discardLeftover: false,
      bags: [{
        amount: 45,
        baggedAt: '2026-09-08T10:00:00Z',
        storageLocation: 'freezer',
        dayNight: 'day',
        label: 'Night stash',
      }],
    };
    const result = mapUpgradeInput(req);
    expect(result.conversionArg).toEqual([{
      amountMl: 45,
      baggedAt: new Date('2026-09-08T10:00:00.000Z'),
      storageLocation: 'freezer',
      dayNight: 'day',
    }]);
  });
  it('defaults dayNight to day when omitted', () => {
    const req: MilkBagUpgradeRequest = {
      babyId: 'b1',
      discardLeftover: false,
      bags: [{
        amount: 20,
        baggedAt: '2026-09-08T07:00:00Z',
        storageLocation: 'fridge',
      }],
    };
    const result = mapUpgradeInput(req);
    expect(result.conversionArg[0].dayNight).toBe('day');
  });
});

/* ------------------------------------------------------------------ */
/* makeBagTiming                                                     */
/* ------------------------------------------------------------------ */

describe('makeBagTiming', () => {
  it('sets lastLocationChangedAt from arg', () => {
    const at = new Date('2026-01-01T00:00:00.000Z');
    const moved = new Date('2026-01-02T12:00:00.000Z');
    const t = makeBagTiming(at, moved);
    expect(t.startedAt).toBe(at);
    expect(t.lastLocationChangedAt).toBe(moved);
  });
  it('sets lastLocationChangedAt to startedAt when null', () => {
    const at = new Date('2026-01-01T00:00:00.000Z');
    const t = makeBagTiming(at, null);
    expect(t.lastLocationChangedAt).toBe(at);
  });
});
