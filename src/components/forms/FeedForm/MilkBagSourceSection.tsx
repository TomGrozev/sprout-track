'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { MilkBagDTO } from '@/src/types/milk-bag';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/src/components/ui/select';
import { Button } from '@/src/components/ui/button';
import { useLocalization } from '@/src/context/localization';
import { mapBagsToOptions, computeExpiryDate, bagOptionLabel } from '@/src/utils/milkBagFeedUi';
import { isBagExpired } from '@/src/utils/milkBagExpiryUi';
import { resolveMilkBagSettings } from '@/src/utils/milk-bag-settings';
import { DEFAULT_DAY_NIGHT_BOUNDARY } from '@/src/utils/milk-bag-rules';
import { DEFAULT_FREEZER_TYPE } from '@/src/utils/milk-storage';

interface MilkBagSourceSectionProps {
  babyId: string;
  disabled?: boolean;
  onSelectBag: (bagId: string | null) => void;
}

/**
 * Collapsible "From bag" selector shown in the bottle-feed form when the family
 * tracks milk bags and the chosen bottle type is breast-milk based. Fetches the
 * family's available bags, auto-suggests one by the current time of day, and
 * reports the selected bag id (or null) up so the feed can be saved against it.
 */
export default function MilkBagSourceSection({ babyId, disabled, onSelectBag }: MilkBagSourceSectionProps) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const [bags, setBags] = useState<MilkBagDTO[]>([]);
  const [dayStartHour, setDayStartHour] = useState(DEFAULT_DAY_NIGHT_BOUNDARY.dayStartHour);
  const [dayEndHour, setDayEndHour] = useState(DEFAULT_DAY_NIGHT_BOUNDARY.dayEndHour);
  const [freezerType, setFreezerType] = useState(DEFAULT_FREEZER_TYPE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Explicit confirm when the chosen bag is past its use-by — never re-enables silently.
  const [expiryConfirmed, setExpiryConfirmed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const authToken = localStorage.getItem('authToken');
    const headers: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {};

    fetch('/api/settings', { cache: 'no-store', headers })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data.success || !data.data?.milkBagSettings) return;
        const s = resolveMilkBagSettings(data.data.milkBagSettings);
        setDayStartHour(s.dayStartHour);
        setDayEndHour(s.dayEndHour);
        setFreezerType(s.freezerType);
      })
      .catch(() => {});

    fetch(`/api/milk-bags?babyId=${encodeURIComponent(babyId)}`, { headers })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.success && data.data?.bags) {
          setBags(data.data.bags);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [babyId]);

  const { suggestedId, options } = useMemo(
    () => mapBagsToOptions(bags, new Date(), dayStartHour, dayEndHour, freezerType, { day: t('Day'), night: t('Night') }),
    [bags, dayStartHour, dayEndHour, freezerType, t],
  );

  const selectedBag = useMemo(
    () => bags.find((b) => b.id === selectedId) ?? null,
    [bags, selectedId],
  );
  const selectedExpired = selectedBag ? isBagExpired(selectedBag, freezerType) : false;

  // Re-select clears any previous explicit confirm (never silently re-confirm).
  useEffect(() => {
    setExpiryConfirmed(false);
  }, [selectedId]);

  // Report the selected bag up to the parent. A past-use-by bag is held back
  // (reported as null) until the user explicitly confirms via “Feed anyway”,
  // so the feed never silently proceeds against an expired bag.
  useEffect(() => {
    onSelectBag(selectedExpired && !expiryConfirmed ? null : selectedId);
  }, [selectedId, selectedExpired, expiryConfirmed, onSelectBag]);

  // Pre-select the auto-suggested bag once options are available.
  useEffect(() => {
    if (!selectedId && suggestedId && options.length > 0) {
      setSelectedId(suggestedId);
    }
  }, [suggestedId, options.length, selectedId]);

  // No available bags → zero UI change.
  if (options.length === 0) return null;

  const dayLabel = t('Day');
  const nightLabel = t('Night');

  const optionLabel = (bag: MilkBagDTO): string => {
    const base = bagOptionLabel(bag, dayLabel, nightLabel);
    const expiry = computeExpiryDate(bag, freezerType);
    return expiry ? `${base} — ${t('Expires')} ${expiry}` : base;
  };

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="form-label mb-2 flex w-full items-center justify-between text-left"
        disabled={disabled}
        aria-expanded={open}
      >
        {t('From bag')}
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="mt-2">
          <Select
            value={selectedId ?? ''}
            onValueChange={(value) => setSelectedId(value || null)}
            disabled={disabled}
          >
            <SelectTrigger className="w-full" aria-label={t('Bag')}>
              <SelectValue placeholder={t('Auto-suggested')} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => {
                const bag = bags.find((b) => b.id === option.id);
                return bag ? (
                  <SelectItem key={option.id} value={option.id}>
                    {optionLabel(bag)}
                  </SelectItem>
                ) : null;
              })}
            </SelectContent>
          </Select>
          {selectedExpired && !expiryConfirmed && (
            <div className="milkbag-expiry-warning mt-2 space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
              <p className="milkbag-expiry-warning-text text-sm font-medium">
                {t('This bag is past its use-by time. The feed will not use this bag unless you confirm.')}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setExpiryConfirmed(true)}
                disabled={disabled}
              >
                {t('Feed anyway')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
