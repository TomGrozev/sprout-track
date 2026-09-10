import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DiaperForm from '@/src/components/forms/DiaperForm';
import FeedForm from '@/src/components/forms/FeedForm';
import QuickPresets from '@/src/components/forms/QuickPresets';
import { truncateNoteLabel } from '@/src/utils/quickPreset';
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

  it('renders a single live row as chip 1 even though it is a one-off', async () => {
    // One live row alone would previously be below minFrequency(2) and produce
    // no chip; recent-first now always surfaces it.
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
    ]);

    render(
      <ThemeProvider>
        <LocalizationProvider>
          <TimezoneProvider>
            <ToastProvider>
              <QuickPresets kind="diaper" babyId="baby-1" isOpen onApply={vi.fn()} />
            </ToastProvider>
          </TimezoneProvider>
        </LocalizationProvider>
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Wet and Dirty/ })).toBeTruthy();
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

  it('excludes soft-deleted logs so a deleted row never becomes the recent chip', async () => {
    // The soft-deleted DIRTY row is the newest; if it were (incorrectly) kept
    // it would be the recent chip. With it filtered out, the live WET row wins.
    stubFetch('/api/diaper-log?', [
      {
        id: '1',
        time: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        type: 'WET',
        condition: null,
        color: null,
        blowout: false,
        creamApplied: false,
        deletedAt: null,
      },
      {
        id: '2',
        time: new Date(Date.now() - 60 * 1000).toISOString(),
        type: 'DIRTY',
        condition: null,
        color: null,
        blowout: false,
        creamApplied: false,
        deletedAt: '2026-01-01T00:00:00Z',
      },
    ]);

    render(
      <ThemeProvider>
        <LocalizationProvider>
          <TimezoneProvider>
            <ToastProvider>
              <QuickPresets kind="diaper" babyId="baby-1" isOpen onApply={vi.fn()} />
            </ToastProvider>
          </TimezoneProvider>
        </LocalizationProvider>
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Wet/ })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: /Dirty/ })).toBeNull();
  });

  it('renders a notes-derived "other" chip and applies the full note to the form', async () => {
    const note = 'buy more wipes and diapers soon';
    // Two identical BOTH rows carrying the same note → one "other" chip whose
    // label is t('Other') + a 24-char-truncated note; clicking applies the
    // FULL (untruncated) note to the form's notes field.
    stubFetch('/api/diaper-log?', [
      {
        id: '1',
        time: recentTime(),
        type: 'BOTH',
        condition: 'NORMAL',
        color: 'YELLOW',
        notes: note,
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
        notes: note,
        blowout: false,
        creamApplied: false,
        deletedAt: null,
      },
    ]);

    renderDiaper();

    const expectedLabel = `Other · ${truncateNoteLabel(note)}`;
    const chip = await screen.findByRole('button', { name: expectedLabel });
    fireEvent.click(chip);

    await waitFor(() => {
      const notesField = screen.getByPlaceholderText('Enter any notes about the diaper change');
      expect((notesField as HTMLTextAreaElement).value).toBe(note);
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
              <QuickPresets kind="feed" babyId="baby-1" isOpen onApply={vi.fn()} />
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
