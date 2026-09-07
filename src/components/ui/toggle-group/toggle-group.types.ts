import * as React from "react";

/**
 * A single selectable option within a {@link ToggleGroup}.
 *
 * @typeParam TValue - String value surfaced to `onChange` when the option is
 * selected; usually a domain enum value (e.g. `'BREAST'`).
 */
export interface ToggleGroupOption<TValue extends string = string> {
 /** Value reported through `onChange` when this option is selected. */
 value: TValue;
 /** Visible label text. Localize at the call site with `t(label)`. */
 label: string;
 /** Optional glyph rendered above/beside the label; the caller controls sizing (lucide icons, `<img>`, …). */
 icon?: React.ReactNode;
}

/**
 * Props for the ToggleGroup component.
 *
 * All other `div` attributes (including `id` and any `aria-*` property such as
 * `aria-labelledby`) are forwarded to the group container.
 *
 * @typeParam TValue - String union of the option values; drives `value`/`onChange` typing.
 */
export interface ToggleGroupProps<TValue extends string>
 extends Omit<React.ComponentPropsWithRef<"div">, "onChange"> {
 /** Exactly the selectable options, in tab/focus order.
  * @example
  * ```tsx
  * const options: ToggleGroupOption<FeedType>[] = [
  *   { value: 'BREAST', label: t('Breast'), icon: <img src="/breastfeed-128.png" alt="" className="w-16 h-16 object-contain" /> },
  *   { value: 'BOTTLE', label: t('Bottle'), icon: <img src="/bottlefeed-128.png" alt="" className="w-16 h-16 object-contain" /> },
  * ];
  * ```
  */
 options: ReadonlyArray<ToggleGroupOption<TValue>>;
 /** Currently selected option value, or `null` to render nothing selected (e.g. a fresh form). */
 value: TValue | null;
 /** Called with the newly selected option's value. Selecting the selected option is a no-op. */
 onChange: (value: TValue) => void;
 /**
  * Visual layout of the option buttons.
  * - `'pill'` (default) — horizontal rounded buttons, equal width; the standard form-field control.
  * - `'circle'` — large round buttons with stacked image/icon (feed-form parity).
  *
  * @default 'pill'
  */
 layout?: "pill" | "circle";
 /** Disables every option in the group. */
 disabled?: boolean;
}
