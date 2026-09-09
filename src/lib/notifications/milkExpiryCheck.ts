/**
 * Scheduled milk-bag expiry notification pass (issue #12).
 *
 * For every family with at least one enabled MILK_BAG_EXPIRING preference,
 * loads that family's available (unconsumed) bags and fires a notification for
 * each lead/at-expiry threshold that has come due and not yet been notified.
 *
 * Mirrors the structure of `timerCheck.ts` narrowly: the same preference-query
 * shape, the same per-preference send loop, the same `dispatchTimerPush`
 * web+native dispatcher (which internally handles per-owner native dedup and
 * silently skips unconfigured push platforms), and owner-localized payloads.
 * The per-bag dedup state machine (`milkExpiryDueAlerts` /
 * `advanceExpiryNotifiedAt`) lives in the pure module
 * `src/utils/milkBagExpiryUi.ts` so it is unit-testable without a database.
 */

import prisma from '../../../app/api/db';
import { NotificationEventType } from '@prisma/client';
import { NotificationPayload } from './push';
import { dispatchTimerPush } from './timerDispatch';
import { t, DEFAULT_LANGUAGE } from './i18n';
import { isNotificationsEnabled } from './config';
import { routeForNotification } from './routes';
import { resolvePreferenceOwner, PreferenceOwner } from './preferenceOwner';
import { resolveMilkBagSettings } from '@/src/utils/milk-bag-settings';
import type {
  BagTiming,
  FreezerType,
  StorageLocation,
  Provenance,
} from '@/src/utils/milk-storage';
import {
  milkExpiryDueAlerts,
  advanceExpiryNotifiedAt,
} from '@/src/utils/milkBagExpiryUi';

type MilkPreference = {
  id: string;
  familyId: string | null;
  subscription: {
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    accountId: string | null;
    caretakerId: string | null;
    familyId: string | null;
  } | null;
  baby: {
    id: string;
    familyId: string | null;
    family: { slug: string | null } | null;
  } | null;
};

/**
 * Get the owner's language preference (mirrors timerCheck's getUserLanguage).
 */
async function getUserLanguage(
  accountId: string | null,
  caretakerId: string | null
): Promise<string> {
  if (accountId) {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { language: true },
    });
    return account?.language || DEFAULT_LANGUAGE;
  }
  if (caretakerId) {
    const caretaker = await prisma.caretaker.findUnique({
      where: { id: caretakerId },
      select: { language: true },
    });
    return caretaker?.language || DEFAULT_LANGUAGE;
  }
  return DEFAULT_LANGUAGE;
}

/**
 * Send the milk-expiry push for one bag threshold to this family's opted-in
 * preferences. Each preference row with a real subscription gets its own web
 * push; native push is dispatched once per owner (deduped via `nativeSent`).
 */
async function sendMilkExpiryPush(
  preferences: MilkPreference[],
  args: {
    bagId: string;
    kind: 'lead' | 'expired';
    bagBabyId: string;
    familyId: string;
    familySlug: string | null;
  },
  nativeSent: Set<string>
): Promise<void> {
  const isExpired = args.kind === 'expired';
  for (const preference of preferences) {
    const owner = resolvePreferenceOwner(preference);
    // Only skip when there's truly nothing to send to — same rule as the
    // timer pass (a web preference with no owner ids is still web-pushable;
    // a subscription-less preference with no owner at all is actionless).
    if (!preference.subscription && !owner.caretakerId && !owner.accountId) {
      console.warn(
        `[MilkExpiry] Preference ${preference.id} has no subscription and no owner, skipping`
      );
      continue;
    }

    const language = await getUserLanguage(owner.accountId, owner.caretakerId);
    const payload: NotificationPayload = {
      title: t('notification.milkBags.title', language),
      body: t(
        isExpired
          ? 'notification.milkBags.expired.body'
          : 'notification.milkBags.lead.body',
        language
      ),
      icon: '/sprout-128.png',
      badge: '/sprout-128.png',
      tag: `milk-${args.bagId}-${args.kind}`, // Distinct per bag per threshold
      data: {
        eventType: NotificationEventType.MILK_BAG_EXPIRING,
        babyId: args.bagBabyId,
        familySlug: args.familySlug ?? undefined,
        route: routeForNotification('feed'),
      },
    };

    await dispatchTimerPush({
      subscription: preference.subscription,
      payload,
      eventType: NotificationEventType.MILK_BAG_EXPIRING,
      activityType: null,
      babyId: args.bagBabyId,
      familyId: args.familyId,
      owner,
      nativeSent,
    });
  }
}

/**
 * Run the milk-bag expiry pass and send notifications.
 * @returns Number of notification sends dispatched
 */
export async function checkMilkBagExpirations(): Promise<number> {
  if (!(await isNotificationsEnabled())) {
    console.log('[MilkExpiry] Notifications disabled, skipping milk expiry check');
    return 0;
  }

  console.log('[MilkExpiry] Starting milk bag expiry check...');
  const startTime = Date.now();

  try {
    const milkPreferences = await prisma.notificationPreference.findMany({
      where: {
        eventType: NotificationEventType.MILK_BAG_EXPIRING,
        enabled: true,
      },
      include: {
        subscription: {
          select: {
            id: true,
            endpoint: true,
            p256dh: true,
            auth: true,
            accountId: true,
            caretakerId: true,
            familyId: true,
          },
        },
        baby: {
          select: {
            id: true,
            familyId: true,
            family: { select: { slug: true } },
          },
        },
      },
    });

    if (milkPreferences.length === 0) {
      console.log('[MilkExpiry] No enabled milk expiry preferences found');
      return 0;
    }

    // Group preferences by their resolved family. The preference's own
    // familyId is nullable (familyId nullable rules stand), so fall back to
    // the baby's family, then the subscription's — the same reconciliation
    // the rest of the codebase uses for nullable-family preferences.
    const familyPrefsMap = new Map<string, { prefs: MilkPreference[]; slug: string | null }>();
    for (const preference of milkPreferences) {
      const familyId =
        preference.baby?.familyId ||
        preference.familyId ||
        preference.subscription?.familyId;
      if (!familyId) {
        console.warn(
          `[MilkExpiry] Preference ${preference.id} has no resolvable familyId, skipping`
        );
        continue;
      }
      const group = familyPrefsMap.get(familyId) ?? { prefs: [], slug: null };
      group.prefs.push(preference);
      if (!group.slug) group.slug = preference.baby?.family?.slug ?? null;
      familyPrefsMap.set(familyId, group);
    }

    if (familyPrefsMap.size === 0) {
      console.log('[MilkExpiry] No families with a resolvable milk expiry preference');
      return 0;
    }

    let notificationsSent = 0;
    const now = new Date();

    for (const [familyId, group] of familyPrefsMap.entries()) {
      // Resolve the family's freezer type once (defaults when unset).
      const settingsRow = await prisma.settings.findFirst({
        where: { familyId },
        select: { milkBagSettings: true },
      });
      const freezerType: FreezerType = resolveMilkBagSettings(settingsRow?.milkBagSettings).freezerType;

      const bags = await prisma.milkBag.findMany({
        where: { familyId, status: 'available', deletedAt: null },
        select: {
          id: true,
          babyId: true,
          startedAt: true,
          lastLocationChangedAt: true,
          provenance: true,
          storageLocation: true,
          expiryNotifiedAt: true,
        },
      });

      for (const bag of bags) {
        const timing: BagTiming = {
          startedAt: bag.startedAt,
          lastLocationChangedAt: bag.lastLocationChangedAt,
          provenance: (bag.provenance as Provenance) ?? 'fresh',
          storageLocation: (bag.storageLocation as StorageLocation) ?? 'fridge',
        };

        const due = milkExpiryDueAlerts(timing, freezerType, now, bag.expiryNotifiedAt);
        if (due.length === 0) continue;

        console.log(
          `[MilkExpiry] Bag ${bag.id} has ${due.length} due threshold(s): ${due.map((d) => `${d.kind}@${d.at.toISOString()}`).join(', ')}`
        );

        for (const alert of due) {
          // Fresh per threshold: one owner gets one native push per bag
          // threshold, not one per preference row resolving to that owner.
          const nativeSent = new Set<string>();
          try {
            await sendMilkExpiryPush(
              group.prefs,
              {
                bagId: bag.id,
                kind: alert.kind,
                bagBabyId: bag.babyId,
                familyId,
                familySlug: group.slug,
              },
              nativeSent
            );
            notificationsSent++;
          } catch (error) {
            console.error(`[MilkExpiry] Error sending for bag ${bag.id} (${alert.kind}):`, error);
          }
        }

        // Persist the advanced threshold only after firing, per spec.
        const nextNotified = advanceExpiryNotifiedAt(bag.expiryNotifiedAt, due);
        await prisma.milkBag.update({
          where: { id: bag.id },
          data: { expiryNotifiedAt: nextNotified },
        });
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[MilkExpiry] Milk bag expiry check completed: ${notificationsSent} send(s) dispatched in ${duration}ms`);
    return notificationsSent;
  } catch (error) {
    console.error('[MilkExpiry] Error in checkMilkBagExpirations:', error);
    // Don't throw — this should never block cron execution.
    return 0;
  }
}
