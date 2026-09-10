'use client';

import React from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Label } from '@/src/components/ui/label';
import { DatePicker } from '@/src/components/ui/date-picker';
import { ToggleGroup, type ToggleGroupOption } from '@/src/components/ui/toggle-group';
import { cn } from '@/src/lib/utils';
import { upgradeModalStyles as styles } from './milk-bag-upgrade-modal.styles';
import type { UpgradeRowState } from './milk-bag-upgrade-modal.types';
import type { StorageLocation } from '@/src/utils/milk-storage';
import type { DayNight } from '@/src/utils/milk-bag-rules';

interface UpgradeBagRowProps {
  row: UpgradeRowState;
  storageOptions: ToggleGroupOption<StorageLocation>[];
  dayNightOptions: ToggleGroupOption<DayNight>[];
  onRemove: () => void;
  onUpdate: (patch: Partial<UpgradeRowState>) => void;
  labels: {
    bag: string;
    remove: string;
    amount: string;
    baggedAt: string;
    storage: string;
    dayNight: string;
  };
}

/** One editable row of the guided split (issue #13): amount, bagged-at, storage, day/night. */
export function UpgradeBagRow({ row, storageOptions, dayNightOptions, onRemove, onUpdate, labels }: UpgradeBagRowProps) {
  return (
    <div className={cn(styles.row, 'mbupgrade-row')}>
      <div className={styles.rowHeader}>
        <span className={cn(styles.rowLabel, 'mbupgrade-rowLabel')}>{labels.bag}</span>
        <Button type="button" variant="ghost" size="icon" aria-label={labels.remove} onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className={styles.twoCol}>
        <div className="space-y-1">
          <Label className={cn(styles.fieldLabel, 'mbupgrade-fieldLabel')}>{labels.amount}</Label>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            placeholder="0"
            value={row.amount}
            onChange={(e) => onUpdate({ amount: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className={cn(styles.fieldLabel, 'mbupgrade-fieldLabel')}>{labels.baggedAt}</Label>
          <DatePicker value={row.baggedDate} onChange={(d) => onUpdate({ baggedDate: d })} />
        </div>
      </div>

      <div className="space-y-1">
        <Label className={cn(styles.fieldLabel, 'mbupgrade-fieldLabel')}>{labels.storage}</Label>
        <ToggleGroup
          aria-label={labels.storage}
          options={storageOptions}
          value={row.storageLocation}
          onChange={(v) => onUpdate({ storageLocation: v })}
        />
      </div>

      <div className="space-y-1">
        <Label className={cn(styles.fieldLabel, 'mbupgrade-fieldLabel')}>{labels.dayNight}</Label>
        <ToggleGroup
          aria-label={labels.dayNight}
          options={dayNightOptions}
          value={row.dayNight}
          onChange={(v) => onUpdate({ dayNight: v })}
        />
      </div>
    </div>
  );
}
