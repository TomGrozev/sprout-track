import { useCallback, useEffect, useRef } from 'react';

/**
 * Touch-friendly open behavior for the time popover (issue #2).
 *
 * Tracks whether the popover's most recent trigger activation started from a
 * touch/pen pointerdown (as opposed to mouse or keyboard). Radix's FocusScope
 * auto-focuses the first tabbable element inside the popover when it opens —
 * in DateTimePicker that is TimeEntry's hour spinbutton, and program-focusing
 * a text input on a touch device pops the soft keyboard. Touch users get the
 * steppers instead; they can still deliberately tap a field to type.
 *
 * Returns the two handlers to wire up:
 *  - `handleTriggerPointerDown` → PopoverTrigger's onPointerDown
 *  - `handleOpenAutoFocus`      → PopoverContent's onOpenAutoFocus
 */
export function useTimeOpenTouchGate(open: boolean) {
  const openFromTouchRef = useRef(false);

  const handleTriggerPointerDown = useCallback((e: React.PointerEvent) => {
    openFromTouchRef.current = e.pointerType === 'touch' || e.pointerType === 'pen';
  }, []);

  const handleOpenAutoFocus = useCallback((e: Event) => {
    // Cancel Radix's focus-first-element on open: no programmatic focus on the
    // hour input, so no soft keyboard. Keyboard/mouse opens keep focus-first
    // (select-all fires there via the input's own keyboard-only onFocus).
    if (openFromTouchRef.current) e.preventDefault();
  }, []);

  // Reset the modality flag on close so the next open is classified by its own
  // trigger activation — a keyboard open (no pointerdown at all) must not
  // inherit the previous touch open's suppression.
  useEffect(() => {
    if (!open) openFromTouchRef.current = false;
  }, [open]);

  return { handleTriggerPointerDown, handleOpenAutoFocus };
}
