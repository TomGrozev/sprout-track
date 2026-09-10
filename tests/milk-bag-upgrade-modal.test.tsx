import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { DatePicker } from '@/src/components/ui/date-picker';
import { datePickerPopoverContentStyles } from '@/src/components/ui/date-picker/date-picker.styles';
import { dateTimePickerContentStyles } from '@/src/components/ui/date-time-picker/date-time-picker.styles';
import { MilkBagUpgradeModal } from '@/src/components/modals/MilkBagUpgradeModal';
import { ThemeProvider } from '@/src/context/theme';
import { TimezoneProvider } from '@/app/context/timezone';
import { ToastProvider } from '@/src/components/ui/toast/toast-provider';

// Mock localization to identity: user-facing labels pass through verbatim, so
// 'Date and time' / 'Date' / 'Select month' / 'Select year' are asserted as-is
// and no language-preference fetch is ever issued (deterministic).
vi.mock('@/src/context/localization', () => ({
  LocalizationProvider: ({ children }: { children: React.ReactNode }) => children,
  useLocalization: () => ({
    language: 'en',
    isLoading: false,
    setLanguage: async () => { },
    t: (s: string) => s,
  }),
}));

// Radix popper needs ResizeObserver for positioning; jsdom does not ship one.
class ResizeObserverStub {
  observe() { }
  unobserve() { }
  disconnect() { }
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <TimezoneProvider>
        <ToastProvider>{children}</ToastProvider>
      </TimezoneProvider>
    </ThemeProvider>
  );
}

function ProvidersWithModal({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}

/** Find the single popover trigger (Radix PopoverTrigger sets aria-haspopup="dialog"). */
function findDateTrigger() {
  const trigger = screen
    .getAllByRole('button')
    .find((b) => b.getAttribute('aria-haspopup') === 'dialog');
  if (!trigger) throw new Error('DatePicker popover trigger not found');
  return trigger;
}

/** Open the DatePicker calendar popover and wait for it to render. */
async function openDatePopover() {
  fireEvent.click(findDateTrigger());
  await waitFor(() => {
    if (!screen.queryByRole('button', { name: 'Select month' })) throw new Error('calendar not open');
  });
}

// Months rendered by the calendar header are always English (hard-coded
// toLocaleDateString('en-US')), regardless of app localization.
const MONTH_INDEX: Record<string, number> = {
  January: 0,
  February: 1,
  March: 2,
  April: 3,
  May: 4,
  June: 5,
  July: 6,
  August: 7,
  September: 8,
  October: 9,
  November: 10,
  December: 11,
};

/** Click day `day` of the currently-displayed calendar and report the clicked midnight date. */
function clickCalendarDay(day: number): Date {
  const monthName = screen.getByRole('button', { name: 'Select month' }).textContent ?? '';
  const yearText = screen.getByRole('button', { name: 'Select year' }).textContent ?? '';
  const year = parseInt(yearText, 10);
  const month = MONTH_INDEX[monthName];
  if (Number.isNaN(year) || month === undefined) {
    throw new Error(`could not resolve calendar month/year: "${monthName}" "${yearText}"`);
  }
  const cells = screen.getAllByText(String(day));
  if (!cells.length) throw new Error(`day cell "${day}" not found`);
  fireEvent.click(cells[0]);
  return new Date(year, month, day, 0, 0, 0, 0);
}

describe('DatePicker (issue: bagged-at is a date only)', () => {
  it('renders the full date for a fixed valid value with no Invalid Date text', () => {
    render(
      <Providers>
        <DatePicker value={new Date(2026, 8, 10)} onChange={() => { }} />
      </Providers>
    );

    const button = screen.getByRole('button');
    expect(button.textContent).toBeTruthy();
    expect(button.textContent).toContain('2026');
    expect(button.textContent).not.toBe('Invalid Date');
    expect(screen.queryByText(/invalid date/i)).toBeNull();
  });

  it('renders exactly one button (the date trigger; the time trigger is gone)', () => {
    render(
      <Providers>
        <DatePicker value={new Date(2026, 8, 10)} onChange={() => { }} />
      </Providers>
    );

    expect(screen.getAllByRole('button').length).toBe(1);
  });

  it('neutralizes a stale 14:30 pre-pick time to midnight when a same day is picked', async () => {
    const onChange = vi.fn();
    render(
      <Providers>
        <DatePicker value={new Date(2026, 8, 10, 14, 30, 0, 0)} onChange={onChange} />
      </Providers>
    );

    await openDatePopover();
    fireEvent.click(screen.getAllByText('10')[0]);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const firstArg = onChange.mock.calls[0][0];
    if (!(firstArg instanceof Date)) throw new Error('onChange did not receive a Date');
    const picked = firstArg;
    expect(picked.getFullYear()).toBe(2026);
    expect(picked.getMonth()).toBe(8);
    expect(picked.getDate()).toBe(10);
    expect(picked.getHours()).toBe(0);
    expect(picked.getMinutes()).toBe(0);
    expect(picked.getSeconds()).toBe(0);
    expect(picked.getMilliseconds()).toBe(0);
  });
});

describe('popover-above-modal z-index drift guard', () => {
  it('both popover container tokens carry z-[102] (over the z-[101] dialog)', () => {
    // House convention places z-[…] first in the token string (matches the
    // original z-[100] position this token replaced); assert presence, not
    // position. The full literal (both brackets) can't be satisfied by
    // z-[10], z-[100], z-[1022] etc., which is what the guard needs.
    expect(datePickerPopoverContentStyles).toMatch(/\bz-\[102\]/);
    expect(dateTimePickerContentStyles).toMatch(/\bz-\[102\]/);
  });
});

describe('MilkBagUpgradeModal convert-to-bags serialization', () => {
  it('labels the bag date as Date (not Date and time) and serializes midnight to end-of-day', async () => {
    // Track the POST body sent to /api/milk-bags/upgrade.
    let upgradeBody: { bags: Array<{ baggedAt: string }> } | null = null;

    const json = (payload: unknown, ok = true) => ({
      ok,
      status: ok ? 200 : 400,
      json: async () => payload,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
        const u = String(url);
        if (u.includes('/api/milk-bags/upgrade')) {
          upgradeBody = JSON.parse(init?.body ?? '{}');
          return json({ success: true, data: {} });
        }
        if (u.includes('/api/breast-milk-balance')) {
          // Balance equal to the bagged amount: no leftover-confirm, not exceeding.
          return json({ success: true, data: { balance: 100 } });
        }
        if (u.includes('/api/settings')) {
          if (init?.method === 'PUT') return json({ success: true, data: {} });
          return json({ success: true, data: { milkBagSettings: null } });
        }
        return json({ success: true, data: {} });
      })
    );

    render(
      <ProvidersWithModal>
        <MilkBagUpgradeModal open onClose={vi.fn()} babyId="baby-1" onUpgraded={vi.fn()} />
      </ProvidersWithModal>
    );

    // Choice screen -> convert screen; the balance fetch resolves to 100 ml.
    fireEvent.click(screen.getByRole('button', { name: /Convert to bags/ }));
    await waitFor(() => {
      if (screen.queryByText('Loading…')) throw new Error('balance still loading');
    });

    // Regression marker for the old UI: the bag-date label is now just "Date".
    expect(screen.queryByText(/date and time/i)).toBeNull();
    expect(screen.getAllByText('Date').length).toBeGreaterThan(0);

    // Enter the bag amount (matches the balance so leftover = 0).
    const amountInput = screen.getByPlaceholderText('0');
    fireEvent.change(amountInput, { target: { value: '100' } });

    // Pick the 15th of the displayed month via the DatePicker calendar.
    await openDatePopover();
    const clickedMidnight = clickCalendarDay(15);

    // Convert -> POST /api/milk-bags/upgrade should serialize midnight to end-of-day.
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));

    await waitFor(() => {
      expect(upgradeBody).not.toBeNull();
    });

    const expectedEndOfDay = new Date(
      clickedMidnight.getFullYear(),
      clickedMidnight.getMonth(),
      clickedMidnight.getDate(),
      23,
      59,
      59,
      999
    ).toISOString();

    expect(upgradeBody!.bags[0].baggedAt).toBe(expectedEndOfDay);
    // End-of-day is a LOCAL time; toISOString is UTC, so assert the parsed
    // local components rather than a literal (offset-fragile) string suffix.
    const serialized = new Date(upgradeBody!.bags[0].baggedAt);
    expect(serialized.getHours()).toBe(23);
    expect(serialized.getMinutes()).toBe(59);
    expect(serialized.getSeconds()).toBe(59);
    expect(serialized.getMilliseconds()).toBe(999);
  });
});
