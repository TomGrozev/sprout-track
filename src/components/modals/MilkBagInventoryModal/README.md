# MilkBagInventoryModal

Milk-bag inventory modal (issues #9 + #10 surface). Lists a family's stored milk
bags and lets the user one-tap where each is kept. Opened by tapping the
"Breast Milk Stored" stat in the daily stats (only when the family has the
`milkBagsUpgradedAt` marker set — issue #13's upgrade flow owns that marker).

## Usage

```tsx
import { MilkBagInventoryModal } from '@/src/components/modals/MilkBagInventoryModal';

const [open, setOpen] = useState(false);

<MilkBagInventoryModal
  open={open}
  onClose={() => setOpen(false)}
  babyId={selectedBabyId}
  bags={milkBags?.bags ?? []}
  totals={milkBags?.totals}
  freezerType="separate-door"
  dateFormat={dateFormat}
  timeFormat={timeFormat}
  onBagsChanged={(bags) => setMilkBags((prev) => ({ ...prev, bags }))}
/>
```

## Props

| Prop           | Type                              | Description                                                      |
|----------------|-----------------------------------|------------------------------------------------------------------|
| `open`         | `boolean`                         | Whether the modal is open.                                       |
| `onClose`      | `() => void`                      | Called to dismiss the modal.                                     |
| `babyId`       | `string`                          | Baby whose bags are listed.                                      |
| `bags`         | `MilkBagDTO[]`                    | Bags from `GET /api/milk-bags`. Available bags are listed.       |
| `totals`       | `MilkBagTotals`                   | Bag totals returned alongside the list.                          |
| `freezerType`  | `FreezerType`                     | Family freezer type — drives use-by derivations for frozen bags. |
| `dateFormat`   | `DateFormatSetting`               | Family date format (use-by badge detail).                        |
| `timeFormat`   | `TimeFormatSetting`               | Family time format (contained pump times).                       |
| `timezone`     | `string \| undefined`             | Optional display timezone for date/time formatting.              |
| `onBagsChanged`| `(bags, totals) => void \| undefined` | Optional — fired after a one-tap location move.              |

## Behavior

- Each available bag row shows: a label (or a day/night + volume fallback name),
  a day/night badge, its volume, a use-by badge (expired / "Expires <date>" just
  below, styled red when expired), and the contained pump times.
- A `ToggleGroup` per bag (Room / Fridge / Freezer) issues
  `PATCH /api/milk-bags?id=` with `{ storageLocation }`. The committed response
  (`data.data`, an updated `MilkBagDTO`) is applied to the row. A `422`
  refreeze-block surfaces the route-provided copy via toast; day/night is
  display-only in v1 (editing comes via the bag detail).
- Delete/use actions are out of scope here (consumption is a separate ticket).

## Implementation notes

- Row shaping (use-by badge derivation via `computeUseBy`/`isExpired`, volume
  formatting, pump-time formatting) lives in `src/utils/milkBagInventoryUi.ts`,
  unit-tested in `tests/milk-bag-inventory-ui.test.ts` (node-Vitest, no
  rendering). Locale-aware dates/times use `formatDateDisplay`/`formatTimeDisplay`
  with the family settings passed in as props.
- Light mode is Tailwind via `milk-bag-inventory-modal.styles.ts`; dark mode is
  `html.dark` overrides in `milk-bag-inventory-modal.css` (no `dark:` classes).
