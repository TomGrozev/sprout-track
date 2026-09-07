import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { toggleGroupVariants, toggleOptionVariants } from "./toggle-group.styles";
import { ToggleGroupOption, ToggleGroupProps } from "./toggle-group.types";
import "./toggle-group.css";

/**
 * ToggleGroup component for selecting exactly one option from a small, fixed
 * set (2–3 options).
 *
 * Exposes a radio group: each option is `role="radio"` with `aria-checked`,
 * the selected option is the only tab stop, and ArrowLeft/ArrowUp /
 * ArrowRight/ArrowDown move selection with wrap-around, so keyboard and
 * screen reader users get standard radio behavior.
 *
 * Single-select only — selecting an already-selected option is a no-op and
 * there is no unselect. Render with `value={null}` when no choice has been
 * made yet (e.g. a fresh form).
 *
 * @example
 * ```tsx
 * <ToggleGroup
 *   aria-label={t('Type')}
 *   layout="circle"
 *   options={feedTypeOptions}
 *   value={formData.type === '' ? null : formData.type}
 *   onChange={(type) => setFormData({ ...formData, type })}
 *   disabled={loading}
 * />
 * ```
 */
export function ToggleGroup<TValue extends string>({
 options,
 value,
 onChange,
 layout = "pill",
 disabled = false,
 className,
 ...props
}: ToggleGroupProps<TValue>) {
 const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
  if (disabled || options.length === 0) return;

  const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
  const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
  if (!backward && !forward) return;

  const delta = backward ? -1 : 1;
  const currentIndex = options.findIndex((o) => o.value === value);
  const nextIndex =
   currentIndex === -1
    ? delta === 1
     ? 0
     : options.length - 1
    : (currentIndex + delta + options.length) % options.length;

  event.preventDefault();
  const option = options[nextIndex];
  if (option.value !== value) {
   onChange(option.value);
  }
  const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='radio']");
  buttons[nextIndex]?.focus();
 };

 const selectedIndex = options.findIndex((o) => o.value === value);

 return (
  <div
   role="radiogroup"
   aria-orientation="horizontal"
   onKeyDown={handleKeyDown}
   className={cn(toggleGroupVariants({ layout }), className)}
   {...props}
  >
   {options.map((option: ToggleGroupOption<TValue>, index: number) => {
    const isSelected = index === selectedIndex;
    const isTabStop = isSelected || (selectedIndex === -1 && index === 0);
    return (
     <button
      key={option.value}
      type="button"
      role="radio"
      aria-checked={isSelected}
      tabIndex={isTabStop && !disabled ? 0 : -1}
      disabled={disabled}
      onClick={() => {
       if (option.value !== value) {
        onChange(option.value);
       }
      }}
      className={cn(toggleOptionVariants({ layout, state: isSelected ? "selected" : "unselected" }))}
     >
      {option.icon != null && <span className="flex items-center justify-center">{option.icon}</span>}
      {layout === "circle" ? (
       <span className="text-xs font-medium mt-1">{option.label}</span>
      ) : (
       option.label
      )}
      {isSelected && (
       <div className="absolute -top-1 -right-1 bg-blue-500 rounded-full p-1" aria-hidden="true">
        <Check className="h-3 w-3 text-white" />
       </div>
      )}
     </button>
    );
   })}
  </div>
 );
}

export type { ToggleGroupOption, ToggleGroupProps };
