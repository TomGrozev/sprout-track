'use client';

import React, { useEffect, useState } from 'react';
import { Chip } from '@/src/components/ui/chip';
import {
 buildQuickPresets,
 DIAPER_PRESET_FIELDS,
 FEED_PRESET_FIELDS,
 QuickPreset,
 QuickPresetRecord,
 THIRTY_DAYS_MS,
} from '@/src/utils/quickPreset';
import { useLocalization } from '@/src/context/localization';
import { DiaperLogResponse, FeedLogResponse } from '@/app/api/types';

/**
 * Quick-select presets (issue #7): fetches a baby's recent activity logs and
 * renders tappable chips for the most frequent value combinations, so a parent
 * can pre-fill a form in one tap instead of re-selecting every field.
 *
 * Pure ranking lives in src/utils/quickPreset.ts — this component only does
 * the data plumbing (fetch → filter soft-deletes → map rows → build).
 */
export interface QuickPresetsProps {
 kind: 'diaper' | 'feed';
 babyId: string | undefined;
 /** Fetch only while the parent form is open. */
 isOpen: boolean;
 /** Pass the parent form's loading state through. */
 disabled?: boolean;
 /** Called with the preset's values so the owning form merges them. */
 onApply: (values: Record<string, string | number>) => void;
}



/** Raw enum value → display label (then run through t()). */
type LabelMap = Record<string, string>;

const DIAPER_TYPE_LABELS: LabelMap = {
 WET: 'Wet',
 DIRTY: 'Dirty',
 BOTH: 'Wet and Dirty',
 DRY: 'Dry',
};
const DIAPER_CONDITION_LABELS: LabelMap = {
 NORMAL: 'Normal',
 LOOSE: 'Loose',
 FIRM: 'Firm',
 OTHER: 'Other',
};
const DIAPER_COLOR_LABELS: LabelMap = {
 YELLOW: 'Yellow',
 BROWN: 'Brown',
 GREEN: 'Green',
 BLACK: 'Black',
 RED: 'Red',
 OTHER: 'Other',
};
const FEED_TYPE_LABELS: LabelMap = { BREAST: 'Breast', BOTTLE: 'Bottle' };

/** Display label per kind and field key. Missing key → identity (raw value). */
const LABEL_MAPS: Record<QuickPresetsProps['kind'], Record<string, LabelMap>> = {
 diaper: {
  type: DIAPER_TYPE_LABELS,
  condition: DIAPER_CONDITION_LABELS,
  color: DIAPER_COLOR_LABELS,
 },
 feed: {
  type: FEED_TYPE_LABELS,
  // bottleType is stored as a display string ('Formula', 'Breast Milk', …)
  // so it maps to itself via the missing-key fallback.
 },
};

/** Map null/undefined to undefined so 'null' strings never appear. */
function clean(value: unknown): string | number | undefined {
 return value === null || value === undefined ? undefined : String(value);
}

/** Keep preset.values order; each value is rendered through t() as a label. */
function labelFor(kind: QuickPresetsProps['kind'], key: string, value: string | number, t: (k: string) => string): string {
 const map = LABEL_MAPS[kind][key];
 return t(map?.[String(value)] ?? String(value));
}

function composeLabel(kind: QuickPresetsProps['kind'], preset: QuickPreset, t: (k: string) => string): string {
 return Object.keys(preset.values)
  .map((key) => labelFor(kind, key, preset.values[key], t))
  .join(' · ');
}

/** Reduce raw log rows to the kernel's { time, values } shape, dropping soft-deleted rows. */
function toPresetRecords(
 kind: QuickPresetsProps['kind'],
 data: (DiaperLogResponse | FeedLogResponse)[]
): QuickPresetRecord[] {
 return data
  // Filter soft-deleted rows, and for feeds also legacy SOLIDS logs: the
  // form can no longer create them (solids go through Food), so a SOLIDS
  // chip would pre-fill a mode the form cannot represent.
  .filter(
   (row) =>
    !row.deletedAt &&
    !(kind === 'feed' && (row as FeedLogResponse).type === 'SOLIDS')
  )
  .map((row) => ({
   time: row.time,
   values:
    kind === 'diaper'
     ? {
      type: clean((row as DiaperLogResponse).type),
      condition: clean((row as DiaperLogResponse).condition),
      color: clean((row as DiaperLogResponse).color),
     }
     : {
      type: clean((row as FeedLogResponse).type),
      bottleType: clean((row as FeedLogResponse).bottleType),
     },
  }));
}

export default function QuickPresets({
 kind,
 babyId,
 isOpen,
 disabled = false,
 onApply,
}: QuickPresetsProps) {
 const { t } = useLocalization();
 const [presets, setPresets] = useState<QuickPreset[]>([]);

 useEffect(() => {
  if (!isOpen || !babyId) {
   setPresets([]);
   return;
  }

  let cancelled = false;

  (async () => {
   try {
    const authToken = localStorage.getItem('authToken');
    const now = Date.now();
    const startDate = new Date(now - THIRTY_DAYS_MS).toISOString();
    // +24h: server-side timezone tolerance for the 30-day window.
    const endDate = new Date(now + 24 * 60 * 60 * 1000).toISOString();
    const endpoint =
     kind === 'diaper'
      ? `/api/diaper-log?babyId=${babyId}&startDate=${startDate}&endDate=${endDate}`
      : `/api/feed-log?babyId=${babyId}&startDate=${startDate}&endDate=${endDate}`;

    const response = await fetch(endpoint, {
     headers: {
      'Authorization': authToken ? `Bearer ${authToken}` : '',
     },
    });
    if (!response.ok) throw new Error(`QuickPresets fetch failed (${response.status})`);

    const payload = await response.json();
    if (!payload?.success || !Array.isArray(payload.data)) {
     throw new Error('QuickPresets: unexpected response shape');
    }

    const rows = toPresetRecords(kind, payload.data);
    const built = buildQuickPresets(rows, {
     now: new Date(),
     fields: kind === 'diaper' ? DIAPER_PRESET_FIELDS : FEED_PRESET_FIELDS,
    });
    if (!cancelled) setPresets(built);
   } catch (error) {
    // A broken suggestion strip must never break the form: fail silently.
    console.error('QuickPresets error:', error);
    if (!cancelled) setPresets([]);
   }
  })();

  return () => {
   cancelled = true;
  };
 }, [isOpen, babyId, kind]);

 // No babyId, still loading (no presets yet), disabled, or fetch failed → nothing.
 if (!isOpen || !babyId || disabled || presets.length === 0) return null;

 return (
  <div role="group" aria-label={t('Suggestions')}>
   <p className="text-xs text-gray-500 mb-2">{t('Suggestions')}</p>
   <div className="flex flex-wrap gap-2">
    {presets.map((preset, index) => (
     <Chip
      key={index}
      type="button"
      onClick={() => onApply(preset.values)}
     >
      {composeLabel(kind, preset, t)}
     </Chip>
    ))}
   </div>
  </div>
 );
}
