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
import { rowToMilkBagDTO, computeBagDayNight, mapUpgradeInput, adjustmentDebit } from '@/src/utils/milkBagApi';
import { MilkBagUpgradeRequest, MilkBagsResponse } from '@/src/types/milk-bag';
import { inventoryTotals, convertLegacyBalance } from '@/src/utils/milk-bag-rules';
import { loadMilkBagSettings } from '@/src/utils/milk-bag-settings';
import { toMl, convertVolume, normalizeVolumeUnit, type VolumeUnit } from '@/src/utils/unit-conversion';
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

  // Normalize per-bag units; an absent unitAbbr means 'ML' (backward compatible).
  // Unknown units -> 400, mirroring pump-log's normalizeVolumeUnit gate.
  const bagUnits: (VolumeUnit | null)[] = bagsInput.map((b) => {
   if (!b.unitAbbr || !b.unitAbbr.trim()) return 'ML';
   return normalizeVolumeUnit(b.unitAbbr);
  });
  if (bagUnits.some((u) => u === null)) {
   return NextResponse.json({ success: false, error: 'Invalid unit. Supported units are OZ and ML.' }, { status: 400 });
  }
  // All bags must share one unit (the modal always sends a single unit).
  const unit = bagUnits[0] as VolumeUnit;
  if (bagUnits.some((u) => u !== unit)) {
   return NextResponse.json({ success: false, error: 'All bags must use the same unit (OZ or ML).' }, { status: 400 });
  }

  // Map to LegacyBagInput for convertLegacyBalance validation
  const legacyBags: LegacyBagInput[] = mapUpgradeInput(body, unit).bagInput;

  const conversionResult = convertLegacyBalance(legacyTotalMl, legacyBags, {
   allowExceeds: body.allowExceedsTotal === true,
   // Half of the last displayed 2dp digit in the user's unit absorbs the float
   // noise of an OZ round-trip (0.005 ml for ML users ~ preserves exact behavior).
   toleranceMl: convertVolume(0.005, unit, 'ML'),
  });
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
      amount: bag.amount, unitAbbr: unit, dayNight,
      storageLocation, provenance: 'fresh', startedAt: baggedAt, label: bag.label ?? null,
     },
    });
    newBagIds.push(created.id);
   }

   // Debit the legacy balance by the bagged amount, clamped to the legacy total so
   // the legacy balance never goes negative (allowExceeds permits a bagged excess
   // without debiting it). All figures in `unit` — the resolved display unit — so
   // the stored adjustment reads in the same unit the bags are tracked in.
   const baggedInUnit = bagsInput.reduce((s: number, b: { amount: number }) => s + b.amount, 0);
   const legacyTotalU = convertVolume(legacyTotalMl, 'ML', unit);
   const debit = adjustmentDebit(Math.min(baggedInUnit, legacyTotalU), unit);
   await tx.breastMilkAdjustment.create({
    data: {
     babyId, familyId: userFamilyId, caretakerId: caretakerId ?? null,
     time: new Date(),
     amount: debit,
     unitAbbr: unit, reason: 'Converted to bags',
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
