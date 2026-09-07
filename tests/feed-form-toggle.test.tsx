import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FeedForm from '@/src/components/forms/FeedForm';
import { LocalizationProvider } from '@/src/context/localization';
import { ThemeProvider } from '@/src/context/theme';
import { TimezoneProvider } from '@/app/context/timezone';
import { ToastProvider } from '@/src/components/ui/toast/toast-provider';

// The migration must not change feed-form behavior: both options render with
// their imagery, selection works, and the fresh-form unselected state is preserved.
describe('FeedForm feed-type ToggleGroup (issue #1 migration)', () => {
  const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
    babyId: 'baby-1',
    initialTime: new Date().toISOString(),
  };

  it('renders Breast and Bottle radios and switches selection on click', async () => {
    const { container } = render(
      <ThemeProvider>
        <LocalizationProvider>
          <TimezoneProvider>
            <ToastProvider>
              <FeedForm {...baseProps} />
            </ToastProvider>
          </TimezoneProvider>
        </LocalizationProvider>
      </ThemeProvider>
    );

    const group = await screen.findByRole('radiogroup', { name: 'Type' });
    expect(group).toBeTruthy();

    const breast = screen.getByRole('radio', { name: 'Breast' });
    const bottle = screen.getByRole('radio', { name: 'Bottle' });

    // Fresh form: nothing selected yet; first option is the single tab stop
    expect(breast.getAttribute('aria-checked')).toBe('false');
    expect(bottle.getAttribute('aria-checked')).toBe('false');
    expect(breast.getAttribute('tabindex')).toBe('0');
    expect(bottle.getAttribute('tabindex')).toBe('-1');

    // Circle layout keeps the feed-form imagery as decorative icons
    const breastImg = breast.querySelector<HTMLImageElement>("img[src='/breastfeed-128.png']");
    const bottleImg = bottle.querySelector<HTMLImageElement>("img[src='/bottlefeed-128.png']");
    expect(breastImg).toBeTruthy();
    expect(bottleImg).toBeTruthy();
    expect(breastImg?.getAttribute('alt')).toBe('');

    fireEvent.click(bottle);
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Bottle' }).getAttribute('aria-checked')).toBe('true');
      expect(screen.getByRole('radio', { name: 'Breast' }).getAttribute('aria-checked')).toBe('false');
    });

    fireEvent.click(screen.getByRole('radio', { name: 'Breast' }));
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Breast' }).getAttribute('aria-checked')).toBe('true');
    });
  });
});
