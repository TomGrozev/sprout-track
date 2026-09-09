import * as React from "react";
import { cn } from "@/src/lib/utils";
import { chipVariants } from "./chip.styles";
import { ChipProps } from "./chip.types";
import "./chip.css";

/**
 * Chip component for tappable quick-select pills (issue #7).
 *
 * A small interactive pill button used to pre-fill a form with a recurring
 * combination of values. Built on the button element so it works inside
 * forms; defaults to `type="button"` so it never triggers a submit. Needs an
 * `onClick` from the caller — the chip is intentionally presentational.
 *
 * @example
 * ```tsx
 * <Chip variant="default" onClick={() => apply(preset.values)}>
 *   Wet and Dirty · Yellow
 * </Chip>
 * ```
 */
const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
  ({ className, variant, type = "button", ...props }, ref) => {
    const darkModeClass =
      variant === "outline" ? "chip-dark-outline" : "chip-dark-default";

    return (
      <button
        ref={ref}
        type={type}
        className={cn(chipVariants({ variant }), className, darkModeClass)}
        {...props}
      />
    );
  }
);

Chip.displayName = "Chip";

export { Chip, chipVariants };
