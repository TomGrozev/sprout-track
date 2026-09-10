'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './milk-bag-upgrade-modal.css';
import { Modal, ModalContent, ModalFooter } from '@/src/components/ui/modal';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Label } from '@/src/components/ui/label';
import { ToggleGroup } from '@/src/components/ui/toggle-group';
import { ToggleGroupOption } from '@/src/components/ui/toggle-group/toggle-group.types';
import { useLocalization } from '@/src/context/localization';
import { useToast } from '@/src/components/ui/toast';
import { cn } from '@/src/lib/utils';
import { Trash2, Loader2 } from 'lucide-react';
import {
 deriveDayNight,
 DEFAULT_DAY_NIGHT_BOUNDARY,
} from '@/src/utils/milk-bag-rules';
import type { StorageLocation } from '@/src/utils/milk-storage';
import type { DayNight } from '@/src/utils/milk-bag-rules';
import type { MilkBagUpgradeRequest } from '@/src/types/milk-bag';
import {
 rowsToBags,
 computeUpgradeSum,
 setUpgradeMarker,
} from '@/src/utils/milkBagUpgradeUi';
import { normalizeBottleUnit, readCachedDefaultBottleUnit, cacheDefaultBottleUnit, type BottleUnit } from '@/src/utils/defaultBottleUnit';
import { convertVolume } from '@/src/utils/unit-conversion';
import { upgradeModalStyles as styles } from './milk-bag-upgrade-modal.styles';
import {
 MilkBagUpgradeModalProps,
 UpgradeRowState,
 UpgradeModalTexts,
} from './milk-bag-upgrade-modal.types';
import { UpgradeChoiceScreen } from './UpgradeChoiceScreen';
import { UpgradeBagRow } from './UpgradeBagRow';

type Screen = 'choice' | 'convert';

let nextRowId = 1;


import { authHeaders } from '@/src/utils/authHeaders';

/** Snap a Date to local midnight — the DatePicker supplies exactly this. */
const startOfLocalDay = (d: Date) => {
 const x = new Date(d);
 x.setHours(0, 0, 0, 0);
 return x;
};

function makeRow(): UpgradeRowState {
 const now = new Date();
 return {
  id: nextRowId++,
  amount: '',
  baggedDate: startOfLocalDay(now),
  storageLocation: 'freezer',
  dayNight: deriveDayNight(now, DEFAULT_DAY_NIGHT_BOUNDARY.dayStartHour, DEFAULT_DAY_NIGHT_BOUNDARY.dayEndHour),
 };
}

export function MilkBagUpgradeModal({ open, onClose, babyId, onUpgraded }: MilkBagUpgradeModalProps) {
 const { t } = useLocalization();
 const { showToast } = useToast();

 const [screen, setScreen] = useState<Screen>('choice');
 const [rows, setRows] = useState<UpgradeRowState[]>([]);
 const [legacyTotal, setLegacyTotal] = useState<number | null>(null);
 const [balanceLoading, setBalanceLoading] = useState(false);
 const [balanceError, setBalanceError] = useState<string | null>(null);
 const [confirmOpen, setConfirmOpen] = useState(false);
 const [serverLeftover, setServerLeftover] = useState<number | null>(null);
 const [overshootOpen, setOvershootOpen] = useState(false);
 const [submitting, setSubmitting] = useState(false);
 /** Resolved display unit (OZ | ML): preferred from settings, cached fallback. Absent until the settings fetch settles. */
 const [unit, setUnit] = useState<BottleUnit>(() => readCachedDefaultBottleUnit());
 /** Settled once the settings fetch that resolves the unit completes (or fails). */
 const unitResolvedPromiseRef = useRef<Promise<BottleUnit> | null>(null);

 const reset = () => {
  setScreen('choice');
  setRows([makeRow()]);
  setLegacyTotal(null);
  setBalanceLoading(false);
  setBalanceError(null);
  setConfirmOpen(false);
  setServerLeftover(null);
  setOvershootOpen(false);
  setSubmitting(false);
  unitResolvedPromiseRef.current = null;
  setUnit(readCachedDefaultBottleUnit());
 };

  /** Resolve the preferred volume unit: settings default, else localStorage cache. */
  const resolveUnit = useCallback(async (): Promise<BottleUnit> => {
   try {
    const res = await fetch('/api/settings', { cache: 'no-store', headers: authHeaders() });
    const payload = await res.json();
    const server = normalizeBottleUnit(payload?.data?.defaultBottleUnit);
    if (server) cacheDefaultBottleUnit(server);
    const resolved = server ?? readCachedDefaultBottleUnit();
    setUnit(resolved);
    return resolved;
   } catch {
    const resolved = readCachedDefaultBottleUnit();
    setUnit(resolved);
    return resolved;
   }
  }, []);

 useEffect(() => {
  if (!open) {
   reset();
   return;
  }
  if (rows.length === 0) setRows([makeRow()]);
  // Resolve the preferred unit before any balance fetch, so we never load the wrong unit.
  if (!unitResolvedPromiseRef.current) {
   unitResolvedPromiseRef.current = resolveUnit();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [open]);

 const storageOptions = useMemo<ToggleGroupOption<StorageLocation>[]>(
  () => [
   { value: 'room', label: t('Room') },
   { value: 'fridge', label: t('Fridge') },
   { value: 'freezer', label: t('Freezer') },
  ],
  [t],
 );

 const dayNightOptions = useMemo<ToggleGroupOption<DayNight>[]>(
  () => [
   { value: 'day', label: t('Day') },
   { value: 'night', label: t('Night') },
  ],
  [t],
 );

 const sum = useMemo(() => {
  const parsed = rows.map((r) => ({
   amount: parseFloat(r.amount),
   unitAbbr: unit,
  }));

  return computeUpgradeSum(legacyTotal ?? 0, parsed, unit, unit, 0.005);
 }, [rows, legacyTotal, unit]);

 const loadBalance = async () => {
  setBalanceLoading(true);
  setBalanceError(null);
  try {
   const resolvedUnit = unitResolvedPromiseRef.current ? await unitResolvedPromiseRef.current : unit;
   const res = await fetch(`/api/breast-milk-balance?babyId=${encodeURIComponent(babyId)}&unit=${resolvedUnit}`, {
    headers: authHeaders(),
   });
   const payload = await res.json();
   if (!res.ok || !payload.success) {
    setBalanceError(t('Failed to load your milk balance'));
    return;
   }
   setLegacyTotal(typeof payload.data?.balance === 'number' ? payload.data.balance : 0);
  } catch {
   setBalanceError(t('Failed to load your milk balance'));
  } finally {
   setBalanceLoading(false);
  }
 };

 const goConvert = async () => {
  setScreen('convert');
  if (legacyTotal === null) await loadBalance();
 };

 const persistMarker = async () => {
  const getRes = await fetch('/api/settings', { headers: authHeaders() });
  const getPayload = await getRes.json();
  const raw: string | null = getPayload?.data?.milkBagSettings ?? null;
  const blob = setUpgradeMarker(raw, new Date());
  await fetch('/api/settings', {
   method: 'PUT',
   headers: { ...authHeaders(), 'Content-Type': 'application/json' },
   body: JSON.stringify({ milkBagSettings: blob }),
  });
 };

 const handleGoingForward = async () => {
  if (submitting) return;
  setSubmitting(true);
  try {
   await persistMarker();
   onUpgraded?.();
   onClose();
  } catch {
   showToast({ variant: 'error', title: t('Error'), message: t('Failed to save your settings'), duration: 5000 });
  } finally {
   setSubmitting(false);
  }
 };

 const buildRequest = (discardLeftover: boolean, allowExceedsTotal = false): MilkBagUpgradeRequest => ({
  babyId,
  bags: rowsToBags(
   rows.map((r) => ({
    amount: parseFloat(r.amount),
    baggedDate: r.baggedDate,
    storageLocation: r.storageLocation,
    dayNight: r.dayNight,
    unitAbbr: unit,
   })),
  ),
  discardLeftover,
  allowExceedsTotal,
 });

 const submit = async (discardLeftover = false, allowExceedsTotal = false) => {
  setSubmitting(true);
  try {
   const req = buildRequest(discardLeftover, allowExceedsTotal);
   const res = await fetch('/api/milk-bags/upgrade', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
   });
   const payload = await res.json();

   if (res.ok && payload.success) {
    await persistMarker();
    onUpgraded?.();
    onClose();
    return;
   }

   // Backend enforces the leftover rule too — re-surface the confirm dialog.
   if (res.status === 409 && payload.error === 'leftover') {
   const serverMl = typeof payload.data?.leftoverMl === 'number' ? payload.data.leftoverMl : null;
   // Server keeps leftover ML-internal; convert to the display unit for the readout.
   setServerLeftover(serverMl !== null ? convertVolume(serverMl, 'ML', unit) : sum.leftoverMl);
    setConfirmOpen(true);
    return;
   }

   // Backend enforces the bagged total rule too — re-surface the overshoot warning.
   if (res.status === 422 && typeof payload.error === 'string' && payload.error.includes('exceeds')) {
    setOvershootOpen(true);
    return;
   }

   showToast({
    variant: 'error',
    title: t('Error'),
    message: payload.error ? t(payload.error) : t('Failed to convert your balance'),
    duration: 5000,
   });
  } catch {
   showToast({ variant: 'error', title: t('Error'), message: t('Failed to convert your balance'), duration: 5000 });
  } finally {
   setSubmitting(false);
  }
 };

 const handleConvertSubmit = () => {
  if (submitting) return;
  const valid = rows.every((r) => {
   const n = parseFloat(r.amount);
   return Number.isFinite(n) && n > 0 && r.baggedDate instanceof Date && !Number.isNaN(r.baggedDate.getTime());
  });
  if (!valid) {
   showToast({ variant: 'error', title: t('Error'), message: t('Enter a valid amount for each bag'), duration: 5000 });
   return;
  }
  if (sum.exceeds) {
   setOvershootOpen(true);
   return;
  }
  if (sum.leftoverMl > 0) {
   setServerLeftover(null);
   setConfirmOpen(true);
   return;
  }
  void submit(false, false);
 };

 const leftoverToConfirm = serverLeftover ?? sum.leftoverMl;

 const updateRow = (id: number, patch: Partial<UpgradeRowState>) => {
  setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
 };

 const choiceTexts: UpgradeModalTexts = {
  intro: t('Choose how you want to start tracking your milk bags.'),
  goingForwardTitle: t('Track going forward only'),
  goingForwardDesc: t('Start tracking new pump sessions as bags. Your existing balance is left untouched.'),
  convertTitle: t('Convert to bags'),
  convertDesc: t('Turn your existing expressed-milk balance into individual bags you can manage and use.'),
 };

 const rowLabels = {
  bag: t('Bag'),
  remove: t('Remove'),
  amount: t('Amount') + ` (${unit.toLowerCase()})`,
  baggedAt: t('Date'),
  storage: t('Storage'),
  dayNight: t('Day / Night'),
 };

 return (
  <Modal
   open={open}
   onOpenChange={(o) => {
    if (!o) onClose();
   }}
   title={t('Milk bags')}
   description={t('Track expressed milk as bags you can thaw, use and manage.')}
  >
   <ModalContent className="overflow-y-auto max-h-[60vh] pr-2">
    {screen === 'choice' && (
     <UpgradeChoiceScreen
      texts={choiceTexts}
      onConvert={goConvert}
      onGoingForward={handleGoingForward}
      submitting={submitting}
     />
    )}

    {screen === 'convert' && (
     <div className="space-y-4">
      <div className={cn(styles.balanceRow, 'mbupgrade-balanceRow')}>
       <span className={cn(styles.balanceLabel, 'mbupgrade-balanceLabel')}>{t('Legacy balance')}</span>
       <span className={cn(styles.balanceValue, 'mbupgrade-balanceValue')}>
        {balanceLoading ? t('Loading…') : balanceError ? t('Unavailable') : `${legacyTotal ?? 0} ${unit.toLowerCase()}`}
       </span>
      </div>

      {balanceError && (
       <Button variant="outline" size="sm" onClick={loadBalance}>
        {t('Retry')}
       </Button>
      )}

      <div className="space-y-3">
       {rows.length === 0 && (
        <p className="text-sm text-gray-500">{t('No bags yet. Add a bag or go back.')}</p>
       )}
       {rows.map((row) => (
        <UpgradeBagRow
         key={row.id}
         row={row}
         storageOptions={storageOptions}
         dayNightOptions={dayNightOptions}
         onRemove={() => setRows((rs) => rs.filter((r) => r.id !== row.id))}
         onUpdate={(patch) => updateRow(row.id, patch)}
         labels={rowLabels}
        />
       ))}
      </div>

      <Button variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, makeRow()])}>
       {t('Add bag')}
      </Button>

      <div className={cn(styles.readout, 'mbupgrade-readout')}>
       <span className={cn(styles.balanceLabel, 'mbupgrade-balanceLabel')}>{t('Bagged')}</span>
       <span className={cn(styles.readoutValue, 'mbupgrade-readoutValue')}>{Math.round(sum.baggedMl)} {unit.toLowerCase()}</span>
      </div>
      <div className={cn(styles.readout, 'mbupgrade-readout')}>
       <span className={cn(styles.balanceLabel, 'mbupgrade-balanceLabel')}>{t('Leftover')}</span>
       <span className={cn(styles.readoutValue, 'mbupgrade-readoutValue')}>{Math.round(sum.leftoverMl)} {unit.toLowerCase()}</span>
      </div>
      {sum.exceeds && <p className={styles.warn}>{t('The bagged amount exceeds your balance')}</p>}

      {confirmOpen && (
       <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
        <p className="text-sm font-medium text-amber-900">
         {t('Discard leftover {amount} {unit}?').replace('{amount}', String(Math.round(leftoverToConfirm))).replace('{unit}', unit.toLowerCase())}
        </p>
        <p className="text-xs text-amber-800">
         {t('The leftover balance will be recorded as discarded and can no longer be bagged.')}
        </p>
        <div className="flex justify-end gap-2">
         <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)}>
          {t('Cancel')}
         </Button>
         <Button variant="destructive" size="sm" disabled={submitting} onClick={() => void submit(true)}>
          {t('Discard leftover')}
         </Button>
        </div>
       </div>
      )}
      {overshootOpen && (
       <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
        <p className="text-sm font-medium text-amber-900">
         {t('Your bag total is {amount} {unit} more than your recorded balance').replace('{amount}', String(Math.round(sum.exceededMl))).replace('{unit}', unit.toLowerCase())}
        </p>
        <p className="text-xs text-amber-800">
         {t('Bags can still record more than your balance if you want to. The extra amount will not reduce your balance further.')}
        </p>
        <div className="flex justify-end gap-2">
         <Button variant="outline" size="sm" onClick={() => setOvershootOpen(false)}>
          {t('Cancel')}
         </Button>
         <Button variant="destructive" size="sm" disabled={submitting} onClick={() => void submit(false, true)}>
          {t('Proceed')}
         </Button>
        </div>
       </div>
      )}
     </div>
    )}
   </ModalContent>

   <ModalFooter>
    {screen === 'convert' && (
     <>
      <Button variant="ghost" onClick={() => setScreen('choice')} disabled={submitting}>
       {t('Back')}
      </Button>
      <Button onClick={handleConvertSubmit} disabled={submitting || balanceLoading || !!balanceError}>
       {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : t('Convert')}
      </Button>
     </>
    )}
    {screen === 'choice' && (
     <Button variant="ghost" onClick={onClose} disabled={submitting}>
      {t('Cancel')}
     </Button>
    )}
   </ModalFooter>
  </Modal>
 );
}

export default MilkBagUpgradeModal;
