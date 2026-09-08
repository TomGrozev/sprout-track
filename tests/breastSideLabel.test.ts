import { describe, it, expect } from 'vitest';
import { resolveBreastSideLabel } from '@/src/utils/breastSideLabel';

// Issue #5: families can give each breast a custom display name. When set, the
// UI shows that name wherever Left/Right appears; when unset the helper returns
// null so call sites fall back to the existing translated Left/Right. This is
// display-only — the stored side value (LEFT/RIGHT) is never changed.

describe('resolveBreastSideLabel', () => {
  describe('custom labels are used when present', () => {
    it('returns breastLeftLabel for LEFT when it is a non-empty string', () => {
      const settings = { breastLeftLabel: 'Mama', breastRightLabel: 'Papa' };
      expect(resolveBreastSideLabel('LEFT', settings)).toBe('Mama');
    });

    it('returns breastRightLabel for RIGHT when it is a non-empty string', () => {
      const settings = { breastLeftLabel: 'Mama', breastRightLabel: 'Papa' };
      expect(resolveBreastSideLabel('RIGHT', settings)).toBe('Papa');
    });

    it('trims leading and trailing whitespace off a valid custom label', () => {
      const settings = { breastLeftLabel: '  Mama  ' };
      expect(resolveBreastSideLabel('LEFT', settings)).toBe('Mama');
    });
  });

  describe('falls back to null when the matching field is blank', () => {
    it('returns null when the matching field is an empty string', () => {
      const settings = { breastLeftLabel: '', breastRightLabel: '' };
      expect(resolveBreastSideLabel('LEFT', settings)).toBeNull();
      expect(resolveBreastSideLabel('RIGHT', settings)).toBeNull();
    });

    it('returns null when the matching field is whitespace-only', () => {
      const settings = { breastLeftLabel: '   ', breastRightLabel: ' \t ' };
      expect(resolveBreastSideLabel('LEFT', settings)).toBeNull();
      expect(resolveBreastSideLabel('RIGHT', settings)).toBeNull();
    });

    it('returns null when the matching field is null', () => {
      const settings = { breastLeftLabel: null, breastRightLabel: null };
      expect(resolveBreastSideLabel('LEFT', settings)).toBeNull();
      expect(resolveBreastSideLabel('RIGHT', settings)).toBeNull();
    });

    it('returns null when the matching field is undefined', () => {
      const settings = { breastLeftLabel: undefined, breastRightLabel: undefined };
      expect(resolveBreastSideLabel('LEFT', settings)).toBeNull();
      expect(resolveBreastSideLabel('RIGHT', settings)).toBeNull();
    });

    it('returns null when the matching field is absent from the object', () => {
      expect(resolveBreastSideLabel('LEFT', {})).toBeNull();
      expect(resolveBreastSideLabel('RIGHT', {})).toBeNull();
    });
  });

  describe('falls back to null for invalid inputs', () => {
    it('returns null when settings is null', () => {
      expect(resolveBreastSideLabel('LEFT', null)).toBeNull();
      expect(resolveBreastSideLabel('RIGHT', null)).toBeNull();
    });

    it('returns null when settings is undefined', () => {
      expect(resolveBreastSideLabel('LEFT', undefined)).toBeNull();
      expect(resolveBreastSideLabel('RIGHT', undefined)).toBeNull();
    });

    it('returns null for a side that is neither LEFT nor RIGHT, even if both fields are set', () => {
      const settings = { breastLeftLabel: 'Mama', breastRightLabel: 'Papa' };
      expect(resolveBreastSideLabel('BOTH', settings)).toBeNull();
      expect(resolveBreastSideLabel('', settings)).toBeNull();
    });
  });
});
