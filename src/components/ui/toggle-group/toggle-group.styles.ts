import { cva, type VariantProps } from "class-variance-authority";

/**
 * ToggleGroup light-mode styles (CVA).
 *
 * Dark mode is intentionally NOT expressed here — it lives in
 * `toggle-group.css` as `html.dark` overrides (see CLAUDE.md styling rules),
 * keyed off the `toggle-dark-*` classes emitted in `index.tsx`.
 */
export const toggleGroupVariants = cva("flex justify-center items-center mt-2", {
 variants: {
  layout: {
   pill: "w-full gap-2",
   circle: "gap-20",
  },
 },
 defaultVariants: {
  layout: "pill",
 },
});

export const toggleOptionVariants = cva(
 [
  "relative",
  "transition-all",
  "disabled:pointer-events-none disabled:opacity-50",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-teal-400",
 ],
 {
  variants: {
   layout: {
    pill: "flex-1 min-w-0 flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium",
    circle: "flex flex-col items-center justify-center p-2 rounded-full w-24 h-24",
   },
   state: {
    selected: "bg-blue-100 ring-2 ring-blue-500 shadow-md toggle-dark-selected",
    unselected: "bg-gray-50 hover:bg-gray-100 toggle-dark-unselected",
   },
  },
  defaultVariants: {
   layout: "pill",
   state: "unselected",
  },
 }
);

export type ToggleGroupVariants = VariantProps<typeof toggleGroupVariants>;
export type ToggleOptionVariants = VariantProps<typeof toggleOptionVariants>;
