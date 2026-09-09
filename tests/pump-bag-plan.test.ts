import { describe, it, expect } from 'vitest';
import { planPumpBag } from '@/src/utils/milkBagPumpUi';

describe('planPumpBag', () => {
  it('appends to an existing bag when only appendToBagId is given', () => {
    const plan = planPumpBag({
      appendToBagId: 'bag-1',
      pumpAction: 'STORED',
      totalAmount: 60,
    });
    expect(plan).toEqual({ ok: true, mode: 'existing' });
  });

  it('creates a new bag when only newBagDayNight is given', () => {
    for (const newBagDayNight of ['day', 'night']) {
      const plan = planPumpBag({
        newBagDayNight,
        pumpAction: 'STORED',
        totalAmount: 60,
      });
      expect(plan).toEqual({ ok: true, mode: 'new', dayNight: newBagDayNight });
    }
  });

  it('treats absent bag fields as no bag intent (UI sends the label explicitly)', () => {
    const plan = planPumpBag({
      pumpAction: 'STORED',
      totalAmount: 60,
    });
    expect(plan).toEqual({ ok: true, mode: 'none' });
  });

  it('rejects specifying both an existing bag and a new-bag label', () => {
    const plan = planPumpBag({
      appendToBagId: 'bag-1',
      newBagDayNight: 'day',
      pumpAction: 'STORED',
      totalAmount: 60,
    });
    expect(plan).toEqual({ ok: false, status: 422, error: expect.any(String) });
  });

  it('rejects a new bag for a discarded (or fed) pump', () => {
    for (const pumpAction of ['FED', 'DISCARDED']) {
      const plan = planPumpBag({
        newBagDayNight: 'day',
        pumpAction,
        totalAmount: 60,
      });
      expect(plan).toEqual({ ok: false, status: 422, error: expect.stringContaining('stored') });
    }
  });

  it('rejects a new bag with no amount', () => {
    const plan = planPumpBag({
      newBagDayNight: 'day',
      pumpAction: 'STORED',
      totalAmount: 0,
    });
    expect(plan).toEqual({ ok: false, status: 422, error: expect.any(String) });

    const planNull = planPumpBag({
      newBagDayNight: 'night',
      pumpAction: 'STORED',
      totalAmount: undefined,
    });
    expect(planNull).toEqual({ ok: false, status: 422, error: expect.any(String) });
  });

  it('rejects an invalid day/night label value', () => {
    const plan = planPumpBag({
      newBagDayNight: 'dawn',
      pumpAction: 'STORED',
      totalAmount: 60,
    });
    expect(plan).toEqual({ ok: false, status: 422, error: expect.any(String) });
  });

  it('allows FED/DISCARDED without any bag fields (no bag intent)', () => {
    for (const pumpAction of ['FED', 'DISCARDED']) {
      const plan = planPumpBag({ pumpAction, totalAmount: 60 });
      expect(plan).toEqual({ ok: true, mode: 'none' });
    }
  });

  it('allows STORED without bag fields and without tracking (no bag created)', () => {
    const plan = planPumpBag({ pumpAction: 'STORED', totalAmount: null });
    expect(plan).toEqual({ ok: true, mode: 'none' });
  });
});
