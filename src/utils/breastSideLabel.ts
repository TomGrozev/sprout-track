// Issue #5: families can give each breast a custom display name. Call sites
// resolve the side label through this helper and fall back to the existing
// translated Left/Right when it returns null. Display-only — the stored side
// value (LEFT/RIGHT) is never changed.

export interface BreastLabelSettings {
  breastLeftLabel?: string | null;
  breastRightLabel?: string | null;
}

export function resolveBreastSideLabel(
  side: string,
  settings: BreastLabelSettings | null | undefined
): string | null {
  const label = side === 'LEFT' ? settings?.breastLeftLabel : side === 'RIGHT' ? settings?.breastRightLabel : null;
  if (label == null) return null;
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed : null;
}
