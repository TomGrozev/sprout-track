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
  /** Local calendar day the milk was bagged; DatePicker always supplies midnight (00:00 local) — input is date-only. */
  baggedDate: Date;
  storageLocation: 'room' | 'fridge' | 'freezer';
  dayNight: 'day' | 'night';
};

/** Localized strings handed down from the container to sub-components. */
export interface UpgradeModalTexts {
  intro: string;
  goingForwardTitle: string;
  goingForwardDesc: string;
  convertTitle: string;
  convertDesc: string;
}
