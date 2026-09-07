/**
  * Issue #4: a sleep can move between locations mid-sleep. This module holds
  * the pure segment math: legacy single-location mapping, the "moved to X"
  * close-and-open transition, ordering/duration summary, and payload
  * validation. Kept free of DB and renderer dependencies so it is unit
  * testable directly (the ticket's tested seam).
  */

/** A single stretch of a sleep spent in one location. Times are ISO strings. */
export interface LocationSegmentInput {
  location: string;
  startTime: string;
  endTime: string | null;
}

/** What the sleep-log API accepts / returns for the segment timeline. */
export type SleepSegmentsShape = LocationSegmentInput[];

/**
  * The existing single SleepLog.location field represents the first/primary
  * segment: a legacy sleep (or a new one-location sleep) maps to exactly one
  * segment, open when the sleep is in progress, closed at the wake time.
  */
export function buildSegmentsFromLegacy(
  location: string | null,
  startTime: string,
  endTime?: string | null,
): SleepSegmentsShape {
  if (!location) return [];
  return [{ location, startTime, endTime: endTime ?? null }];
}

/**
  * Records "moved to <location>" mid-sleep: closes every still-open segment at
  * the move time (normally exactly one) and opens a new segment for the new
  * location. Moving onto the already-open location is a no-op, and so is a
  * move on a completed sleep — every segment is already closed, there is no
  * "current place" to move; rework history through the edit-mode timeline
  * instead.
  */
export function applyMove(
  segments: SleepSegmentsShape,
  location: string,
  moveTime: string,
): SleepSegmentsShape {
  const open = segments.find((segment) => segment.endTime === null);
  if (!open || open.location === location) return segments;

  return [
    ...segments.map((segment) =>
      segment.endTime === null ? { ...segment, endTime: moveTime } : segment,
    ),
    { location, startTime: moveTime, endTime: null },
  ];
}

/**
  * Closes every still-open segment at the wake time. Called when a sleep is
  * ended (or its end time edited) so the last segment's duration counts up to
  * the sleep's total duration. No-op when nothing is open.
  */
export function closeOpenSegments(
  segments: SleepSegmentsShape,
  wakeTime: string,
): SleepSegmentsShape {
  if (!segments.some((segment) => segment.endTime === null)) return segments;
  return segments.map((segment) =>
    segment.endTime === null ? { ...segment, endTime: wakeTime } : segment,
  );
}

/** One rendered row of the sleep-location timeline. */
export interface SegmentSummaryRow {
  /** Location exactly as stored; callers localize via localizeSleepLocation. */
  location: string;
  /** "start – end" (or "start – " while open), times via the caller's formatter. */
  span: string;
}

/**
  * Renders the ordered segment sequence for the timeline/summary: one row per
  * segment with its time span. Times pass through the caller-provided formatter
  * so the UI owns timezone and 12/24-hour handling; locations stay raw so
  * localizeSleepLocation stays the single label rule.
  */
export function formatSegmentSummary(
  segments: SleepSegmentsShape,
  formatTime: (iso: string) => string,
): SegmentSummaryRow[] {
  return segments.map((segment) => ({
    location: segment.location,
    span: `${formatTime(segment.startTime)} – ${segment.endTime ? formatTime(segment.endTime) : ''}`,
  }));
}

export type NormalizedSegments =
  | { valid: true; segments: SleepSegmentsShape }
  | { valid: false; error: string };

/**
  * Validates a client-sent segment list before it replaces a sleep's stored
  * timeline: locations must be non-empty (trimmed on storage), times valid,
  * end >= start, the chain contiguous, and at most one open segment. The list
  * is returned sorted by start time so storage order is deterministic.
  */
export function normalizeSegmentPayload(input: unknown): NormalizedSegments {
  if (!Array.isArray(input) || input.length === 0) {
    return { valid: false, error: 'At least one location segment is required.' };
  }

  const parsed: (LocationSegmentInput | { _error: string })[] = input.map((raw) => {
    const entry = raw as Partial<LocationSegmentInput>;
    const location = typeof entry?.location === 'string' ? entry.location.trim() : '';
    if (!location) return { _error: 'Each segment needs a location.' };

    const startMs = Date.parse(entry?.startTime as string);
    if (!entry?.startTime || Number.isNaN(startMs)) {
      return { _error: 'Each segment needs a valid start time.' };
    }

    let endMs: number | null = null;
    if (entry.endTime !== null && entry.endTime !== undefined) {
      endMs = Date.parse(entry.endTime as string);
      if (Number.isNaN(endMs)) return { _error: 'Segment end time is not a valid date.' };
      if (endMs < startMs) return { _error: 'A segment cannot end before it starts.' };
    }

    return {
      location,
      startTime: new Date(startMs).toISOString(),
      endTime: endMs === null ? null : new Date(endMs).toISOString(),
    };
  });

  const failure = parsed.find((segment): segment is { _error: string } => '_error' in segment);
  if (failure) return { valid: false, error: failure._error };

  const segments = (parsed as LocationSegmentInput[]).sort(
    (a, b) => Date.parse(a.startTime) - Date.parse(b.startTime),
  );

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (index > 0) {
      const previous = segments[index - 1];
      if (previous.endTime === null) {
        return { valid: false, error: 'Only the last segment can be open.' };
      }
      if (Date.parse(segment.startTime) > Date.parse(previous.endTime)) {
        return { valid: false, error: 'Segments must not leave gaps between locations.' };
      }
      if (Date.parse(segment.startTime) < Date.parse(previous.endTime)) {
        return { valid: false, error: 'Segments must not overlap.' };
      }
    }
  }

  return { valid: true, segments };
}
