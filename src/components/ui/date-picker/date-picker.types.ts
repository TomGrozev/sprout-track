/**
 * Props for the DatePicker component
 */
export interface DatePickerProps {
  /**
   * The currently selected date (date-only)
   */
  value: Date | null;

  /**
   * Callback function when date changes
   */
  onChange: (date: Date) => void;

  /**
   * Optional class name for additional styling
   */
  className?: string;

  /**
   * Whether the component is disabled
   */
  disabled?: boolean;

  /**
   * Optional placeholder text for the input
   */
  placeholder?: string;
}
