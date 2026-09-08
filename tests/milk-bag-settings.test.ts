import { describe, it, expect } from 'vitest';
import { resolveMilkBagSettings, deriveDayNightForZone } from '@/src/utils/milk-bag-settings';

describe('resolveMilkBagSettings', () => {
  it('returns full defaults for null/undefined/empty blob', () => {
    expect(resolveMilkBagSettings(null)).toEqual({
      dayStartHour: 7,
      dayEndHour: 19,
      freezerType: 'separate-door',
      milkBagsUpgradedAt: null,
    });
    expect(resolveMilkBagSettings(undefined).freezerType).toBe('separate-door');
    expect(resolveMilkBagSettings('').milkBagsUpgradedAt).toBeNull();
  });

  it('parses stored JSON and keeps defaults for missing fields', () => {
    const r = resolveMilkBagSettings(JSON.stringify({ dayStartHour: 6, milkBagsUpgradedAt: '2026-09-09T00:00:00.000Z' }));
    expect(r.dayStartHour).toBe(6);
    expect(r.dayEndHour).toBe(19);
    expect(r.freezerType).toBe('separate-door');
    expect(r.milkBagsUpgradedAt).toBe('2026-09-09T00:00:00.000Z');
  });

  it('falls back to defaults on corrupt JSON', () => {
    const r = resolveMilkBagSettings('{not json');
    expect(r.dayStartHour).toBe(7);
    expect(r.freezerType).toBe('separate-door');
  });
});

describe('deriveDayNightForZone', () => {
  const T = (utc: string) => new Date(utc);

  it('uses the given timezone rather than the host timezone', () => {
    // 2026-09-01T02:00Z is 19:00 in Denver ( MST? no, MDT = UTC-6 ) -> 20:00 previous-day check:
    // 02:00Z - 6h = 20:00 Sep 1 local Denver => night (>= 19)
    expect(deriveDayNightForZone(T('2026-09-01T02:00:00Z'), 7, 19, 'America/Denver')).toBe('night');
    // 14:00Z - 6h = 08:00 MDT => day
    expect(deriveDayNightForZone(T('2026-09-01T14:00:00Z'), 7, 19, 'America/Denver')).toBe('day');
    // Sydney is UTC+10: 21:00Z -> 07:00 next day AEST => day at exactly boundary
    expect(deriveDayNightForZone(T('2026-09-01T20:59:00Z'), 7, 19, 'Australia/Sydney')).toBe('night'); // 06:59 local
    expect(deriveDayNightForZone(T('2026-09-01T21:00:00Z'), 7, 19, 'Australia/Sydney')).toBe('day'); // 07:00 local
  });

  it('falls back to server-local derivation when timezone is missing', () => {
    const noon = T('2026-09-01T12:00:00Z');
    expect(deriveDayNightForZone(noon, 7, 19)).toBe(deriveDayNightForZone(noon, 7, 19, undefined));
    expect(['day', 'night']).toContain(deriveDayNightForZone(noon, 7, 19));
  });
});
