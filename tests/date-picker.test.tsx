import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DatePicker } from '@/src/components/ui/date-picker';
import { LocalizationProvider } from '@/src/context/localization';
import { ThemeProvider } from '@/src/context/theme';
import { TimezoneProvider } from '@/app/context/timezone';

// Smoke-proofs the DatePicker (issue: date-only picker in the Sprout
// "Convert to bags" modal) against the rename/mechanical-copy regressions:
// the time popover is gone by construction, so exactly one button renders.
describe('DatePicker', () => {
  const renderPicker = (value: Date | null) =>
    render(
      <ThemeProvider>
        <LocalizationProvider>
          <TimezoneProvider>
            <DatePicker value={value} onChange={() => {}} />
          </TimezoneProvider>
        </LocalizationProvider>
      </ThemeProvider>
    );

  it('renders the full date string with no "Invalid Date"', () => {
    // Fixed date; formatDateLong renders "Apr 6, 2026" under the default
    // MM/DD/YYYY family date format.
    renderPicker(new Date(2026, 3, 6, 14, 30));

    expect(screen.queryByText(/Invalid Date/i)).toBeNull();
    expect(screen.getByText('Apr 6, 2026')).toBeTruthy();
  });

  it('renders exactly one button (time popover trigger is gone)', () => {
    renderPicker(new Date(2026, 3, 6, 14, 30));
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('accepts a null value without crashing', () => {
    renderPicker(null);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
