import { describe, expect, it } from 'vitest';
import {
  applyMove,
  buildSegmentsFromLegacy,
  closeOpenSegments,
  formatSegmentSummary,
  normalizeSegmentPayload,
  type SleepSegmentsShape,
} from '@/src/utils/sleepSegments';

// Issue #4: a sleep can hold an ordered timeline of location segments. The
// seam under test is the pure segment math: legacy single-location mapping,
// move-closing, ordering/durations, and payload validation. No DB, no renderer.
//
// Worked example times: 2026-09-07 19:00Z, 20:00Z, 21:00Z.
const T1900 = '2026-09-07T19:00:00.000Z';
const T2000 = '2026-09-07T20:00:00.000Z';
const T2100 = '2026-09-07T21:00:00.000Z';
const T2300 = '2026-09-07T23:00:00.000Z';

describe('buildSegmentsFromLegacy (issue #4)', () => {
  it('maps a legacy single-location sleep to a single open segment starting at the sleep start', () => {
    expect(buildSegmentsFromLegacy('Bassinet', T1900)).toEqual([
      { location: 'Bassinet', startTime: T1900, endTime: null },
    ]);
  });

  it('closes the legacy segment at the wake time when the sleep has ended', () => {
    expect(buildSegmentsFromLegacy('Crib', T1900, T2100)).toEqual([
      { location: 'Crib', startTime: T1900, endTime: T2100 },
    ]);
  });

  it('yields no segments for a sleep without a location', () => {
    expect(buildSegmentsFromLegacy(null, T1900)).toEqual([]);
  });
});

describe('applyMove (issue #4)', () => {
  it('closes the open segment at the move time and opens a new segment for the new location', () => {
    const segments: SleepSegmentsShape = buildSegmentsFromLegacy('Bassinet', T1900);
    expect(applyMove(segments, 'Car Seat', T2100)).toEqual([
      { location: 'Bassinet', startTime: T1900, endTime: T2100 },
      { location: 'Car Seat', startTime: T2100, endTime: null },
    ]);
  });

  it('ignores a move that would copy the currently open location', () => {
    const segments: SleepSegmentsShape = [{ location: 'Crib', startTime: T1900, endTime: null }];
    expect(applyMove(segments, 'Crib', T2100)).toBe(segments);
  });

  it('leaves a completed sleep untouched: moves apply only to in-progress sleeps', () => {
    const segments: SleepSegmentsShape = [
      { location: 'Bassinet', startTime: T1900, endTime: T2100 },
    ];
    expect(applyMove(segments, 'Crib', T2100)).toBe(segments);
  });

  describe('closeOpenSegments (issue #4)', () => {
    it('closes still-open segments at the wake time so per-segment durations add up', () => {
      const segments: SleepSegmentsShape = [
        { location: 'Bassinet', startTime: T1900, endTime: T2100 },
        { location: 'Car Seat', startTime: T2100, endTime: null },
      ];
      expect(closeOpenSegments(segments, T2300)).toEqual([
        { location: 'Bassinet', startTime: T1900, endTime: T2100 },
        { location: 'Car Seat', startTime: T2100, endTime: T2300 },
      ]);
    });

    it('is a no-op when every segment is already closed', () => {
      const segments: SleepSegmentsShape = [
        { location: 'Crib', startTime: T1900, endTime: T2100 },
      ];
      expect(closeOpenSegments(segments, T2300)).toBe(segments);
    });
  });

  describe('normalizeSegmentPayload (issue #4)', () => {
    it('accepts a well-formed ordered list and returns it structured for storage', () => {
      const result = normalizeSegmentPayload([
        { location: 'Bassinet', startTime: T1900, endTime: T2100 },
        { location: 'Car Seat', startTime: T2100, endTime: null },
      ]);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.segments).toEqual([
          { location: 'Bassinet', startTime: T1900, endTime: T2100 },
          { location: 'Car Seat', startTime: T2100, endTime: null },
        ]);
      }
    });

    it('rejects a segment without a location', () => {
      const result = normalizeSegmentPayload([
        { location: '  ', startTime: T1900, endTime: null },
      ]);
      expect(result.valid).toBe(false);
    });

    it('rejects an invalid start time', () => {
      const result = normalizeSegmentPayload([
        { location: 'Crib', startTime: 'not-a-date', endTime: null },
      ]);
      expect(result.valid).toBe(false);
    });

    it('rejects an end time before the start time', () => {
      const result = normalizeSegmentPayload([
        { location: 'Crib', startTime: T2100, endTime: T1900 },
      ]);
      expect(result.valid).toBe(false);
    });

    it('rejects a list whose segment chain is broken: a closed segment followed by a segment starting later leaves a gap', () => {
      const result = normalizeSegmentPayload([
        { location: 'Bassinet', startTime: T1900, endTime: T2000 },
        { location: 'Car Seat', startTime: T2100, endTime: null },
      ]);
      expect(result.valid).toBe(false);
    });

    it('rejects a list with two open segments', () => {
      const result = normalizeSegmentPayload([
        { location: 'Bassinet', startTime: T1900, endTime: null },
        { location: 'Car Seat', startTime: T2000, endTime: null },
      ]);
      expect(result.valid).toBe(false);
    });

    it('rejects overlapping segments so per-segment durations stay truthful', () => {
      const result = normalizeSegmentPayload([
        { location: 'Bassinet', startTime: T1900, endTime: T2100 },
        { location: 'Car Seat', startTime: T2000, endTime: T2100 },
      ]);
      expect(result.valid).toBe(false);
    });

    it('sorts segments by start time so a client-sent list is ordered for storage', () => {
      const result = normalizeSegmentPayload([
        { location: 'Car Seat', startTime: T2100, endTime: null },
        { location: 'Bassinet', startTime: T1900, endTime: T2100 },
      ]);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.segments.map((segment) => segment.location)).toEqual(['Bassinet', 'Car Seat']);
      }
    });

    it('trims locations on storage', () => {
      const result = normalizeSegmentPayload([
        { location: ' Crib ', startTime: T1900, endTime: null },
      ]);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.segments[0].location).toBe('Crib');
      }
    });
  });
  describe('formatSegmentSummary (issue #4)', () => {
    it('renders the ordered locations with each segment time span for a segmented sleep', () => {
      const segments: SleepSegmentsShape = [
        { location: 'Bassinet', startTime: T1900, endTime: T2100 },
        { location: 'Car Seat', startTime: T2100, endTime: null },
      ];
      expect(
        formatSegmentSummary(segments, (key) => key.slice(11, 16))
      ).toEqual([
        { location: 'Bassinet', span: '19:00 – 21:00' },
        { location: 'Car Seat', span: '21:00 – ' },
      ]);
    });

    it('formats times with the caller-provided formatter so the UI controls timezone/12-24h', () => {
      const segments: SleepSegmentsShape = [
        { location: 'Crib', startTime: T1900, endTime: T2100 },
      ];
      expect(
        formatSegmentSummary(segments, (key) => `<${key}>`)
      ).toEqual([{ location: 'Crib', span: '<2026-09-07T19:00:00.000Z> – <2026-09-07T21:00:00.000Z>' }]);
    });

    it('falls back to the legacy single-location line when there are no segments', () => {
      expect(formatSegmentSummary([], (key) => key)).toEqual([]);
    });
  });
});
