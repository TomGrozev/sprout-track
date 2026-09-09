/**
 * Quick-select presets (issue #7): pure ranking of recent activity logs into a
 * few tappable "pre-fill" chips.
 *
 * Generic by design — the kernel operates on minimal row-like records
 * ({ time, values }), so diaper, feed and future activity types plug in via a
 * field map without touching this module.
 */

/** A single log reduced to the key fields that make up its combination. */
export interface QuickPresetRecord {
 /** ISO timestamp of the log (used for the 30-day window and recency). */
 time: string;
 /** Key-field values for this log, e.g. { type: 'WET', color: 'YELLOW' }. */
 values: Record<string, string | number | null | undefined>;
}

/** One ranked combination ready for UI rendering. */
export interface QuickPreset {
 /**
  * Field values to apply to the form. Absent fields are omitted (never null),
  * so callers can spread this straight over form state untouched.
  */
 values: Record<string, string | number>;
 /** How often this exact combination occurred in the window. */
 frequency: number;
 /** ISO timestamp of the most recent occurrence. */
 lastTime: string;
}

/** Declares one field of a form's preset combination. */
export interface QuickPresetField {
 /** Field name; must match the form's state keys. */
 key: string;
 /**
  * True for fields every log carries (e.g. diaper type). Rows missing a
  * required field can never pre-fill a valid combination and are skipped.
  */
 required?: boolean;
}

export interface BuildQuickPresetsOptions {
 /** Instant the 30-day window and recency ranking are computed against. */
 now: Date;
 /** Preset fields for this activity; defaults to a single `type` field. */
 fields?: QuickPresetField[];
 /** Max chips to return; defaults to the ticket's top 3. */
 limit?: number;
 /** Minimum occurrences for a combination to be suggested; defaults to 2. */
 minFrequency?: number;
}

const DEFAULT_LIMIT = 3;
const DEFAULT_MIN_FREQUENCY = 2;
export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A field value is "absent" when the log really has nothing there. Empty
 * strings count as absent so blank optional selects never shape a combo.
 */
function isAbsent(value: string | number | null | undefined): boolean {
 return value === null || value === undefined || value === '';
}

/**
 * The combo's most recent real (non-absent) value for one field, or null when
 * no row in the group recorded one — the field is then simply absent from the
 * preset rather than pinned to a stale or made-up value.
 */
function resolveFieldValue(
 field: QuickPresetField,
 rows: QuickPresetRecord[]
): string | number | null {
 const firstReal = rows.map((r) => r.values[field.key]).find((v) => !isAbsent(v));
 return firstReal !== undefined ? firstReal : null;
}

/** Ranks recent records into at most `limit` presets, best first. */
export function buildQuickPresets(
 records: QuickPresetRecord[],
 options: BuildQuickPresetsOptions
): QuickPreset[] {
 const {
  now,
  fields = [{ key: 'type', required: true }],
  limit = DEFAULT_LIMIT,
  minFrequency = DEFAULT_MIN_FREQUENCY,
 } = options;

 const nowMs = now.getTime();
 const windowStartMs = nowMs - THIRTY_DAYS_MS;
 const recent: QuickPresetRecord[] = [];
 for (const record of records) {
  // Rows missing a required field (e.g. a malformed log with no type) can
  // never pre-fill a valid combination — skip them outright.
  if (fields.some((f) => f.required && isAbsent(record.values[f.key]))) continue;
  const timeMs = new Date(record.time).getTime();
  if (Number.isNaN(timeMs) || timeMs < windowStartMs || timeMs > nowMs + THIRTY_DAYS_MS) {
   continue;
  }
  recent.push(record);
 }
 // Most recent first: group lastTime and recency tie-breaks rely on this.
 recent.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

 // Group rows by their combination of declared field values. A field absent
 // from a row is genuinely missing from the combination — it does not group
 // with rows that have a real value there.
 const groups = new Map<string, QuickPresetRecord[]>();
 for (const record of recent) {
  const parts: string[] = [];
  for (const field of fields) {
   const value = record.values[field.key];
   if (isAbsent(value)) continue;
   parts.push(`${field.key}=${String(value)}`);
  }
  if (parts.length === 0) continue;
  const comboKey = parts.join('|');
  const group = groups.get(comboKey);
  if (group) {
   group.push(record);
  } else {
   groups.set(comboKey, [record]);
  }
 }

 // Ranked entry keeps its combo key so the final tie-break is deterministic.
 const ranked: { preset: QuickPreset; comboKey: string }[] = [];
 for (const [comboKey, rows] of groups) {
  if (rows.length < minFrequency) continue;
  const values: Record<string, string | number> = {};
  for (const field of fields) {
   const resolved = resolveFieldValue(field, rows);
   if (resolved !== null) values[field.key] = resolved;
  }
  if (Object.keys(values).length === 0) continue;
  ranked.push({
   preset: { values, frequency: rows.length, lastTime: rows[0].time },
   comboKey,
  });
 }

 ranked.sort((a, b) => {
  if (b.preset.frequency !== a.preset.frequency) return b.preset.frequency - a.preset.frequency;
  const lastDelta = new Date(b.preset.lastTime).getTime() - new Date(a.preset.lastTime).getTime();
  if (lastDelta !== 0) return lastDelta;
  return a.comboKey.localeCompare(b.comboKey);
 });

 return ranked.slice(0, limit).map((entry) => entry.preset);
}

/** Diaper combination: what kind, and (for contents) condition + color. */
export const DIAPER_PRESET_FIELDS: QuickPresetField[] = [
 // Required: a preset without a type cannot be applied to the form.
 { key: 'type', required: true },
 { key: 'condition' },
 { key: 'color' },
];

/**
 * Feed combination. Type picks the form mode; bottleType only means something
 * for bottles, so it is absent on breast rows and drops out of that preset
 * instead of pinning a stale value. Side is deliberately excluded: a new
 * breast entry is dispatched from the side timers/manual inputs, not from
 * formData.side, so a pre-filled side would advertise a choice the form may
 * not honor. Amount/unit are also excluded: one-off quantities would fragment
 * otherwise-identical feeding patterns into singletons below minFrequency.
 */
export const FEED_PRESET_FIELDS: QuickPresetField[] = [
 { key: 'type', required: true },
 { key: 'bottleType' },
];
