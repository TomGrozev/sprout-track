import { describe, it, expect } from 'vitest';
import { setFreezerType } from '@/src/utils/milkBagSettingsUi';

/**
 * Issue #10: freezer type is a family setting stored inside the
 * Settings.milkBagSettings JSON blob. Changing it must preserve every unknown
 * key (day/night boundary hours, upgrade marker, any future field) — same
 * merge discipline as the upgrade marker in milkBagUpgradeUi.ts.
 */
describe('setFreezerType', () => {
 it('writes freezerType into an existing blob while preserving unknown keys', () => {
  const raw = JSON.stringify({ dayStartHour: 6, milkBagsUpgradedAt: '2026-09-01T00:00:00.000Z' });
  const out = JSON.parse(setFreezerType(raw, 'chest'));
  expect(out).toEqual({
   dayStartHour: 6,
   milkBagsUpgradedAt: '2026-09-01T00:00:00.000Z',
   freezerType: 'chest',
  });
 });

 it('overwrites a previously set freezer type without touching other keys', () => {
  const raw = JSON.stringify({ freezerType: 'compartment', dayEndHour: 20 });
  const out = JSON.parse(setFreezerType(raw, 'separate-door'));
  expect(out).toEqual({ freezerType: 'separate-door', dayEndHour: 20 });
 });

 it('starts a fresh blob when none exists', () => {
  expect(JSON.parse(setFreezerType(null, 'compartment'))).toEqual({ freezerType: 'compartment' });
  expect(JSON.parse(setFreezerType(undefined, 'chest'))).toEqual({ freezerType: 'chest' });
 });

 it('starts a fresh blob on garbled JSON rather than throwing', () => {
  expect(JSON.parse(setFreezerType('{not json', 'separate-door'))).toEqual({ freezerType: 'separate-door' });
 });

 it('accepts a non-object JSON payload (array/number) by starting fresh', () => {
  expect(JSON.parse(setFreezerType('[1,2]', 'chest'))).toEqual({ freezerType: 'chest' });
  expect(JSON.parse(setFreezerType('42', 'chest'))).toEqual({ freezerType: 'chest' });
 });
});
