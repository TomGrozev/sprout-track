'use client';

import { useEffect, useMemo, useState } from 'react';
import './milk-bag-inventory-modal.css';
import { Modal, ModalContent } from '@/src/components/ui/modal';
import { ToggleGroup } from '@/src/components/ui/toggle-group';
import { ToggleGroupOption } from '@/src/components/ui/toggle-group/toggle-group.types';
import { useLocalization } from '@/src/context/localization';
import { useToast } from '@/src/components/ui/toast';
import { cn } from '@/src/lib/utils';
import type { StorageLocation } from '@/src/utils/milk-storage';
import type { MilkBagDTO, MilkBagTotals } from '@/src/types/milk-bag';
import { buildBagRow } from '@/src/utils/milkBagInventoryUi';
import { inventoryModalStyles as styles } from './milk-bag-inventory-modal.styles';
import { MilkBagInventoryModalProps } from './milk-bag-inventory-modal.types';
import { authHeaders } from '@/src/utils/authHeaders';


export function MilkBagInventoryModal({
  open,
  onClose,
  bags,
  totals,
  freezerType,
  dateFormat,
  timeFormat,
  timezone,
  onBagsChanged,
}: MilkBagInventoryModalProps) {
  const { t } = useLocalization();
  const { showToast } = useToast();

  const [items, setItems] = useState<MilkBagDTO[]>(bags);
  const [totalsState, setTotalsState] = useState<MilkBagTotals>(totals);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setItems(bags);
      setTotalsState(totals);
      setBusyId(null);
    }
  }, [open, bags, totals]);

  const options = useMemo<ToggleGroupOption<StorageLocation>[]>(
    () => [
      { value: 'room', label: t('Room') },
      { value: 'fridge', label: t('Fridge') },
      { value: 'freezer', label: t('Freezer') },
    ],
    [t],
  );

  const available = useMemo(
    () => items.filter((b) => b.status === 'available'),
    [items],
  );

  const handleLocation = async (bag: MilkBagDTO, to: StorageLocation) => {
    if (to === bag.storageLocation || busyId) return;
    setBusyId(bag.id);
    try {
      const res = await fetch(`/api/milk-bags?id=${encodeURIComponent(bag.id)}`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ storageLocation: to }),
      });
      const payload = await res.json();

      if (!res.ok || !payload.success) {
        // 422 refreeze-block: the route provides the exact copy to surface.
        showToast({
          variant: 'error',
          title: t('Error'),
          message: payload?.error ? t(payload.error) : t('Could not update bag location'),
          duration: 5000,
        });
        return;
      }

      // Apply the committed response (authoritative updated DTO).
      const updated: MilkBagDTO = payload.data;
      setItems((prev) => prev.map((b) => (b.id === bag.id ? updated : b)));
      onBagsChanged?.(items.map((b) => (b.id === bag.id ? updated : b)), totalsState);
    } catch {
      showToast({
        variant: 'error',
        title: t('Error'),
        message: t('Could not update bag location'),
        duration: 5000,
      });
    } finally {
      setBusyId(null);
    }
  };

  const bagCountLabel = t('{count} bags').replace('{count}', String(totalsState.availableBags));

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={t('Milk Bag Inventory')}
      description={t('View your stored milk bags and change where each is kept.')}
    >
      <ModalContent>
        {available.length === 0 ? (
          <p className={cn(styles.empty, 'mbinv-empty')}>{t('No milk bags stored yet')}</p>
        ) : (
          <div className={styles.list}>
            {available.map((bag) => {
              const row = buildBagRow(bag, { freezerType, now: new Date(), dateFormat, timeFormat, timezone });
              return (
                <div key={bag.id} className={cn(styles.row, 'mbinv-row')}>
                  <div className={styles.rowHeader}>
                    <div className={styles.titleWrap}>
                      <span className={cn(styles.title, 'mbinv-title')}>
                        {row.hasLabel ? row.title : `${t(row.dayNight === 'day' ? 'Day' : 'Night')} ${row.volume}`}
                      </span>
                      <span className={cn(styles.volume, 'mbinv-volume')}>{row.volume}</span>
                    </div>
                    <div className={styles.meta}>
                      <span
                        className={cn(
                          styles.badge,
                          row.dayNight === 'day' ? styles.badgeDay : styles.badgeNight,
                        )}
                      >
                        {t(row.dayNight === 'day' ? 'Day' : 'Night')}
                      </span>
                      <span className={cn(styles.badge, row.useBy.expired ? styles.badgeExpired : styles.badgeOk)}>
                        {row.useBy.expired ? t('Expired') : `${t('Expires')} ${row.useBy.detail}`}
                      </span>
                    </div>
                  </div>

                  {row.pumpTimes.length > 0 && (
                    <p className={cn(styles.pumpTimes, 'mbinv-pumpTimes')}>
                      <span className={styles.pumpLabel}>{t('Pump times')}: </span>
                      {row.pumpTimes.join(', ')}
                    </p>
                  )}

                  <div className="space-y-1">
                    <span className={cn(styles.locationLabel, 'mbinv-locationLabel')}>
                      {t('Storage')} · {t(row.location === 'room' ? 'Room' : row.location === 'fridge' ? 'Fridge' : 'Freezer')}
                    </span>
                    <ToggleGroup
                      aria-label={t('Storage')}
                      options={options}
                      value={row.location}
                      onChange={(v) => void handleLocation(bag, v)}
                      disabled={busyId === bag.id}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className={cn(styles.totalRow, 'mbinv-total-row')}>
          <span className={cn(styles.totalLabel, 'mbinv-total-label')}>{t('Total stored')}</span>
          <span className={cn(styles.totalValue, 'mbinv-total-value')}>
            {`${totalsState.availableMl} ml`} · {bagCountLabel}
          </span>
        </div>
      </ModalContent>
    </Modal>
  );
}

export default MilkBagInventoryModal;
