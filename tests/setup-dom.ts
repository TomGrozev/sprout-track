import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Without vitest globals, @testing-library/react does not auto-register
// cleanup between tests — do it explicitly so DOM renders never leak.
afterEach(() => {
  cleanup();
});

// jsdom does not implement matchMedia; ThemeProvider needs it.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}
