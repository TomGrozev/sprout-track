# QuickPresets

Quick-select preset chips for activity forms (issue #7). Fetches a baby's
recent logs and renders tappable pills for the most frequent value
combinations, so a recurring diaper/feed type can be pre-filled in one tap.

The **pure ranking kernel** lives in `src/utils/quickPreset.ts`
(`buildQuickPresets` + `DIAPER_PRESET_FIELDS` / `FEED_PRESET_FIELDS`) and is
tested separately. This component is only the data plumbing: fetch → filter
soft-deletes → map rows → build → render chips.

## Props

| Prop       | Type                                | Description                                                              |
| ---------- | ----------------------------------- | ------------------------------------------------------------------------ |
| `kind`     | `'diaper' \| 'feed'`                | Selects the endpoint and field map.                                      |
| `babyId`   | `string \| undefined`               | Baby to fetch logs for; `undefined` renders nothing.                     |
| `isOpen`   | `boolean`                           | Fetch runs only while the parent form is open.                           |
| `disabled` | `boolean \| undefined`              | Passthrough of the parent form's loading/submit state → renders nothing. |
| `onApply`  | `(values) => void`                  | Called with the preset's `Record<string, string \| number>` values.      |

## Behavior

- **Fetch**: `useEffect` gated on `isOpen && babyId`; Bearer token from
  `localStorage['authToken']`; 30-day window against "now" with a +24h end-date
  tolerance. Endpoints: `/api/diaper-log?babyId=…&startDate=…&endDate=…` and
  `/api/feed-log?babyId=…&startDate=…&endDate=…`, both returning `{ success, data }`.
- **Soft-deletes**: list responses may include soft-deleted rows — rows with a
  truthy `deletedAt` are excluded before ranking.
- **Row mapping**:
  - Diaper: `{ time, values: { type, condition, color } }` — `null`/`undefined`
    map to `undefined`, never the string `'null'`.
  - Feed: `{ time, values: { type, bottleType } }` — side is deliberately
    excluded (a new breast entry is dispatched from the side timers/manual
    inputs, not `formData.side`), amounts/units are excluded to avoid
    fragmenting patterns, and legacy SOLIDS rows are filtered out because
    the form can no longer create that mode (solids go through Food).
- **Ranking**: `buildQuickPresets(rows, { now, fields })` with default options
  (top 3, min 2 occurrences).
- **Chip labels**: preset values joined with ` · ` in field order, each rendered
  through `t()`. Raw enum values are mapped to display labels first (e.g.
  diaper `BOTH` → `t('Wet and Dirty')`); feed `bottleType` is already a display
  string and passes through.
- **Click** → `onApply(preset.values)`. The owning form owns the state merge.
- **Rendering `null`** when: no `babyId`, fetch failed, still loading, or zero
  presets. Failures are silent (`console.error`) — a broken suggestion strip
  never breaks the form.

## Usage

```tsx
<QuickPresets
  kind="diaper"
  babyId={babyId}
  isOpen={isOpen}
  disabled={loading}
  onApply={(values) => setFormData((prev) => ({ ...prev, ...values }))}
/>
```

## Accessibility

- The chip group is wrapped in `<div role="group" aria-label={t('Suggestions')}>`.
- Every chip is `<Chip type="button">` so it never triggers a form submit.
