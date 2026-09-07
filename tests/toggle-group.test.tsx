import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ToggleGroup, type ToggleGroupOption } from '@/src/components/ui/toggle-group';

type FeedChoice = 'BREAST' | 'BOTTLE';

const feedOptions: ToggleGroupOption<FeedChoice>[] = [
  { value: 'BREAST', label: 'Breast' },
  { value: 'BOTTLE', label: 'Bottle' },
];

describe('ToggleGroup', () => {
  it('renders a named group containing every option', () => {
    render(<ToggleGroup options={feedOptions} value="BREAST" onChange={vi.fn()} aria-label="Feed type" />);

    expect(screen.getByRole('radiogroup', { name: 'Feed type' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Breast' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Bottle' })).toBeTruthy();
  });

  it('marks the selected option checked and others unchecked', () => {
    render(<ToggleGroup options={feedOptions} value="BREAST" onChange={vi.fn()} aria-label="Feed type" />);

    expect(screen.getByRole('radio', { name: 'Breast' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Bottle' }).getAttribute('aria-checked')).toBe('false');
  });

  it('supports an initially unselected group (null value)', () => {
    render(<ToggleGroup options={feedOptions} value={null} onChange={vi.fn()} aria-label="Feed type" />);

    expect(screen.getByRole('radio', { name: 'Breast' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('radio', { name: 'Bottle' }).getAttribute('aria-checked')).toBe('false');
  });

  it('invokes onChange with the clicked option value', () => {
    const onChange = vi.fn();
    render(<ToggleGroup options={feedOptions} value="BREAST" onChange={onChange} aria-label="Feed type" />);

    fireEvent.click(screen.getByRole('radio', { name: 'Bottle' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('BOTTLE');
  });

  it('does not invoke onChange when the selected option is clicked', () => {
    const onChange = vi.fn();
    render(<ToggleGroup options={feedOptions} value="BREAST" onChange={onChange} aria-label="Feed type" />);

    fireEvent.click(screen.getByRole('radio', { name: 'Breast' }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not invoke onChange when disabled', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ToggleGroup options={feedOptions} value="BREAST" onChange={onChange} aria-label="Feed type" />
    );

    rerender(<ToggleGroup options={feedOptions} value="BREAST" onChange={onChange} aria-label="Feed type" disabled />);
    fireEvent.click(screen.getByRole('radio', { name: 'Bottle' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'Bottle' }).hasAttribute('disabled')).toBe(true);
  });

  it('reflects the selected option after a controlled value change', () => {
    const { rerender } = render(
      <ToggleGroup options={feedOptions} value="BREAST" onChange={vi.fn()} aria-label="Feed type" />
    );
    rerender(<ToggleGroup options={feedOptions} value="BOTTLE" onChange={vi.fn()} aria-label="Feed type" />);

    expect(screen.getByRole('radio', { name: 'Breast' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('radio', { name: 'Bottle' }).getAttribute('aria-checked')).toBe('true');
  });

  it('moves selection with arrow keys and follows focus', () => {
    const onChange = vi.fn();
    render(<ToggleGroup options={feedOptions} value="BREAST" onChange={onChange} aria-label="Feed type" />);

    const breast = screen.getByRole('radio', { name: 'Breast' });
    const bottle = screen.getByRole('radio', { name: 'Bottle' });

    breast.focus();
    fireEvent.keyDown(breast, { key: 'ArrowRight' });

    expect(onChange).toHaveBeenCalledWith('BOTTLE');
    expect(document.activeElement).toBe(bottle);
  });

  it('wraps selection at the ends of the group', () => {
    const onChange = vi.fn();
    render(<ToggleGroup options={feedOptions} value="BREAST" onChange={onChange} aria-label="Feed type" />);

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Breast' }), { key: 'ArrowLeft' });

    expect(onChange).toHaveBeenCalledWith('BOTTLE');
  });

  it('renders each option icon inside its option', () => {
    const iconOptions: ToggleGroupOption<'DAY' | 'NIGHT'>[] = [
      { value: 'DAY', label: 'Day', icon: <span data-testid="sun-icon" /> },
      { value: 'NIGHT', label: 'Night', icon: <span data-testid="moon-icon" /> },
    ];
    render(<ToggleGroup options={iconOptions} value="NIGHT" onChange={vi.fn()} aria-label="Milk time" />);

    expect(screen.getByRole('radio', { name: 'Day' }).contains(screen.getByTestId('sun-icon'))).toBe(true);
    expect(screen.getByRole('radio', { name: 'Night' }).contains(screen.getByTestId('moon-icon'))).toBe(true);
  });
});
