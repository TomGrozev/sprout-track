import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { DateTimePicker } from '@/src/components/ui/date-time-picker';
import { TimeEntry } from '@/src/components/ui/time-entry';
import { LocalizationProvider } from '@/src/context/localization';
import { ThemeProvider } from '@/src/context/theme';
import { TimezoneProvider } from '@/app/context/timezone';

// Radix popper needs ResizeObserver for positioning; jsdom does not ship one.
class ResizeObserverStub {
 observe() { }
 unobserve() { }
 disconnect() { }
}
if (typeof globalThis.ResizeObserver === 'undefined') {
 (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}

function Providers({ children }: { children: React.ReactNode }) {
 return (
  <ThemeProvider>
   <LocalizationProvider>
    <TimezoneProvider>{children}</TimezoneProvider>
   </LocalizationProvider>
  </ThemeProvider>
 );
}

// Fixed 09:30 so the hour input value is "09" (2 chars).
const NINE_THIRTY = new Date(2026, 8, 8, 9, 30, 0, 0);

function renderPicker() {
 const utils = render(
  <Providers>
   <DateTimePicker value={NINE_THIRTY} onChange={() => { }} />
  </Providers>
 );
 const dialogButtons = utils.container.querySelectorAll<HTMLButtonElement>(
  'button[aria-haspopup="dialog"]'
 );
 const timeTrigger = dialogButtons[1];
 if (!timeTrigger) throw new Error('time trigger not found');
 return { timeTrigger };
}

function findHourInput() {
 return screen.queryByRole('spinbutton', { name: 'Hours' }) as HTMLInputElement | null;
}

function isFocused(el: HTMLElement | null) {
 return el !== null && document.activeElement === el;
}

async function openTimePopover(timeTrigger: HTMLButtonElement, pointerType?: string) {
 if (pointerType) {
  fireEvent.pointerDown(timeTrigger, { pointerType });
 }
 fireEvent.click(timeTrigger);
 await waitFor(() => {
  if (!findHourInput()) throw new Error('popover not open yet');
 });
}

/**
  * Issue #2 - touch-friendly time entry.
  *
  * TimeEntry (hour/minute spinbuttons) lives inside DateTimePicker's time popover.
  * On open, Radix FocusScope auto-focuses the first tabbable element (the hour
  * input) and selects its text - that programmatic focus is what pops the mobile
  * soft keyboard. Touch opens must not program-focus the input; keyboard/mouse
  * opens keep the current behavior.
  */
describe('DateTimePicker time popover open focus (issue #2)', () => {
 it('keyboard-style open keeps focusing and selecting the hour input', async () => {
  const { timeTrigger } = renderPicker();

  await openTimePopover(timeTrigger);

  const hour = findHourInput();
  expect(isFocused(hour)).toBe(true);
  expect(hour?.selectionStart).toBe(0);
  expect(hour?.selectionEnd).toBe(hour?.value.length);
 });

 it('touch open does not focus the hour input (no soft keyboard)', async () => {
  const { timeTrigger } = renderPicker();

  await openTimePopover(timeTrigger, 'touch');

  const hour = findHourInput();
  expect(isFocused(hour)).toBe(false);
  expect(hour?.selectionStart).toBe(hour?.selectionEnd);
 });

 it('pen open skips the open-autofocus like touch (covered branch)', async () => {
  const { timeTrigger } = renderPicker();

  await openTimePopover(timeTrigger, 'pen');

  const hour = findHourInput();
  expect(isFocused(hour)).toBe(false);
  expect(hour?.selectionStart).toBe(hour?.selectionEnd);
 });

 it('keyboard open after a touch open re-enables open-autofocus', async () => {
  const { timeTrigger } = renderPicker();

  await openTimePopover(timeTrigger, 'touch');
  fireEvent.keyDown(timeTrigger, { key: 'Escape' });
  await waitFor(() => {
   if (findHourInput()) throw new Error('popover still open');
  });

  await openTimePopover(timeTrigger);

  const hour = findHourInput();
  expect(isFocused(hour)).toBe(true);
  expect(hour?.selectionStart).toBe(0);
  expect(hour?.selectionEnd).toBe(hour?.value.length);
 });
});

/**
  * TimeEntry seam (the control itself): the existing pointer-vs-keyboard gating
  * means select-all fires on keyboard focus and never on pointer focus. The
  * shared control must not regress while the popover-open path changes.
  */
describe('TimeEntry spinbutton focus behavior (issue #2 seam)', () => {
 function renderTimeEntry() {
  render(
   <Providers>
    <TimeEntry value={NINE_THIRTY} onChange={() => { }} />
   </Providers>
  );
 }

 it('deliberate pointer tap into the hour field never select-alls (mouse or touch)', () => {
  renderTimeEntry();

  for (const pointerType of ['mouse', 'touch']) {
   const hour = screen.getByRole('spinbutton', { name: 'Hours' }) as HTMLInputElement;
   fireEvent.pointerDown(hour, { pointerType });
   fireEvent.focus(hour);
   expect(hour.selectionStart).toBe(hour.selectionEnd);
   fireEvent.blur(hour);
  }
 });

 it('keyboard focus on the hour field still select-alls', () => {
  renderTimeEntry();

  const hour = screen.getByRole('spinbutton', { name: 'Hours' }) as HTMLInputElement;
  fireEvent.focus(hour);
  expect(hour.selectionStart).toBe(0);
  expect(hour.selectionEnd).toBe(hour.value.length);
 });
});
