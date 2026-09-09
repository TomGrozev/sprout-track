export interface MilkBagUpgradeModalProps {
  /** Whether the modal is open. */
  open: boolean;
  /** Called to close the modal. */
  onClose: () => void;
  /** The baby whose legacy balance is being converted. */
  babyId: string;
  /** Fired once the upgrade marker has been persisted (going-forward or convert). */
  onUpgraded?: () => void;
}

/** Internal state for one convert-to-bags row. */
export type UpgradeRowState = {
  id: number;
  amount: string;
  baggedAt: Date;
  storageLocation: 'room' | 'fridge' | 'freezer';
  dayNight: 'day' | 'night';
};
