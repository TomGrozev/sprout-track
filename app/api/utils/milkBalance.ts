/**
 * Shared legacy breast-milk balance query used by the milk-bags listing and
 * the guided upgrade route (issue #13): pump (STORED) + adjustments − feed
 * consumption, all resolved to ML. Both routes must stay in lockstep with
 * `calculateBreastMilkBalance`'s input contract.
 */
import { PrismaClient } from '@prisma/client';
import { calculateBreastMilkBalance } from '@/src/utils/breastMilkInventory';

export async function fetchLegacyBalance(
 db: PrismaClient,
 babyId: string,
 familyId: string
): Promise<number> {
 const pumpLogs = await db.pumpLog.findMany({
  where: { babyId, familyId, pumpAction: 'STORED', deletedAt: null },
  select: { totalAmount: true, unitAbbr: true, pumpAction: true, milkBagId: true },
 });
 const adjustments = await db.breastMilkAdjustment.findMany({
  where: { babyId, familyId, deletedAt: null },
  select: { amount: true, unitAbbr: true },
 });
 const feedLogs = await db.feedLog.findMany({
  where: {
   babyId, familyId, type: 'BOTTLE',
   bottleType: { in: ['Breast Milk', 'Formula/Breast'] }, deletedAt: null,
  },
  select: { amount: true, unitAbbr: true, bottleType: true, breastMilkAmount: true, sourcePumpId: true, notes: true },
 });
 return calculateBreastMilkBalance({ pumpLogs, adjustments, feedLogs, targetUnit: 'ML' });
}
