# MilkBagUpgradeModal

One-time milk-bag upgrade modal (issue #13). Presents the family with two paths
into tracked milk bags:

- **Track going forward only** — writes the `milkBagsUpgradedAt` marker into
  `Settings.milkBagSettings` (merging, never replacing existing keys) and closes,
  without creating any bags.
- **Convert to bags** — loads the baby's legacy expressed-milk balance and lets
  the user reconstruct it as individual bags (amount, date, storage, day/night).
  The running sum is shown against the legacy total with a live leftover readout.
  On submit, a leftover > 0 first shows a "Discard leftover X ml?" confirm; when
  the backend still enforces the rule with a 409, the confirm is re-surfaced.

## Usage

```tsx
import { MilkBagUpgradeModal } from '@/src/components/modals/MilkBagUpgradeModal';

const [open, setOpen] = useState(false);

<MilkBagUpgradeModal
  open={open}
  onClose={() => setOpen(false)}
  babyId={selectedBabyId}
  onUpgraded={() => refreshBags()}
/>
```

## Props

| Prop        | Type       | Description                                              |
|-------------|------------|----------------------------------------------------------|
| `open`      | `boolean`  | Whether the modal is open.                               |
| `onClose`   | `() => void` | Called to dismiss the modal.                            |
| `babyId`    | `string`   | Baby whose legacy balance is being converted.            |
| `onUpgraded`| `(() => void) \| undefined` | Fired once the upgrade marker has been persisted. |

## Flow

1. **Choice screen** — the two paths above.
2. **Convert screen** — fetches `GET /api/breast-milk-balance?babyId=…&unit=ML`
   (ML keeps amounts and the request consistent with the ML-based backend
   `convertLegacyBalance`), renders rows, and reads the live sum via
   `computeUpgradeSum` from `src/utils/milkBagUpgradeUi`.
3. **Submit** — `POST /api/milk-bags/upgrade` with `MilkBagUpgradeRequest`
   (`{ babyId, bags, discardLeftover }`). A leftover confirm gates
   `discardLeftover: true`; a `409 { error: 'leftover', data: { leftoverMl } }`
   re-opens the confirm. Success persists the marker by merging the
   `Settings.milkBagSettings` blob, then calls `onUpgraded`/`onClose`.

## Implementation notes

- The per-bag date field is **date-only** (a `DatePicker`, not a date+time picker, so it fits the modal without overflowing; the popover renders on top via the shared `z-[102]` picker tokens). The field stores a local **midnight** Date, and rows serialize as **end-of-day** (23:59:59.999 local) so expiry comparisons (`baggedAt` + shelf-life vs `Date.now()`) keep the bagged-day meaning correct.

- Day/night defaults on a new row are derived from the bag date with the
  `DEFAULT_DAY_NIGHT_BOUNDARY` (07:00–19:00); the user can override via the
  toggle and the choice is preserved.
- The marker is written by reading current settings (`GET /api/settings`),
  merging `milkBagsUpgradedAt` into the existing blob with `setUpgradeMarker`,
  and `PUT /api/settings` — it never blindly replaces the blob.
- Pure logic (row→request mapping, running sum, marker merge) lives in
  `src/utils/milkBagUpgradeUi.ts`, unit-tested in `tests/milk-bag-upgrade-ui.test.ts`
  (node-Vitest, no rendering).
