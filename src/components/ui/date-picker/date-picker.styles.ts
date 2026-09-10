import { cn } from "@/src/lib/utils";

/**
 * DatePicker component styles
 *
 * These styles define the appearance of the DatePicker component
 * and its various sub-components.
 */

// Container styles
export const datePickerContainerStyles = cn(
  "flex gap-2"
);

// Button styles
export const datePickerButtonStyles = cn(
  "flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-md shadow-sm",
  "hover:bg-gray-50 transition-colors duration-200"
);

// Popover content styles
// Popover must layer above the centered dialog content (z-[101]); the
// portal renders as a later sibling of the dialog in the body, so an equal
// exponent loses — this token's extra step wins. See ui/popover/README.md.
export const datePickerPopoverContentStyles = cn(
  "p-0 z-[102] border-gray-200 shadow-lg",
  "rounded-md overflow-hidden"
);

// Calendar container styles
export const datePickerCalendarContainerStyles = cn(
  // "h-[360px] w-[350px]" // Fixed dimensions as required
);

// Footer styles
export const datePickerFooterStyles = cn(
  "flex justify-end p-3 border-t border-gray-200"
);
