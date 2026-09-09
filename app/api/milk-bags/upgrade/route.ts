/**
 * POST /api/milk-bags/upgrade  — guided convert-to-bags (issue #13).
 *
 * Computes the legacy breast-milk balance for a family/baby, lets the
 * user split it into bags, and records a negative BreastMilkAdjustment
 * to decrement the legacy total by the bagged amount.
 *
 * On first-pass (no discardLeftover), returns 409 with leftoverMl so the
 * UI can show a "discard leftover X?" confirmation. On second-pass with
 * discardLeftover=true, performs the full conversion.
 */
import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../db';
import { withAuthContext, AuthResult } from '../../utils/auth';
import { toUTC } from '../../utils/timezone';
import { checkWritePermission } from '../../utils/writeProtection';
import { rowToMilkBagDTO, computeBagDayNight, mapUpgradeInput, convertLegacyToOz } from '@/src/utils/milkBagApi';
import { MilkBagUpgradeRequest, MilkBagsResponse } from '@/src/types/milk-bag';
import { inventoryTotals, convertLegacyBalance } from '@/src/utils/milk-bag-rules';
import { loadMilkBagSettings } from '@/src/utils/milk-bag-settings';
import { toMl } from '@/src/utils/unit-conversion';
import type { LegacyBagInput } from '@/src/utils/milk-bag-rules';
import { fetchLegacyBalance } from '../../utils/milkBalance';

/* ------------------------------------------------------------------ */

async function handlePost(req: NextRequest, authContext: AuthResult) {
 const writeCheck = checkWritePermission(authContext);
 if (!writeCheck.allowed) {
  return writeCheck.response!;
 }

 try {
  const { familyId: userFamilyId, caretakerId } = authContext;
  if (!userFamilyId) {
   return NextResponse.json({ success: false, error: 'User is not associated with a family.' }, { status: 403 });
  }

  const body = await req.json() as MilkBagUpgradeRequest;
  const babyId = body.babyId;

  if (!babyId) {
   return NextResponse.json({ success: false, error: 'babyId is required' }, { status: 400 });
  }

  const baby = await prisma.baby.findFirst({
   where: { id: babyId, familyId: userFamilyId },
  });
  if (!baby) {
   return NextResponse.json({ success: false, error: 'Baby not found in this family.' }, { status: 404 });
  }

  const legacyTotalMl = await fetchLegacyBalance(prisma, babyId, userFamilyId);
  if (legacyTotalMl <= 0) {
   return NextResponse.json({ success: false, error: 'No legacy milk balance to convert.' }, { status: 400 });
  }

  const loaded = await loadMilkBagSettings(prisma, userFamilyId);
  const bagsInput = body.bags;
  if (!bagsInput || bagsInput.length === 0) {
   return NextResponse.json({ success: false, error: 'No bags specified for conversion.' }, { status: 400 });
  }

  // Map to LegacyBagInput for convertLegacyBalance validation
  const legacyBags: LegacyBagInput[] = mapUpgradeInput(body).bagInput;

  const conversionResult = convertLegacyBalance(legacyTotalMl, legacyBags);
  if (!conversionResult.ok) {
   return NextResponse.json(
    { success: false, error: `Conversion failed: ${conversionResult.reason}` },
    { status: 422 },
   );
  }

  const leftoverMl = conversionResult.leftoverMl;

  // First-pass: return leftover for UI confirmation
  if (leftoverMl > 0 && !body.discardLeftover) {
   return NextResponse.json(
    { success: false, error: 'leftover', data: { leftoverMl } },
    { status: 409 },
   );
  }

  // Create bags + adjustment in one transaction
  const newBagIds: string[] = [];
  await prisma.$transaction(async (tx) => {
   for (const bag of bagsInput) {
    const baggedAt = toUTC(bag.baggedAt);
    const dayNight = bag.dayNight ?? computeBagDayNight(baggedAt, {
     dayStartHour: loaded.settings.dayStartHour,
     dayEndHour: loaded.settings.dayEndHour,
    });
    const storageLocation = bag.storageLocation ?? 'freezer';

    const created = await tx.milkBag.create({
     data: {
      babyId, familyId: userFamilyId, caretakerId: caretakerId ?? null,
      amount: bag.amount, unitAbbr: 'OZ', dayNight,
      storageLocation, provenance: 'fresh', startedAt: baggedAt, label: bag.label ?? null,
     },
    });
    newBagIds.push(created.id);
   }

   const totalBaggedOz = bagsInput.reduce(
    (s: number, b: { amount: number }) => s + convertLegacyToOz(b.amount), 0,
   );
   await tx.breastMilkAdjustment.create({
    data: {
     babyId, familyId: userFamilyId, caretakerId: caretakerId ?? null,
     time: new Date(),
     amount: -totalBaggedOz,
     unitAbbr: 'OZ', reason: 'Converted to bags',
    },
   });
  });

  // Fetch all bags with pumps for response
  const allBags = await prisma.milkBag.findMany({
   where: { babyId, familyId: userFamilyId, deletedAt: null },
   include: {
    pumps: { where: { deletedAt: null }, select: { id: true, startTime: true, totalAmount: true, unitAbbr: true } },
   },
   orderBy: { startedAt: 'desc' },
  });

  const dtoBags = allBags.map(rowToMilkBagDTO);
  const totals = inventoryTotals(0, dtoBags.map((d) => ({ amountMl: toMl(d.amount, d.unitAbbr), status: d.status })));
  return NextResponse.json({ success: true, data: { bags: dtoBags, totals } });
 } catch (err: any) {
  console.error('Error upgrading to milk bags:', err);
  return NextResponse.json({ success: false, error: 'Failed to convert to milk bags' }, { status: 500 });
 }
}

export const POST = withAuthContext(handlePost);
