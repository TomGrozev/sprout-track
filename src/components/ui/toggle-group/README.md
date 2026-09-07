# ToggleGroup Component

A single-select toggle group for choosing exactly one option from a small, fixed
set (2–3 options) — the standard control for choices like Breast/Bottle,
Nap/Night, or Day/Night milk.

## Features

- Radio-group semantics: `role="radiogroup"` + `role="radio"` with `aria-checked`, one tab stop, arrow-key selection with wrap-around
- Supports an initially unselected state (`value={null}`, e.g. a fresh form)
- Optional icon per option (lucide components, `<img>`, any `ReactNode`)
- Two layouts: `pill` (the default form-field control) and `circle` (image-led, feed-form parity)
- Selecting the already-selected option is a no-op; there is no unselect
- CVA light-mode styles; dark mode via `html.dark` overrides in `toggle-group.css`

## Props

All standard `div` attributes (including `id`, `aria-labelledby`, …) are
forwarded to the group container.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `options` | `ToggleGroupOption<TValue>[]` | required | Selectable options in tab/focus order: `{ value, label, icon? }` |
| `value` | `TValue \| null` | required | Currently selected option value; `null` renders nothing selected |
| `onChange` | `(value: TValue) => void` | required | Called with the newly selected option's value |
| `layout` | `'pill' \| 'circle'` | `'pill'` | `pill` = horizontal equal-width buttons; `circle` = large round buttons (feed-form style) |
| `disabled` | `boolean` | `false` | Disables every option in the group |
| `className` | `string` | `undefined` | Extra classes for the group container |

## Usage Examples

### Standard form field (pill)

```tsx
import { ToggleGroup } from "@/src/components/ui/toggle-group";
import { Moon, Sun } from "lucide-react";

<ToggleGroup
  aria-label={t('Milk time')}
  options={[
    { value: 'DAY', label: t('Day'), icon: <Sun className="h-4 w-4" /> },
    { value: 'NIGHT', label: t('Night'), icon: <Moon className="h-4 w-4" /> },
  ]}
  value={milkTime}
  onChange={setMilkTime}
/>
```

### Image-led circle layout (feed form)

```tsx
<ToggleGroup
  aria-labelledby={`${formId}-type-label`}
  layout="circle"
  options={[
    {
      value: 'BREAST',
      label: t('Breast'),
      icon: <img src="/breastfeed-128.png" alt="" className="w-16 h-16 object-contain" />,
    },
    {
      value: 'BOTTLE',
      label: t('Bottle'),
      icon: <img src="/bottlefeed-128.png" alt="" className="w-16 h-16 object-contain" />,
    },
  ]}
  value={formData.type === '' ? null : formData.type}
  onChange={(type) => setFormData({ ...formData, type })}
  disabled={loading}
/>
```

Notes on the circle example:

- The label element above the group carries the accessible name via
  `aria-labelledby`; option labels are visible text.
- `icon` `<img>`s are decorative (`alt=""`) — the visible label carries the
  meaning and screen readers announce one coherent name per radio.

## Accessibility

- The group is `role="radiogroup"`; name it with either `aria-label` or
  `aria-labelledby` pointing at the field label.
- Each option is `role="radio"` with `aria-checked`; exactly one option (the
  selected one, otherwise the first) is a tab stop.
- ArrowLeft/ArrowUp/ArrowRight/ArrowDown move selection with wrap-around and
  move focus — standard radio keyboard behavior.
- Localize all labels at the call site with `t()`; never hardcode strings.

## Implementation Details

- React function component; generic over the option `value` union so
  `value`/`onChange` are tightly typed (e.g. `FeedType`).
- Styling: `toggle-group.styles.ts` (CVA) for light mode + Tailwind utilities;
  `toggle-group.css` provides `html.dark` overrides keyed on the
  `toggle-dark-selected` / `toggle-dark-unselected` classes (the repo-wide
  dark-mode convention — no Tailwind `dark:` classes).
- Keyboard handling uses a `keydown` handler on the group container; focus is
  moved to the newly selected option's button.

## Testing

`tests/toggle-group.test.tsx` exercises the public seam (`value` / `onChange` /
group semantics) with @testing-library/react in the jsdom vitest project:
render, click options, assert callback + `aria-checked` state, arrow-key
navigation and wrap-around, icon containment, and disabled behavior.
