import { cva } from "class-variance-authority";

/**
 * Chip variant styles using class-variance-authority.
 *
 * Interactive sibling of the Badge primitive: same compact pill geometry
 * (rounded-full, px-2.5/py-0.5, text-xs) but rendered as a button with hover
 * and focus-visible feedback so it reads as tappable. Light mode uses
 * Tailwind utilities here; dark mode overrides live in chip.css under
 * `html.dark .chip-dark-*`.
 */
export const chipVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer select-none border border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 disabled:cursor-default disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-teal-100 text-teal-800 hover:bg-teal-200",
        outline:
          "border-gray-200 text-gray-700 hover:bg-gray-100",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);
