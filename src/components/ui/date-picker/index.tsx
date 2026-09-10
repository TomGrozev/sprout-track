'use client';

import { useState, useEffect } from 'react';
import './date-picker.css';
import { Calendar } from '@/src/components/ui/calendar';
import { cn } from '@/src/lib/utils';
import { isValid } from 'date-fns';
import { useTimezone } from '@/app/context/timezone';
import { formatDateLong } from '@/src/utils/dateFormat';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/src/components/ui/popover';
import { useLocalization } from '@/src/context/localization';

// Import types and styles
import { DatePickerProps } from './date-picker.types';
import {
  datePickerContainerStyles,
  datePickerButtonStyles,
  datePickerPopoverContentStyles,
  datePickerCalendarContainerStyles,
} from './date-picker.styles';

/**
 * DatePicker Component
 *
 * A date-only component that combines the Calendar for date selection,
 * using a single button with a popover.
 *
 * Features:
 * - One button for date selection
 * - Calendar component for date selection in a popover
 * - Selected date is normalized to midnight (00:00 local time)
 * - Bottom-aware positioning with margin
 */
export function DatePicker({
  value,
  onChange,
  className,
  disabled = false,
  placeholder = "Select date...",
}: DatePickerProps) {
  const { dateFormat } = useTimezone();
  const { t } = useLocalization();

  // Allow for null date value
  const [date, setDate] = useState<Date | null>(() => {
    // Check if value is a valid Date
    if (value instanceof Date && isValid(value)) {
      return value;
    }
    // Return null if value is null
    if (value === null) {
      return null;
    }
    // Fallback to current date for invalid dates
    return new Date();
  });

  // State for popover
  const [dateOpen, setDateOpen] = useState(false);

  // Update the date when the value prop changes
  useEffect(() => {
    if (value === null) {
      setDate(null);
    } else if (value instanceof Date && isValid(value)) {
      setDate(value);
    }
  }, [value]);

  // Handle date selection from Calendar
  const handleDateSelect = (newDate: Date | undefined) => {
    if (!newDate) return;

    // Normalize to midnight (local time) — the picker is date-only.
    const updatedDate = new Date(newDate);
    updatedDate.setHours(0, 0, 0, 0);

    setDate(updatedDate);
    onChange(updatedDate);

    // Close the date popover when a date is selected
    setDateOpen(false);
  };

  // Format the date for display
  const formatDate = (date: Date | null): string => {
    if (!date || !isValid(date)) return t('Select date');
    try {
      return formatDateLong(date, dateFormat);
    } catch (error) {
      console.error('Error formatting date:', error);
      return t('Select date');
    }
  };

  return (
    <div className={cn(datePickerContainerStyles, "date-picker-container", className)}>
      {/* Date Button with Popover */}
      <Popover open={dateOpen} onOpenChange={setDateOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(datePickerButtonStyles, "date-picker-button")}
            disabled={disabled}
            aria-label={t('Select date')}
          >
            <CalendarIcon className="h-4 w-4 date-picker-calendar-icon" aria-hidden="true" />
            <span>{formatDate(date)}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className={cn(datePickerPopoverContentStyles, "date-picker-popover")}
          align="start"
          sideOffset={4}
        >
          <div className={datePickerCalendarContainerStyles}>
            <Calendar
              selected={date}
              onSelect={handleDateSelect}
              isDateDisabled={disabled ? () => true : undefined}
              initialFocus
              variant="date-time-picker"
              className="mx-auto"
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default DatePicker;
