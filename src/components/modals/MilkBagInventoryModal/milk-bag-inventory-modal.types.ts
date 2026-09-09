import type { MilkBagDTO, MilkBagTotals } from '@/src/types/milk-bag';
import type { FreezerType } from '@/src/utils/milk-storage';
import type { DateFormatSetting, TimeFormatSetting } from '@/src/utils/dateFormat';

/** Props for the milk-bag inventory modal (issue #9 / #10 surface). */
export interface MilkBagInventoryModalProps {
  /** Whether the modal is open. */
  open: boolean;
  /** Called to dismiss the modal. */
  onClose: () => void;
  /** The baby whose bags are listed. */
  babyId: string;
  /** Bags as returned by `GET /api/milk-bags`. Available bags are listed. */
  bags: MilkBagDTO[];
  /** Bag totals as returned alongside the bag list. */
  totals: MilkBagTotals;
  /** Family freezer type — drives use-by derivations for frozen bags. */
  freezerType: FreezerType;
  /** Family date format setting (use-by badge detail). */
  dateFormat: DateFormatSetting;
  /** Family time format setting (contained pump times). */
  timeFormat: TimeFormatSetting;
  /** Optional display timezone for date/time formatting. */
  timezone?: string;
  /** Optional — fired with the updated list after a one-tap location move. */
  onBagsChanged?: (bags: MilkBagDTO[], totals: MilkBagTotals) => void;
}

/** Local state for one bag being awaited on a location change. */
export type BagPatchState = {
  busyId: string | null;
  error: string | null;
};
