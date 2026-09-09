/**
 * GET  /api/milk-bags?babyId=    — list family bags (scoped, sorted desc) + totals
 * POST /api/milk-bags             — create a milk bag
 * PATCH/ api/milk-bags?id=        — update a milk bag (location move, label, dayNight)
 */
import { NextRequest, NextResponse } from 'next/server';
import prisma from '../db';
import { ApiResponse } from '../types';
import { withAuthContext, AuthResult } from '../utils/auth';
import { toUTC, formatForResponse } from '../utils/timezone';
import { checkWritePermission } from '../utils/writeProtection';
import { rowToMilkBagDTO, validateCreateRequest, validateUpdateRequest, computeBagDayNight } from '@/src/utils/milkBagApi';
import { inventoryTotals } from '@/src/utils/milk-bag-rules';
import { applyLocationChange } from '@/src/utils/milk-storage';
import { loadMilkBagSettings } from '@/src/utils/milk-bag-settings';
import { calculateBreastMilkBalance } from '@/src/utils/breastMilkInventory';
import { toMl } from '@/src/utils/unit-conversion';
import type { MilkBagsResponse } from '@/src/types/milk-bag';

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function buildBagDTO(bag: any, pumpRows: any[]): MilkBagsResponse['bags'][number] {
  return {
    id: bag.id,
    label: bag.label,
    dayNight: bag.dayNight as MilkBagsResponse['bags'][number]['dayNight'],
    storageLocation: bag.storageLocation as MilkBagsResponse['bags'][number]['storageLocation'],
    provenance: bag.provenance as MilkBagsResponse['bags'][number]['provenance'],
    amount: bag.amount,
    unitAbbr: bag.unitAbbr,
    status: bag.status as 'available' | 'used' | 'discarded',
    startedAt: formatForResponse(bag.startedAt) ?? '',
    lastLocationChangedAt: formatForResponse(bag.lastLocationChangedAt),
    usedAt: formatForResponse(bag.usedAt),
    discardedAmount: bag.discardedAmount,
    babyId: bag.babyId,
    pumps: pumpRows.map((p: any) => ({
      id: p.id,
      startTime: formatForResponse(p.startTime) ?? '',
      totalAmount: p.totalAmount,
      unitAbbr: p.unitAbbr,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* GET                                                                  */
/* ------------------------------------------------------------------ */

async function handleGet(req: NextRequest, authContext: AuthResult) {
  try {
    const { familyId: userFamilyId } = authContext;
    if (!userFamilyId) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'User is not associated with a family.' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const babyId = searchParams.get('babyId');

    if (!babyId) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'babyId query parameter is required' },
        { status: 400 }
      );
    }

    // Verify baby belongs to family
    const baby = await prisma.baby.findFirst({
      where: { id: babyId, familyId: userFamilyId },
    });
    if (!baby) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Baby not found in this family.' },
        { status: 404 }
      );
    }

    const bags = await prisma.milkBag.findMany({
      where: { babyId, familyId: userFamilyId, deletedAt: null },
      include: {
        pumps: {
          where: { deletedAt: null },
          select: { id: true, startTime: true, totalAmount: true, unitAbbr: true },
        },
      },
      orderBy: { startedAt: 'desc' },
    });

    const pumpLogs = await prisma.pumpLog.findMany({
      where: { babyId, familyId: userFamilyId, pumpAction: 'STORED', deletedAt: null },
      select: { totalAmount: true, unitAbbr: true, pumpAction: true, milkBagId: true },
    });
    const adjustments = await prisma.breastMilkAdjustment.findMany({
      where: { babyId, familyId: userFamilyId, deletedAt: null },
      select: { amount: true, unitAbbr: true },
    });
    const feedLogs = await prisma.feedLog.findMany({
      where: {
        babyId, familyId: userFamilyId, type: 'BOTTLE',
        bottleType: { in: ['Breast Milk', 'Formula/Breast'] }, deletedAt: null,
      },
      select: { amount: true, unitAbbr: true, bottleType: true, breastMilkAmount: true, sourcePumpId: true, notes: true },
    });
    const legacyTotalMl = calculateBreastMilkBalance({ pumpLogs, adjustments, feedLogs, targetUnit: 'ML' });

    const dtoBags = bags.map((b: any) => buildBagDTO(b, b.pumps));
    const totals = inventoryTotals(legacyTotalMl, dtoBags.map((d) => ({ amountMl: toMl(d.amount, d.unitAbbr), status: d.status })));

    return NextResponse.json<ApiResponse<MilkBagsResponse>>({
      success: true,
      data: { bags: dtoBags, totals },
    });
  } catch {
    console.error('Error listing milk bags');
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to list milk bags' },
      { status: 500 }
    );
  }
}

/* ------------------------------------------------------------------ */
/* POST                                                                 */
/* ------------------------------------------------------------------ */

async function handlePost(req: NextRequest, authContext: AuthResult) {
  const writeCheck = checkWritePermission(authContext);
  if (!writeCheck.allowed) {
    return writeCheck.response!;
  }

  try {
    const { familyId: userFamilyId, caretakerId } = authContext;
    if (!userFamilyId) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'User is not associated with a family.' },
        { status: 403 }
      );
    }

    const body = await req.json();

    // Validate at least required fields present
    const v = validateCreateRequest(body);
    if (!v.ok) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: v.error },
        { status: 422 }
      );
    }

    // Verify baby belongs to family
    const baby = await prisma.baby.findFirst({
      where: { id: body.babyId, familyId: userFamilyId },
    });
    if (!baby) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Baby not found in this family.' },
        { status: 404 }
      );
    }

    const startedAt = body.startedAt ? toUTC(body.startedAt) : new Date();
    const unitAbbr = body.unitAbbr ? body.unitAbbr.toUpperCase() : 'OZ';
    const storageLocation = (body.storageLocation as 'room' | 'fridge' | 'freezer') ?? 'fridge';

    // Derive dayNight — use family settings if available, else defaults
    const settings = await loadMilkBagSettings(prisma, userFamilyId);
    const dayNight = (body.dayNight as 'day' | 'night') ?? computeBagDayNight(startedAt, { dayStartHour: settings.settings.dayStartHour, dayEndHour: settings.settings.dayEndHour });

    const milkBag = await prisma.milkBag.create({
      data: {
        babyId: body.babyId,
        familyId: userFamilyId,
        caretakerId: caretakerId ?? null,
        label: body.label ?? null,
        dayNight,
        storageLocation,
        provenance: (body.provenance as 'fresh' | 'thawed') ?? 'fresh',
        amount: body.amount,
        unitAbbr,
        startedAt,
      },
    });

    const dto = buildBagDTO(milkBag, []);
    return NextResponse.json<ApiResponse<any>>({ success: true, data: dto });
  } catch (err: any) {
    console.error('Error creating milk bag:', err);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to create milk bag' },
      { status: 500 }
    );
  }
}

/* ------------------------------------------------------------------ */
/* PATCH                                                                */
/* ------------------------------------------------------------------ */

async function handlePatch(req: NextRequest, authContext: AuthResult) {
  const writeCheck = checkWritePermission(authContext);
  if (!writeCheck.allowed) {
    return writeCheck.response!;
  }

  try {
    const { familyId: userFamilyId, caretakerId } = authContext;
    if (!userFamilyId) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'User is not associated with a family.' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'id query parameter is required' },
        { status: 400 }
      );
    }

    const body = await req.json();

    // Validate — at least one field present
    const v = validateUpdateRequest(body);
    if (!v.ok) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: v.error },
        { status: 422 }
      );
    }

    // Fetch bag — scoped to family
    const bag = await prisma.milkBag.findFirst({
      where: { id, familyId: userFamilyId },
    });
    if (!bag) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Milk bag not found or access denied.' },
        { status: 404 }
      );
    }

    const now = new Date();
    const updateData: any = {};

    // Handle storage location change — runs applyLocationChange and persists
    if (body.storageLocation !== undefined && body.storageLocation !== bag.storageLocation) {
      const timing = {
        startedAt: bag.startedAt,
        lastLocationChangedAt: bag.lastLocationChangedAt ?? bag.startedAt,
        provenance: bag.provenance as 'fresh' | 'thawed' | null,
        storageLocation: bag.storageLocation as 'room' | 'fridge' | 'freezer' | null,
      };
      const result = applyLocationChange(timing, body.storageLocation, now);
      if (!result.ok) {
        return NextResponse.json<ApiResponse<null>>(
          { success: false, error: 'Refreezing thawed milk is not recommended - discard or use it instead.' },
          { status: 422 }
        );
      }
      updateData.provenance = result.timing.provenance;
      updateData.storageLocation = result.timing.storageLocation;
      updateData.lastLocationChangedAt = result.timing.lastLocationChangedAt;
    }

    // Persist non-location fields directly
    if (body.label !== undefined) updateData.label = body.label;
    if (body.dayNight !== undefined) updateData.dayNight = body.dayNight;
    if (caretakerId) updateData.caretakerId = caretakerId;

    await prisma.milkBag.update({
      where: { id },
      data: updateData,
    });

    // Fetch updated bag
    const updated = await prisma.milkBag.findFirst({
      where: { id, familyId: userFamilyId },
      include: {
        pumps: {
          where: { deletedAt: null },
          select: { id: true, startTime: true, totalAmount: true, unitAbbr: true },
        },
      },
    });

    if (!updated) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Milk bag not found after update.' },
        { status: 404 }
      );
    }

    const dto = buildBagDTO(updated, updated.pumps);
    return NextResponse.json<ApiResponse<any>>({ success: true, data: dto });
  } catch (err: any) {
    console.error('Error updating milk bag:', err);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to update milk bag' },
      { status: 500 }
    );
  }
}

export const GET = withAuthContext(handleGet);
export const POST = withAuthContext(handlePost);
export const PATCH = withAuthContext(handlePatch);
