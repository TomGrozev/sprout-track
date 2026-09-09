import { describe, expect, it } from 'vitest';
import {
  type QuickPresetRecord,
  buildQuickPresets,
  DIAPER_PRESET_FIELDS,
  FEED_PRESET_FIELDS,
} from '@/src/utils/quickPreset';

// Helper: a row with fixed values and the given ISO time; `values` holds the
// already-extracted key-field values.
const row = (
  values: Record<string, string | number | null | undefined>,
  time = '2026-08-10T10:00:00Z'
): QuickPresetRecord => ({ time, values });

const NOW = new Date('2026-09-08T10:00:00Z');

describe('buildQuickPresets (issue #7)', () => {
  it('returns empty for empty history', () => {
    expect(buildQuickPresets([], { now: NOW })).toEqual([]);
  });

  it('defaults minFrequency to 2 so one-off combos are never suggested', () => {
    const presets = buildQuickPresets(
      [
        row({ type: 'WET' }, '2026-09-01T10:00:00Z'),
        row({ type: 'DIRTY' }, '2026-09-02T10:00:00Z'),
      ],
      { now: NOW }
    );
    expect(presets).toEqual([]);
  });

  it('excludes records older than 30 days before ranking', () => {
    const within = row({ type: 'WET' }, '2026-08-25T10:00:00Z');
    const outside = row({ type: 'WET' }, '2026-08-08T10:00:00Z');
    const presets = buildQuickPresets([outside, within], { now: NOW, minFrequency: 1 });
    expect(presets).toHaveLength(1);
    expect(presets[0].frequency).toBe(1);
    expect(presets[0].lastTime).toBe('2026-08-25T10:00:00Z');
  });

  it('raises frequency for repeated combinations', () => {
    const a1 = row({ type: 'WET', color: 'YELLOW' }, '2026-09-01T10:00:00Z');
    const a2 = row({ type: 'WET', color: 'YELLOW' }, '2026-09-02T10:00:00Z');
    const near = row({ type: 'WET', color: 'YELLOW' }, '2026-09-02T18:00:00Z');
    const presets = buildQuickPresets([a1, a2, near], { now: NOW });
    expect(presets[0].frequency).toBe(3);
    expect(presets[0].lastTime).toBe('2026-09-02T18:00:00Z');
  });

  it('breaks frequency ties by recency', () => {
    const olderTop = row({ type: 'WET' }, '2026-08-30T10:00:00Z');
    const recentTail = row({ type: 'DIRTY' }, '2026-09-05T10:00:00Z');
    const presets = buildQuickPresets([olderTop, recentTail], { now: NOW, minFrequency: 1 });
    expect(presets.map((p) => p.values.type)).toEqual(['DIRTY', 'WET']);
  });

  it('breaks recency ties deterministically and is not order-sensitive', () => {
    const x1 = row({ type: 'A' }, '2026-09-05T10:00:00Z');
    const y1 = row({ type: 'B' }, '2026-09-05T10:00:00Z');
    const forward = buildQuickPresets([x1, y1], { now: NOW, minFrequency: 1 });
    const backward = buildQuickPresets([y1, x1], { now: NOW, minFrequency: 1 });
    // Same time, same frequency: both orders rank 'A' first via value order.
    expect(forward.map((p) => p.values.type)).toEqual(['A', 'B']);
    expect(backward.map((p) => p.values.type)).toEqual(['A', 'B']);
  });

  it('omits rows with no extractable fields and empty-valued combos', () => {
    const empty = row({ type: '' }, '2026-09-01T10:00:00Z');
    const blank = row({}, '2026-09-01T10:00:00Z');
    const good = row({ type: 'WET' }, '2026-09-02T10:00:00Z');
    const presets = buildQuickPresets([empty, blank, good], { now: NOW, minFrequency: 1 });
    expect(presets).toHaveLength(1);
    expect(presets[0].values).toEqual({ type: 'WET' });
  });

  it('limits results to the requested count, most frequent first', () => {
    const rows = [
      row({ type: 'WET' }, '2026-09-01T10:00:00Z'),
      row({ type: 'WET' }, '2026-09-02T10:00:00Z'),
      row({ type: 'WET' }, '2026-09-03T10:00:00Z'),
      row({ type: 'DIRTY' }, '2026-09-04T10:00:00Z'),
      row({ type: 'DIRTY' }, '2026-09-05T10:00:00Z'),
      row({ type: 'DRY' }, '2026-09-06T10:00:00Z'),
    ];
    const presets = buildQuickPresets(rows, { now: NOW, limit: 2 });
    expect(presets.map((p) => [p.values.type, p.frequency])).toEqual([
      ['WET', 3],
      ['DIRTY', 2],
    ]);
    expect(buildQuickPresets(rows, { now: NOW }).length).toBeLessThanOrEqual(3);
  });

  it('applies the date window before ranking, so old frequency cannot dominate', () => {
    const rows = [
      row({ type: 'WET' }, '2026-07-01T10:00:00Z'),
      row({ type: 'WET' }, '2026-07-02T10:00:00Z'),
      row({ type: 'DIRTY' }, '2026-09-01T10:00:00Z'),
    ];
    const presets = buildQuickPresets(rows, { now: NOW, minFrequency: 1 });
    expect(presets.map((p) => p.values.type)).toEqual(['DIRTY']);
  });
});

describe('form field maps', () => {
  it('diaper presets combine type, condition and color', () => {
    expect(
      buildQuickPresets(
        [row({ type: 'BOTH', condition: 'NORMAL', color: 'YELLOW' }, '2026-09-05T10:00:00Z')],
        { now: NOW, fields: DIAPER_PRESET_FIELDS, minFrequency: 1 }
      ).map((p) => p.values)
    ).toEqual([{ type: 'BOTH', condition: 'NORMAL', color: 'YELLOW' }]);
  });

  it('feed fields are type-conditional: presets carry type and bottleType only', () => {
    const bottle = (values: Record<string, string | number | null | undefined>, time: string) =>
      row({ type: 'BOTTLE', ...values }, time);

    const rows = [
      row({ type: 'BREAST' }, '2026-09-06T11:00:00Z'),
      row({ type: 'BREAST' }, '2026-09-05T10:00:00Z'),
      bottle({ bottleType: 'Formula' }, '2026-09-06T10:00:00Z'),
      bottle({ bottleType: 'Formula' }, '2026-09-05T09:00:00Z'),
    ];

    const presets = buildQuickPresets(rows, {
      now: NOW,
      fields: FEED_PRESET_FIELDS,
      minFrequency: 1,
    });
    expect(presets.map((p) => p.values.type)).toEqual(['BREAST', 'BOTTLE']);
    expect(presets[0].values).toEqual({ type: 'BREAST' });
    expect(presets[1].values).toEqual({ type: 'BOTTLE', bottleType: 'Formula' });
  });

  it('treats missing fields as absent rather than null values', () => {
    const presets = buildQuickPresets(
      [row({ type: 'WET', condition: null, color: null }, '2026-09-05T10:00:00Z')],
      { now: NOW, fields: DIAPER_PRESET_FIELDS, minFrequency: 1 }
    );
    expect(presets[0].values).toEqual({ type: 'WET' });
  });
});
