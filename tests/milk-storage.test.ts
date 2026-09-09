import { describe, it, expect } from 'vitest';
import {
  computeUseBy,
  applyLocationChange,
  isExpired,
  expiryAlertTimes,
  FRESH_WINDOW_HOURS,
  THAWED_WINDOW_HOURS,
  FREEZER_TYPE_WINDOWS,
  EXPIRY_LEAD_HOURS,
} from '@/src/utils/milk-storage';

const T0 = new Date('2026-09-01T10:00:00.000Z');

function timing(overrides: Partial<Parameters<typeof computeUseBy>[0]> = {}) {
  return {
    provenance: 'fresh' as const,
    storageLocation: 'fridge' as const,
    startedAt: T0,
    lastLocationChangedAt: T0,
    ...overrides,
  };
}

describe('safe-storage windows (every provenance x location cell)', () => {
  it('fresh room is 8h, fresh fridge is 72h', () => {
    expect(FRESH_WINDOW_HOURS).toEqual({ room: 8, fridge: 72 });
  });

  it('thawed room is 4h, thawed fridge is 24h', () => {
    expect(THAWED_WINDOW_HOURS).toEqual({ room: 4, fridge: 24 });
  });

  it('freezer windows by type: compartment 2 weeks, separate-door 3 months, chest 6 months', () => {
    expect(FREEZER_TYPE_WINDOWS.compartment).toEqual({ days: 14 });
    expect(FREEZER_TYPE_WINDOWS['separate-door']).toEqual({ months: 3 });
    expect(FREEZER_TYPE_WINDOWS.chest).toEqual({ months: 6 });
  });
});

describe('computeUseBy', () => {
  it('fresh in room: use-by is startedAt + 8h', () => {
    const r = computeUseBy(timing({ storageLocation: 'room' }), 'separate-door');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.useByAt.toISOString()).toBe('2026-09-01T18:00:00.000Z');
  });

  it('fresh in fridge: use-by is startedAt + 72h', () => {
    const r = computeUseBy(timing(), 'separate-door');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.useByAt.toISOString()).toBe('2026-09-04T10:00:00.000Z');
  });

  it('fresh in freezer: use-by is startedAt + freezer-type window (3 months by default type)', () => {
    const r = computeUseBy(timing({ storageLocation: 'freezer' }), 'separate-door');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.useByAt.toISOString()).toBe('2026-12-01T10:00:00.000Z');
  });

  it('fresh in freezer with chest type: 6 months', () => {
    const r = computeUseBy(timing({ storageLocation: 'freezer' }), 'chest');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.useByAt.toISOString()).toBe('2027-03-01T10:00:00.000Z');
  });

  it('fresh in freezer with compartment type: 2 weeks', () => {
    const r = computeUseBy(timing({ storageLocation: 'freezer' }), 'compartment');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.useByAt.toISOString()).toBe('2026-09-15T10:00:00.000Z');
  });

  it('thawed in fridge: use-by is lastLocationChangedAt + 24h (not expression time)', () => {
    const r = computeUseBy(
      timing({
        provenance: 'thawed',
        storageLocation: 'fridge',
        startedAt: T0,
        lastLocationChangedAt: new Date('2026-09-05T12:00:00.000Z'),
      }),
      'separate-door',
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.useByAt.toISOString()).toBe('2026-09-06T12:00:00.000Z');
  });

  it('thawed in room: use-by is lastLocationChangedAt + 4h', () => {
    const r = computeUseBy(
      timing({
        provenance: 'thawed',
        storageLocation: 'room',
        lastLocationChangedAt: new Date('2026-09-05T12:00:00.000Z'),
      }),
      'separate-door',
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.useByAt.toISOString()).toBe('2026-09-05T16:00:00.000Z');
  });

  it('thawed in freezer is disallowed', () => {
    const r = computeUseBy(timing({ provenance: 'thawed', storageLocation: 'freezer' }), 'separate-door');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('thawed-in-freezer');
  });
});

describe('applyLocationChange', () => {
  it('freezer -> fridge derives Thawed and resets the timer to 24h from the move', () => {
    const r = applyLocationChange(
      timing({ storageLocation: 'freezer', startedAt: T0, lastLocationChangedAt: T0 }),
      'fridge',
      new Date('2026-09-03T09:00:00.000Z'),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.timing.provenance).toBe('thawed');
      expect(r.timing.lastLocationChangedAt.toISOString()).toBe('2026-09-03T09:00:00.000Z');
      const useBy = computeUseBy(r.timing, 'separate-door');
      if (useBy.ok) expect(useBy.useByAt.toISOString()).toBe('2026-09-04T09:00:00.000Z');
    }
  });

  it('freezer -> room also derives Thawed with the 4h window', () => {
    const r = applyLocationChange(
      timing({ storageLocation: 'freezer' }),
      'room',
      new Date('2026-09-03T09:00:00.000Z'),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.timing.provenance).toBe('thawed');
      expect(r.timing.storageLocation).toBe('room');
    }
  });

  it('thawed -> freezer is blocked with an explanation', () => {
    const r = applyLocationChange(timing({ provenance: 'thawed', storageLocation: 'fridge' }), 'freezer', T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/refreez/i);
  });

  it('fresh fridge -> freezer stays fresh (freezing is not thawing)', () => {
    const r = applyLocationChange(timing({ storageLocation: 'fridge' }), 'freezer', T0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.timing.provenance).toBe('fresh');
      expect(r.timing.storageLocation).toBe('freezer');
    }
  });

  it('same location is a no-op that does not reset any timer', () => {
    const at = new Date('2026-09-02T09:00:00.000Z');
    const r = applyLocationChange(timing(), 'fridge', at);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.timing.lastLocationChangedAt.toISOString()).toBe(T0.toISOString());
      expect(r.timing.storageLocation).toBe('fridge');
    }
  });

  it('fresh fridge -> room keeps fresh provenance (fresh counter stays anchored to expression)', () => {
    const r = applyLocationChange(timing({ storageLocation: 'fridge' }), 'room', new Date('2026-09-02T09:00:00.000Z'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.timing.provenance).toBe('fresh');
  });
});

describe('isExpired', () => {
  it('flags a bag past its use-by', () => {
    const t = timing({ storageLocation: 'room' }); // use-by 18:00
    expect(isExpired(t, 'separate-door', new Date('2026-09-01T18:00:01.000Z'))).toBe(true);
    expect(isExpired(t, 'separate-door', new Date('2026-09-01T18:00:00.000Z'))).toBe(true);
    expect(isExpired(t, 'separate-door', new Date('2026-09-01T17:59:59.000Z'))).toBe(false);
  });
});

describe('expiryAlertTimes (lead times Room 2h / Fridge 6h / Freezer 1 day, plus at-expiry)', () => {
  it('exposes the lead-time table', () => {
    expect(EXPIRY_LEAD_HOURS).toEqual({ room: 2, fridge: 6, freezer: 24 });
  });

  it('returns a lead alert and an at-expiry alert, sorted ascending', () => {
    const alerts = expiryAlertTimes(timing({ storageLocation: 'room' }), 'separate-door');
    expect(alerts.map((a) => a.kind)).toEqual(['lead', 'expired']);
    expect(alerts[0].at.toISOString()).toBe('2026-09-01T16:00:00.000Z');
    expect(alerts[1].at.toISOString()).toBe('2026-09-01T18:00:00.000Z');
  });

  it('uses the 6h lead for thawed-in-fridge and fresh-in-fridge alike', () => {
    const thawed = expiryAlertTimes(timing({ provenance: 'thawed', storageLocation: 'fridge' }), 'separate-door');
    const fresh = expiryAlertTimes(timing({ storageLocation: 'fridge' }), 'separate-door');
    // thawed fridge use-by anchors to lastLocationChangedAt + 24h (= 09-02T10:00), lead 6h
    expect(thawed[0].at.toISOString()).toBe('2026-09-02T04:00:00.000Z');
    expect(fresh[0].at.toISOString()).toBe('2026-09-04T04:00:00.000Z');
  });

  it('uses the 1-day lead for freezer bags', () => {
    const alerts = expiryAlertTimes(timing({ storageLocation: 'freezer' }), 'separate-door');
    expect(alerts[0].at.toISOString()).toBe('2026-11-30T10:00:00.000Z');
    expect(alerts[1].at.toISOString()).toBe('2026-12-01T10:00:00.000Z');
  });
});
