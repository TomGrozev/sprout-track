'use client';

import React, { useState, useEffect } from 'react';
import { Label } from '@/src/components/ui/label';
import {
  bagAppendOption,
  eligibleBagsForAppend,
  type BagAppendOption,
} from '@/src/utils/milkBagPumpUi';
import { useLocalization } from '@/src/context/localization';
import { DEFAULT_DAY_NIGHT_BOUNDARY } from '@/src/utils/milk-bag-rules';
import type { MilkBagDTO } from '@/src/types/milk-bag';

interface MilkBagAppendSectionProps {
  babyId: string | undefined;
  selectedStartTime: Date;
  onAppendToBagId: (bagId: string | null) => void;
  enableBreastMilkTracking: boolean;
  error: string | null;
  bags: MilkBagDTO[];
  bagsLoaded: boolean;
}

/**
 * A compact "add to existing bag" section that appears in Pump Session mode
 * when breast-milk tracking is enabled and there are eligible bags.
 *
 * The bag list is fetched once on mount; options are derived via pure helpers.
 * Hides itself when `enableBreastMilkTracking` is false, bags are empty/loading,
 * or this is edit mode.
 */
export function MilkBagAppendSection({
  babyId: _babyId,
  selectedStartTime: _selectedStartTime,
  onAppendToBagId,
  enableBreastMilkTracking,
  error,
  bags,
  bagsLoaded,
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
    const eligible = eligibleBagsForAppend(
      bags,
      now.getTime(),
      DEFAULT_DAY_NIGHT_BOUNDARY.dayStartHour,
      DEFAULT_DAY_NIGHT_BOUNDARY.dayEndHour,
    );
    setOptions(
      eligible.map((bag) =>
        bagAppendOption(
          bag,
          now.getTime(),
          DEFAULT_DAY_NIGHT_BOUNDARY.dayStartHour,
          DEFAULT_DAY_NIGHT_BOUNDARY.dayEndHour,
        ),
      ),
    );
  }, [bags, enableBreastMilkTracking]);

  // Hide when not needed
  if (!enableBreastMilkTracking || !bags.length || !bagsLoaded) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{t('Breast milk bag')}</Label>
      </div>

      <div className="space-y-1">
        {/* Default option */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="milk-bag-select"
            checked={selectedBagId === null}
            onChange={() => {
              setSelectedBagId(null);
              onAppendToBagId(null);
            }}
            className="accent-teal-600"
          />
          <span>{t('New bag')}</span>
        </label>

        {/* Eligible bag options */}
        {options.map((opt) => (
          <label key={opt.id} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="milk-bag-select"
              checked={selectedBagId === opt.id}
              onChange={() => {
                setSelectedBagId(opt.id);
                onAppendToBagId(opt.id);
              }}
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
