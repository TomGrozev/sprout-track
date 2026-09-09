# Chip

A small tappable pill button used to pre-fill forms with a recurring combination
of values (quick-select presets, issue #7). It is the interactive sibling of
[`ui/badge`](../badge) — same compact geometry, but a real `<button>` with hover
and focus-visible feedback so it reads as something you can tap.

## Props

Extends `React.ButtonHTMLAttributes<HTMLButtonElement>` plus:

| Prop      | Type                                | Default     | Description                                        |
| --------- | ----------------------------------- | ----------- | -------------------------------------------------- |
| `variant` | `'default' \| 'outline'`            | `'default'` | Teal tint (default) or bordered outline.           |
| `type`    | `React.ButtonHTMLAttributes['type']`| `'button'`  | Defaults to `button` so it never triggers a submit |
| `onClick` | `() => void`                        | —           | Required behavior from the caller.                 |
| `children`| `React.ReactNode`                   | —           | Chip label text.                                   |

All other standard button props (`disabled`, `aria-label`, `className`, …) pass
straight through to the underlying `<button>`.

## Styling

Follows the project's CVA convention:

- `chip.styles.ts` — Tailwind utilities for light mode (rounded-full pill,
  `px-2.5 py-0.5 text-xs font-medium`, hover tint, focus-visible ring,
  `cursor-pointer`, `transition-colors`).
- `chip.css` — dark mode overrides via `html.dark .chip-dark-default` /
  `html.dark .chip-dark-outline`. No Tailwind `dark:` classes.

## Usage

```tsx
import { Chip } from '@/src/components/ui/chip';

<Chip variant="default" onClick={() => apply(preset.values)}>
  {label}
</Chip>
```

## Accessibility

- Renders a semantic `<button>` with `type="button"` by default (safe inside
  `<form>`s).
- Disabled state communicated via `disabled` and reflected with reduced
  opacity; `focus-visible` ring provides keyboard focus indication.
