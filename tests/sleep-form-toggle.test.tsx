import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SleepForm from '@/src/components/forms/SleepForm';
import { LocalizationProvider } from '@/src/context/localization';
import { ThemeProvider } from '@/src/context/theme';
import { TimezoneProvider } from '@/app/context/timezone';
import { ToastProvider } from '@/src/components/ui/toast/toast-provider';
import { SleepLogResponse } from '@/app/api/types';

// Issue #3: the sleep-type dropdown becomes the shared two-button ToggleGroup
// (Nap = sun glyph, Night Sleep = moon glyph), mirroring the feeding toggle.
// Seam: the form's type selection -> rendered selection -> submitted payload,
// including the in-progress disable rule and edit-mode reflection.
describe('SleepForm sleep-type ToggleGroup (issue #3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
    isSleeping: false,
    onSleepToggle: vi.fn(),
    babyId: 'baby-1',
    initialTime: new Date().toISOString(),
  };

  const renderForm = (props: Partial<React.ComponentProps<typeof SleepForm>> = {}) =>
    render(
      <ThemeProvider>
        <LocalizationProvider>
          <TimezoneProvider>
            <ToastProvider>
              <SleepForm {...baseProps} {...props} />
            </ToastProvider>
          </TimezoneProvider>
        </LocalizationProvider>
      </ThemeProvider>
    );

  const editActivity = (): SleepLogResponse =>
    ({
      id: 'sleep-1',
      babyId: 'baby-1',
      startTime: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      endTime: new Date().toISOString(),
      duration: 180,
      type: 'NIGHT_SLEEP',
      location: 'Crib',
      quality: 'GOOD',
      notes: null,
      caretakerId: null,
      familyId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    }) as unknown as SleepLogResponse;

  it('renders a named Nap / Night Sleep group with a sun and moon glyph, NAP preselected on a fresh form', () => {
    renderForm();

    const group = screen.getByRole('radiogroup', { name: 'Type' });
    expect(group).toBeTruthy();

    const nap = screen.getByRole('radio', { name: 'Nap' });
    const night = screen.getByRole('radio', { name: 'Night Sleep' });

    // Fresh form default: NAP (unchanged from the select's initialization)
    expect(nap.getAttribute('aria-checked')).toBe('true');
    expect(night.getAttribute('aria-checked')).toBe('false');

    // Sun for nap, moon for night sleep, each inside its own option
    expect(nap.querySelector('svg.lucide-sun')).toBeTruthy();
    expect(nap.querySelector('svg.lucide-moon')).toBeNull();
    expect(night.querySelector('svg.lucide-moon')).toBeTruthy();
    expect(night.querySelector('svg.lucide-sun')).toBeNull();

    // No native select remains for the sleep type
    expect(screen.queryByRole('combobox', { name: 'Type' })).toBeNull();
  });

  it('switches the selected type when an option is clicked', () => {
    renderForm();

    fireEvent.click(screen.getByRole('radio', { name: 'Night Sleep' }));
    expect(screen.getByRole('radio', { name: 'Night Sleep' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Nap' }).getAttribute('aria-checked')).toBe('false');

    fireEvent.click(screen.getByRole('radio', { name: 'Nap' }));
    expect(screen.getByRole('radio', { name: 'Nap' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Night Sleep' }).getAttribute('aria-checked')).toBe('false');
  });

  it('reflects and changes the stored type when editing an existing sleep', () => {
    renderForm({ activity: editActivity() });

    // Edit mode shows the stored type selected
    const night = screen.getByRole('radio', { name: 'Night Sleep' });
    expect(night.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Nap' }).getAttribute('aria-checked')).toBe('false');

    // And the edit can change it
    fireEvent.click(screen.getByRole('radio', { name: 'Nap' }));
    expect(screen.getByRole('radio', { name: 'Nap' }).getAttribute('aria-checked')).toBe('true');
    expect(night.getAttribute('aria-checked')).toBe('false');
  });

  it('reflects the in-progress sleep as a read-only selection when ending it', async () => {
    const inProgressSleep = {
      id: 'sleep-1',
      babyId: 'baby-1',
      startTime: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
      endTime: null,
      duration: null,
      type: 'NIGHT_SLEEP',
      location: 'Crib',
      quality: null,
      notes: null,
      caretakerId: null,
      familyId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: [inProgressSleep] }),
      }))
    );

    renderForm({ isSleeping: true });

    // The stored type is reflected...
    const night = await screen.findByRole('radio', { name: 'Night Sleep' });
    await waitFor(() => expect(night.getAttribute('aria-checked')).toBe('true'));

    // ...but read-only: mid-sleep the type cannot change
    expect(night.hasAttribute('disabled')).toBe(true);
    const nap = screen.getByRole('radio', { name: 'Nap' });
    expect(nap.hasAttribute('disabled')).toBe(true);

    fireEvent.click(nap);
    expect(night.getAttribute('aria-checked')).toBe('true');
    expect(nap.getAttribute('aria-checked')).toBe('false');
  });

  it('submits the type chosen through the toggle', async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: { body?: string }) => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: {} }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    renderForm();

    fireEvent.click(screen.getByRole('radio', { name: 'Night Sleep' }));
    const form = document.querySelector('form');
    expect(form).toBeTruthy();
    fireEvent.submit(form!);

    const post = await waitFor(() => {
      const found = fetchMock.mock.calls.find(
        ([u, i]) => u === '/api/sleep-log' && (i as { method?: string } | undefined)?.method === 'POST'
      );
      expect(found).toBeTruthy();
      return found as [string, { body?: string; method?: string }];
    });
    const [url, init] = post;
    const payload = JSON.parse(init?.body ?? '{}') as { type?: string; babyId?: string };
    expect(payload.type).toBe('NIGHT_SLEEP');
    expect(payload.babyId).toBe('baby-1');
  });
});
