'use client';

import React from 'react';
import { cn } from '@/src/lib/utils';
import { upgradeModalStyles as styles } from './milk-bag-upgrade-modal.styles';
import { UpgradeModalTexts } from './milk-bag-upgrade-modal.types';

interface UpgradeChoiceScreenProps {
 texts: UpgradeModalTexts;
 onConvert: () => void;
 onGoingForward: () => void;
 submitting: boolean;
}

/**
 * Issue #13 first-run choice: track going forward only, or convert the
 * legacy balance into discrete bags.
 */
export function UpgradeChoiceScreen({ texts, onConvert, onGoingForward, submitting }: UpgradeChoiceScreenProps) {
 return (
  <div className={styles.choiceGrid}>
   <p className="text-sm text-gray-600">{texts.intro}</p>
   <button type="button" className={cn(styles.choiceCard, 'mbupgrade-choiceCard')} onClick={onGoingForward} disabled={submitting}>
    <span className={cn(styles.choiceCardTitle, 'mbupgrade-choiceCardTitle')}>{texts.goingForwardTitle}</span>
    <span className={cn(styles.choiceCardDesc, 'mbupgrade-choiceCardDesc')}>{texts.goingForwardDesc}</span>
   </button>
   <button type="button" className={cn(styles.choiceCard, 'mbupgrade-choiceCard')} onClick={onConvert} disabled={submitting}>
    <span className={cn(styles.choiceCardTitle, 'mbupgrade-choiceCardTitle')}>{texts.convertTitle}</span>
    <span className={cn(styles.choiceCardDesc, 'mbupgrade-choiceCardDesc')}>{texts.convertDesc}</span>
   </button>
  </div>
 );
}
