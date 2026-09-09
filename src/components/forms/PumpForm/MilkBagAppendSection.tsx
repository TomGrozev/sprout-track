'use client';

import React, { useState, useEffect } from 'react';
import { Label } from '@/src/components/ui/label';
import { ToggleGroup } from '@/src/components/ui/toggle-group';
import {
 bagAppendOption,
 eligibleBagsForAppend,
 type BagAppendOption,
} from '@/src/utils/milkBagPumpUi';
import { useLocalization } from '@/src/context/localization';
import type { DayNight } from '@/src/utils/milk-bag-rules';
import type { MilkBagDTO } from '@/src/types/milk-bag';

interface MilkBagAppendSectionProps {
 selectedStartTime: Date;
 onAppendToBagId: (bagId: string | null) => void;
  /** Family day/night boundary hours (already resolved via the family settings). */
  dayStartHour: number;
  dayEndHour: number;
 /** Day/night label for a new bag: the derived preview from PumpForm (override ?? boundary derivation). */
 newBagDayNight: DayNight;
 /** Propagate an explicit override up (null = back to the derived preview). */
 onNewBagDayNight: (label: DayNight | null) => void;
 enableBreastMilkTracking: boolean;
 error: string | null;
 bags: MilkBagDTO[];
}

/**
 * Bag destination picker for the pump form (issue #9): a "New bag" option with
 * a day/night toggle (pre-filled from the pump start time via the family
 * boundary), plus eligible existing bags (<24h, available). Selecting an
 * existing bag hides the toggle; selecting "New bag" shows it.
 *
 * Always rendered while breast-milk tracking is on in new-entry STORED mode —
 * even with zero eligible bags, because the default action then is creating
 * a new bag.
 */
export function MilkBagAppendSection({
 selectedStartTime: _selectedStartTime,
 onAppendToBagId,
  dayStartHour,
  dayEndHour,
 newBagDayNight,
 onNewBagDayNight,
 enableBreastMilkTracking,
 error,
 bags,
}: MilkBagAppendSectionProps) {
 const { t } = useLocalization();

 const [selectedBagId, setSelectedBagId] = useState<string | null>(null);
 const [options, setOptions] = useState<BagAppendOption[]>([]);

 // Derive eligible options and sort newest-start first whenever bags change.
 useEffect(() => {
  if (!enableBreastMilkTracking || !bags.length) {
   setOptions([]);
   return;
  }
  const now = new Date();
  const eligible = eligibleBagsForAppend(bags, now.getTime(), dayStartHour, dayEndHour);
  setOptions(eligible.map((bag) => bagAppendOption(bag, now.getTime(), dayStartHour, dayEndHour)));
 }, [bags, enableBreastMilkTracking, dayStartHour, dayEndHour]);

 if (!enableBreastMilkTracking) {
  return null;
 }

 const dayNightOptions = [
  { value: 'day' as DayNight, label: t('Day') },
  { value: 'night' as DayNight, label: t('Night') },
 ];

 const selectBag = (bagId: string | null) => {
  setSelectedBagId(bagId);
  onAppendToBagId(bagId);
 };

 return (
  <div className="space-y-2">
   <div className="flex items-center justify-between">
    <Label className="text-sm font-medium">{t('Breast milk bag')}</Label>
   </div>

   <div className="space-y-1">
    {/* New bag (default) */}
    <label className="flex items-center gap-2 text-sm">
     <input
      type="radio"
      name="milk-bag-select"
      checked={selectedBagId === null}
      onChange={() => selectBag(null)}
      className="accent-teal-600"
     />
     <span>{t('New bag')}</span>
    </label>

    {/* Day/night label for the new bag, pre-derived from the pump start */}
    {selectedBagId === null && (
     <div className="ml-6 flex items-center gap-2">
      <ToggleGroup
       aria-label={t('Day or night?')}
       layout="circle"
       options={dayNightOptions}
       value={newBagDayNight}
       onChange={(v) => onNewBagDayNight(v)}
      />
     </div>
    )}

    {/* Eligible bag options */}
    {options.map((opt) => (
     <label key={opt.id} className="flex items-center gap-2 text-sm">
      <input
       type="radio"
       name="milk-bag-select"
       checked={selectedBagId === opt.id}
       onChange={() => selectBag(opt.id)}
       className="accent-teal-600"
      />
      <span className="truncate">
       {opt.label} — {opt.volumeLine} ({opt.remainingText})
      </span>
     </label>
    ))}
   </div>

   {error && (
    <p className="text-sm text-red-600" role="alert">
     {error}
    </p>
   )}
  </div>
 );
}
