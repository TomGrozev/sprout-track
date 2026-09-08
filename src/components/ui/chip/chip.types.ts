import { VariantProps } from "class-variance-authority";
import { chipVariants } from "./chip.styles";

/**
 * Props for the Chip component: a small tappable pill button.
 * Extends the native button element so all standard button attributes
 * (aria-label, disabled, onClick, etc.) pass straight through.
 */
export interface ChipProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof chipVariants> {}
