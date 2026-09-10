import { describe, expect, it } from 'vitest';
import {
  type QuickPresetRecord,
  buildQuickPresets,
  DIAPER_PRESET_FIELDS,
  FEED_PRESET_FIELDS,
  MAX_NOTE_LABEL_LENGTH,
  truncateNoteLabel,
} from '@/src/utils/quickPreset';

// Helper: a row with fixed values and the given ISO time; `values` holds the
// already-extracted key-field values.
const row = (
  values: Record<string, string | number | null | undefined>,
  time = '2026-08-10T10:00:00Z'
): QuickPresetRecord => ({ time, values });

const NOW = new Date('2026-09-08T10:00:00Z');

// A row carrying an optional note alongside its key-field values.
const notedRow = (
  note: string | undefined,
  time: string,
  values: Record<string, string | number | null | undefined> = {}
): QuickPresetRecord => {
  const base = row({ type: 'BOTTLE', ...values }, time);
  return note === undefined ? base : { ...base, notes: note };
};

describe('buildQuickPresets (issue #7)', () => {
  it('returns empty for empty history', () => {
    expect(buildQuickPresets([], { now: NOW })).toEqual([]);
  });

  it('does not suggest non-recent one-off combos, but pins the newest as chip 1', () => {
    const presets = buildQuickPresets(
      [
        row({ type: 'WET' }, '2026-09-01T10:00:00Z'),
        row({ type: 'DIRTY' }, '2026-09-02T10:00:00Z'),
      ],
      { now: NOW }
    );
    // DIRTY is the newest combo → chip 1 even as a one-off; the older WET
    // one-off stays below minFrequency and is never suggested.
    expect(presets.map((p) => p.values.type)).toEqual(['DIRTY']);
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

  it('pins the newest one-off combo as chip 1 even below minFrequency', () => {
    const presets = buildQuickPresets(
      [
        row({ type: 'DIRTY' }, '2026-09-07T10:00:00Z'),
        row({ type: 'WET' }, '2026-09-01T10:00:00Z'),
        row({ type: 'WET' }, '2026-09-02T10:00:00Z'),
        row({ type: 'WET' }, '2026-09-03T10:00:00Z'),
      ],
      { now: NOW }
    );
    // DIRTY happens once but is the newest → chip 1; WET fills the rest.
    expect(presets.map((p) => p.values.type)).toEqual(['DIRTY', 'WET']);
  });

  it('does not duplicate a recent combo that is also popular; reports full frequency', () => {
    const rows = [
      row({ type: 'WET' }, '2026-09-01T10:00:00Z'),
      row({ type: 'WET' }, '2026-09-02T10:00:00Z'),
      row({ type: 'WET' }, '2026-09-03T10:00:00Z'),
    ];
    const presets = buildQuickPresets(rows, { now: NOW });
    // WET is newest AND the only popular combo → a single chip 1.
    expect(presets.map((p) => p.values.type)).toEqual(['WET']);
    expect(presets[0].frequency).toBe(3);
    expect(presets[0].lastTime).toBe('2026-09-03T10:00:00Z');
  });

  it('falls back to popular-only (nothing) when no valid in-window record exists', () => {
    // A malformed row (no type) and an out-of-window row → no recent chip.
    const presets = buildQuickPresets(
      [row({}, '2026-09-07T10:00:00Z'), row({ type: 'WET' }, '2026-07-01T10:00:00Z')],
      { now: NOW }
    );
    expect(presets).toEqual([]);
  });

  it('breaks frequency ties by recency', () => {
    const olderTop = row({ type: 'WET' }, '2026-08-30T10:00:00Z');
    const recentTail = row({ type: 'DIRTY' }, '2026-09-05T10:00:00Z');
    const presets = buildQuickPresets([olderTop, recentTail], { now: NOW, minFrequency: 1 });
    // The newest combo is chip 1; the popular slot is the other one.
    expect(presets.map((p) => p.values.type)).toEqual(['DIRTY', 'WET']);
  });

  it('ranks remaining slots deterministically regardless of input order', () => {
    const makeRows = () => [
      row({ type: 'A' }, '2026-09-03T10:00:00Z'),
      row({ type: 'B' }, '2026-09-02T10:00:00Z'),
      row({ type: 'C' }, '2026-09-05T10:00:00Z'), // newest → chip 1
    ];
    const forward = buildQuickPresets(makeRows(), { now: NOW, minFrequency: 1 });
    const backward = buildQuickPresets(makeRows().reverse(), { now: NOW, minFrequency: 1 });
    // C (newest) is chip 1; the remaining A/B sort by recency then value, so
    // both input orders rank identically.
    expect(forward.map((p) => p.values.type)).toEqual(['C', 'A', 'B']);
    expect(backward.map((p) => p.values.type)).toEqual(['C', 'A', 'B']);
  });

  it('omits rows with no extractable fields and empty-valued combos', () => {
    const empty = row({ type: '' }, '2026-09-01T10:00:00Z');
    const blank = row({}, '2026-09-01T10:00:00Z');
    const good = row({ type: 'WET' }, '2026-09-02T10:00:00Z');
    const presets = buildQuickPresets([empty, blank, good], { now: NOW, minFrequency: 1 });
    expect(presets).toHaveLength(1);
    expect(presets[0].values).toEqual({ type: 'WET' });
  });

  it('limits results to the requested count, recent chip first', () => {
    const rows = [
      row({ type: 'WET' }, '2026-09-01T10:00:00Z'),
      row({ type: 'WET' }, '2026-09-02T10:00:00Z'),
      row({ type: 'WET' }, '2026-09-03T10:00:00Z'),
      row({ type: 'DIRTY' }, '2026-09-04T10:00:00Z'),
      row({ type: 'DIRTY' }, '2026-09-05T10:00:00Z'),
      row({ type: 'DRY' }, '2026-09-06T10:00:00Z'),
    ];
    // DRY is the newest (one-off) → chip 1; the remaining slot goes to the
    // most frequent popular combo (WET).
    expect(buildQuickPresets(rows, { now: NOW, limit: 2 }).map((p) => p.values.type)).toEqual([
      'DRY',
      'WET',
    ]);
    // Default limit 3 → DRY + WET + DIRTY, still within 3.
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

describe('notes-derived "other" candidates', () => {
  it('groups repeated trimmed notes into a candidate', () => {
    const presets = buildQuickPresets(
      [
        notedRow('  Call doctor  ', '2026-09-01T10:00:00Z'),
        notedRow('Call doctor', '2026-09-02T10:00:00Z'),
      ],
      { now: NOW }
    );
    const other = presets.find((p) => p.values.notes !== undefined);
    expect(other).toBeDefined();
    expect(other!.values.notes).toBe('Call doctor');
    expect(other!.frequency).toBe(2);
  });

  it('applies the most recent row values plus the trimmed note', () => {
    const presets = buildQuickPresets(
      [
        notedRow('Call doctor', '2026-09-01T10:00:00Z', { bottleType: 'Formula' }),
        notedRow('Call doctor', '2026-09-06T10:00:00Z', { bottleType: 'Breast Milk' }),
      ],
      { now: NOW, fields: FEED_PRESET_FIELDS, minFrequency: 1 }
    );
    const other = presets.find((p) => p.values.notes !== undefined)!;
    expect(other.values).toEqual({
      type: 'BOTTLE',
      bottleType: 'Breast Milk',
      notes: 'Call doctor',
    });
    expect(other.lastTime).toBe('2026-09-06T10:00:00Z');
  });

  it('treats whitespace-only notes as absent', () => {
    const presets = buildQuickPresets(
      [
        notedRow('   ', '2026-09-01T10:00:00Z'),
        notedRow('   ', '2026-09-02T10:00:00Z'),
      ],
      { now: NOW, minFrequency: 1 }
    );
    expect(presets.filter((p) => p.values.notes !== undefined)).toEqual([]);
  });

  it('competes for the remaining slots after the recent field-combo chip', () => {
    const recent = row({ type: 'BREAST' }, '2026-09-07T10:00:00Z');
    const presets = buildQuickPresets(
      [
        recent,
        notedRow('night feed', '2026-09-01T10:00:00Z'),
        notedRow('night feed', '2026-09-02T10:00:00Z'),
      ],
      { now: NOW, limit: 2 }
    );
    // Recent field-combo chip (BREAST) first; the note group fills the rest.
    expect(presets.map((p) => p.values.notes)).toEqual([undefined, 'night feed']);
  });

  it('distinguishes note candidates by exact trimmed content (case-sensitive)', () => {
    const presets = buildQuickPresets(
      [
        notedRow('Feed', '2026-09-01T10:00:00Z'),
        notedRow('Feed', '2026-09-02T10:00:00Z'),
        notedRow('feed', '2026-09-03T10:00:00Z'),
        notedRow('feed', '2026-09-04T10:00:00Z'),
      ],
      { now: NOW }
    );
    const notes = presets.map((p) => p.values.notes).filter((n) => n !== undefined).sort();
    expect(notes).toEqual(['Feed', 'feed']);
  });
});

describe('truncateNoteLabel', () => {
  it('exposes MAX_NOTE_LABEL_LENGTH as 24', () => {
    expect(MAX_NOTE_LABEL_LENGTH).toBe(24);
  });

  it('returns short notes unchanged, trimmed', () => {
    expect(truncateNoteLabel('  call mike  ')).toBe('call mike');
  });

  it('keeps an exact-length note as-is', () => {
    const note = 'x'.repeat(24);
    expect(truncateNoteLabel(note)).toBe(note);
  });

  it('truncates long notes to 23 chars plus an ellipsis', () => {
    expect(truncateNoteLabel('x'.repeat(30))).toBe('x'.repeat(23) + '…');
  });

  it('strips trailing whitespace from the prefix before the ellipsis', () => {
    const result = truncateNoteLabel(('x'.repeat(23) + '   ').repeat(2));
    expect(result).toBe('x'.repeat(23) + '…');
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
