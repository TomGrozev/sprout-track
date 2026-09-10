# DatePicker Component

A date-only picker component for the Baby Tracker application that combines a calendar for date selection in a popover. Unlike its sibling `DateTimePicker`, it has no time component — a single button opens a calendar, and the selected date is normalized to midnight (00:00 local time).

## Features

- Single button for date selection
- Calendar component for date selection in a popover
- Selected date normalized to midnight (00:00 local time) — date-only semantics
- Automatic closing of the date popover when a date is selected
- Bottom-aware positioning with margin
- Keyboard accessibility
- Dark mode support
- Follows the project's design system

## Usage

```tsx
import { DatePicker } from '@/src/components/ui/date-picker';
import { useState } from 'react';

function Example() {
  const [date, setDate] = useState<Date | null>(null);

  return (
    <div className="p-4">
      <DatePicker value={date} onChange={setDate} />
    </div>
  );
}
```

## Component API

### DatePicker

Main component for selecting a date.

#### Props

| Prop | Type | Description | Default |
|------|------|-------------|---------|
| `value` | `Date \| null` | The currently selected date | Required |
| `onChange` | `(date: Date) => void` | Callback fired when a date is selected | Required |
| `className` | `string \| undefined` | Optional class name for additional styling | `undefined` |
| `disabled` | `boolean` | Whether the component is disabled | `false` |
| `placeholder` | `string` | Placeholder text (legacy, not used in current implementation) | `"Select date..."` |

## Popover layering

The picker's popover content token (`datePickerPopoverContentStyles`) carries an extra z-index step, `z-[102]`. When a Form embeds this picker inside a modal, the popover portal renders as a later sibling of the dialog content in the `body`. The dialog content is positioned at `z-[101]`; because both live at the same stacking level (both direct/descendant siblings rendered in `body`), an equal exponent would let the later sibling win only by DOM order — unreliable. The extra step (`z-[102] > z-[101]`) guarantees the calendar popover renders above the modal panel. See `ui/popover/README.md` for the shared layering note.

## Visual Behavior

- Displays a single button with a calendar icon and the currently selected date
- Clicking the button opens a calendar popover
- Selecting a date automatically closes the popover
- Popovers are positioned with awareness of the bottom of the screen

## Implementation Details

The component combines several UI components:
1. A Button component for triggering the date popover
2. A Popover component for displaying the selection interface
3. A Calendar component for date selection

The component handles:
- Maintaining internal state for the selected date
- Normalizing any selected date to midnight (local time)
- Formatting the date for display
- Proper focus management for accessibility
- Bottom-aware positioning of the popover

## Cross-Platform Considerations

This component is designed with cross-platform compatibility in mind:

- Uses standard React patterns that can be adapted to React Native
- Implements touch interactions that work on both mobile and desktop
- Handles the date in a platform-agnostic way

When converting to React Native, the Calendar component would need to be implemented using React Native's components, but the overall structure and logic would remain similar.
