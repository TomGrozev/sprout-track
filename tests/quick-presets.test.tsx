import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DiaperForm from '@/src/components/forms/DiaperForm';
import FeedForm from '@/src/components/forms/FeedForm';
import QuickPresets from '@/src/components/forms/QuickPresets';
import { LocalizationProvider } from '@/src/context/localization';
import { ThemeProvider } from '@/src/context/theme';
import { TimezoneProvider } from '@/app/context/timezone';
import { ToastProvider } from '@/src/components/ui/toast/toast-provider';

// Quick-select presets (issue #7): the ranking kernel is tested in
// quickPreset.test.ts — this covers the UI half, i.e. fetch → filter
// soft-deletes → map rows → render chips → apply values to the form.
describe('QuickPresets (issue #7)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const recentTime = () => new Date(Date.now() - 60 * 1000).toISOString();

  /** Wire a fetch mock that routes list endpoints to `rows`, everything else empty. */
  const stubFetch = (listUrlPrefix: string, rows: unknown[]) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith(listUrlPrefix)) {
          return { ok: true, json: async () => ({ success: true, data: rows }) };
        }
        return { ok: true, json: async () => ({ success: true, data: [] }) };
      })
    );
  };

  const renderDiaper = () =>
    render(
      <ThemeProvider>
        <LocalizationProvider>
          <TimezoneProvider>
            <ToastProvider>
              <DiaperForm
                isOpen
                onClose={vi.fn()}
                babyId="baby-1"
                initialTime={new Date().toISOString()}
              />
            </ToastProvider>
          </TimezoneProvider>
        </LocalizationProvider>
      </ThemeProvider>
    );

  it('renders a diaper preset chip and applies it to the form', async () => {
    stubFetch('/api/diaper-log?', [
      {
        id: '1',
        time: recentTime(),
        type: 'BOTH',
        condition: 'NORMAL',
        color: 'YELLOW',
        blowout: false,
        creamApplied: false,
        deletedAt: null,
      },
      {
        id: '2',
        time: recentTime(),
        type: 'BOTH',
        condition: 'NORMAL',
        color: 'YELLOW',
        blowout: false,
        creamApplied: false,
        deletedAt: null,
      },
    ]);

    renderDiaper();

    // Two identical rows → one preset chip for the Wet and Dirty combo.
    const chip = await screen.findByRole('button', { name: /Wet and Dirty/ });
    fireEvent.click(chip);

    // Applying pre-fills the Type (first combobox) and Color (third) selects.
    await waitFor(() => {
      const comboboxes = screen.getAllByRole('combobox');
      expect(comboboxes[0].textContent).toContain('Wet and Dirty');
      expect(comboboxes[2].textContent).toContain('Yellow');
    });
  });

  it('renders a feed preset chip and pre-fills the breast mode', async () => {
    // The two Breast rows form one preset; everything else (photos,
    // settings, last-log lookups) resolves empty so the form stays pristine.
    stubFetch('/api/feed-log?', [
      {
        id: '1',
        time: recentTime(),
        type: 'BREAST',
        bottleType: null,
        deletedAt: null,
      },
      {
        id: '2',
        time: recentTime(),
        type: 'BREAST',
        bottleType: null,
        deletedAt: null,
      },
    ]);

    render(
      <ThemeProvider>
        <LocalizationProvider>
          <TimezoneProvider>
            <ToastProvider>
              <FeedForm
                isOpen
                onClose={vi.fn()}
                babyId="baby-1"
                initialTime={new Date().toISOString()}
              />
            </ToastProvider>
          </TimezoneProvider>
        </LocalizationProvider>
      </ThemeProvider>
    );

    const chip = await screen.findByRole('button', { name: 'Breast' });
    fireEvent.click(chip);

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Breast' }).getAttribute('aria-checked')).toBe('true');
    });
  });

  it('excludes soft-deleted logs and legacy SOLIDS feeds, rendering no chips', async () => {
    // Diaper: one live + one soft-deleted row → below minFrequency → no chip.
    stubFetch('/api/diaper-log?', [
      { id: '1', time: recentTime(), type: 'BOTH', condition: 'NORMAL', color: 'YELLOW', deletedAt: null },
      { id: '2', time: recentTime(), type: 'BOTH', condition: 'NORMAL', color: 'YELLOW', deletedAt: '2026-01-01T00:00:00Z' },
    ]);

    render(
      <ThemeProvider>
        <LocalizationProvider>
          <TimezoneProvider>
            <ToastProvider>
              <QuickPresets
                kind="diaper"
                babyId="baby-1"
                isOpen
                onApply={vi.fn()}
              />
            </ToastProvider>
          </TimezoneProvider>
        </LocalizationProvider>
      </ThemeProvider>
    );

    // Only one non-deleted row remains → below minFrequency(2) → nothing.
    await waitFor(() => {
      expect(screen.queryByRole('button')).toBeNull();
    });
  });

  it('excludes legacy SOLIDS feeds so the form never receives an unsupported mode', async () => {
    // Two SOLIDS rows would rank as a preset if not filtered out; the feed
    // form can no longer create SOLIDS entries, so the chip must vanish.
    stubFetch('/api/feed-log?', [
      { id: '1', time: recentTime(), type: 'SOLIDS', bottleType: null, deletedAt: null },
      { id: '2', time: recentTime(), type: 'SOLIDS', bottleType: null, deletedAt: null },
    ]);

    render(
      <ThemeProvider>
        <LocalizationProvider>
          <TimezoneProvider>
            <ToastProvider>
              <QuickPresets
                kind="feed"
                babyId="baby-1"
                isOpen
                onApply={vi.fn()}
              />
            </ToastProvider>
          </TimezoneProvider>
        </LocalizationProvider>
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.queryByRole('button')).toBeNull();
    });
  });
});
