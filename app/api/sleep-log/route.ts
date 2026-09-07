import { NextRequest, NextResponse } from 'next/server';
import prisma from '../db';
import { ApiResponse, SleepLogCreate, SleepLogResponse } from '../types';
import { withAuthContext, AuthResult } from '../utils/auth';
import { toUTC, formatForResponse, calculateDurationMinutes } from '../utils/timezone';
import { checkWritePermission } from '../utils/writeProtection';
import { notifyActivityCreated } from '@/src/lib/notifications/activityHook';
import { DEFAULT_SLEEP_LOCATIONS } from '@/src/constants/sleepLocations';

import {
  applyMove,
  closeOpenSegments,
  normalizeSegmentPayload,
  buildSegmentsFromLegacy,
  type SleepSegmentsShape,
} from '@/src/utils/sleepSegments';

import type { SleepLocationSegmentResponse } from '../types';

/** Prisma interactive-transaction client: the object passed into $transaction callbacks. */
type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Serialized segment rows for a response, ordered the way the DB returned them. */
function serializeSegments(rows: { id: string; location: string; startTime: Date; endTime: Date | null; order: number }[]): SleepLocationSegmentResponse[] {
  return rows.map((row) => ({
    id: row.id,
    location: row.location,
    startTime: formatForResponse(row.startTime) || '',
    endTime: row.endTime ? formatForResponse(row.endTime) : null,
    order: row.order,
  }));
}

/**
  * Replaces or derives the segment timeline inside a transaction:
  * - Client-sent `locationSegments` is validated (400 on malformed) and replaces all rows.
  * - Without client segments: an in-progress sleep's open segment is closed at the
  *   new end time (wake), or a legacy location-only write keeps one segment mirrored.
  * Returns the canonical first-segment location to mirror onto SleepLog.location, or null.
  */
async function applySegmentUpdate(
  tx: TxClient,
  existingSleepLog: { id: string; startTime: Date; endTime: Date | null; location: string | null },
  body: Partial<SleepLogCreate>,
  postedSegments: SleepSegmentsShape | null,
  newEndTimeUTC: Date | null | undefined,
  newStartTimeUTC: Date | undefined,
): Promise<{ mirrorLocation: string | null }> {
  if (postedSegments && postedSegments.length > 0) {
    await persistSegments(tx, existingSleepLog.id, postedSegments);
    // An explicit top-level location write accompanies the timeline when the
    // user edited the primary location (web form sends both): it wins the
    // mirror and the first segment, so the two stay in agreement. Without it,
    // the first segment wins so reinstating an older timeline with a text-only
    // client does not lose the change.
    const firstLocation = body.location !== undefined ? body.location : postedSegments[0].location;
    // A wake time closes the trailing open segment server-side (issue #4):
    // the client may legitimately send an open tail while ending the sleep.
    if (newEndTimeUTC) {
      await tx.sleepLocationSegment.updateMany({
        where: { sleepId: existingSleepLog.id, endTime: null },
        data: { endTime: newEndTimeUTC },
      });
    }
    if (firstLocation !== postedSegments[0].location) {
      await tx.sleepLocationSegment.updateMany({
        where: { sleepId: existingSleepLog.id, startTime: postedSegments[0].startTime },
        data: { location: firstLocation },
      });
    }
    return { mirrorLocation: firstLocation };
  }

  // Ending (or re-timing) a sleep: close whatever is open at the wake time.
  if (newEndTimeUTC && (existingSleepLog.endTime === null || body.startTime)) {
    await tx.sleepLocationSegment.updateMany({
      where: { sleepId: existingSleepLog.id, endTime: null },
      data: { endTime: newEndTimeUTC },
    });
  }

  // Legacy path: a plain location write on a sleep with no segment rows yet
  // keeps the derived single segment in sync so both shapes agree.
  const hasRows = await tx.sleepLocationSegment.count({ where: { sleepId: existingSleepLog.id } });
  if (hasRows === 0) {
    if (body.location !== undefined) {
      const start = (newStartTimeUTC ?? existingSleepLog.startTime).toISOString();
      const end = (newEndTimeUTC ?? (body.endTime === undefined ? existingSleepLog.endTime : null))?.toISOString() ?? null;
      const segments = buildSegmentsFromLegacy(body.location, start, end);
      await persistSegments(tx, existingSleepLog.id, segments);
      return { mirrorLocation: body.location };
    }
    const start = (newStartTimeUTC ?? existingSleepLog.startTime).toISOString();
    const end = (newEndTimeUTC ?? existingSleepLog.endTime)?.toISOString() ?? null;
    const segments = buildSegmentsFromLegacy(existingSleepLog.location, start, end);
    if (segments.length > 0) {
      await persistSegments(tx, existingSleepLog.id, segments);
      return { mirrorLocation: existingSleepLog.location };
    }
  }

  return { mirrorLocation: null };
}

async function persistSegments(tx: TxClient, sleepId: string, segments: SleepSegmentsShape) {
  await tx.sleepLocationSegment.deleteMany({ where: { sleepId } });
  if (segments.length > 0) {
    await tx.sleepLocationSegment.createMany({
      data: segments.map((segment, index) => ({
        sleepId,
        location: segment.location,
        startTime: toUTC(segment.startTime),
        endTime: segment.endTime ? toUTC(segment.endTime) : null,
        order: index,
      })),
    });
  }
}

async function handlePost(req: NextRequest, authContext: AuthResult) {
  // Check write permissions for expired accounts
  const writeCheck = checkWritePermission(authContext);
  if (!writeCheck.allowed) {
    return writeCheck.response!;
  }

  try {
    const { familyId: userFamilyId, caretakerId } = authContext;
    if (!userFamilyId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'User is not associated with a family.' }, { status: 403 });
    }

    const body: SleepLogCreate = await req.json();

    const baby = await prisma.baby.findFirst({
      where: { id: body.babyId, familyId: userFamilyId },
    });

    if (!baby) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Baby not found in this family.' }, { status: 404 });
    }

    // Convert times to UTC for storage
    const startTimeUTC = toUTC(body.startTime);
    const endTimeUTC = body.endTime ? toUTC(body.endTime) : null;

    // Calculate duration if both start and end times are present
    const duration = endTimeUTC ? calculateDurationMinutes(startTimeUTC, endTimeUTC) : undefined;
    // Client-sent segments are validated before anything is written (400 on failure).
    let postedSegments: SleepSegmentsShape | null = null;
    if (body.locationSegments !== undefined) {
      const normalized = normalizeSegmentPayload(body.locationSegments);
      if (!normalized.valid) {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: normalized.error }, { status: 400 });
      }
      postedSegments = normalized.segments;
    }

    // location above mirrors the first segment so single-location reads/reports
    // (usage counts, rename propagation) keep working unchanged.
    const mirrorLocation = postedSegments ? postedSegments[0].location : (body.location ?? null);

    // Interactive transaction: the client's tx param is a subset of the client
    // (no $on/$connect/... methods), hence the structural TxClient type.
    const { sleepLog, segmentRows } = await prisma.$transaction(async (tx: TxClient) => {
      const created = await tx.sleepLog.create({
        data: {
          // locationSegments was validated/consumed above; it must not reach the
          // Prisma create input (its nested-write shape differs).
          babyId: body.babyId,
          type: body.type,
          location: mirrorLocation,
          quality: body.quality,
          notes: body.notes,
          startTime: startTimeUTC,
          ...(endTimeUTC && { endTime: endTimeUTC }),
          duration,
          caretakerId: caretakerId,
          familyId: userFamilyId,
        },
      });

      // Client segments win; otherwise derive the single segment from the location.
      const segments = postedSegments ?? buildSegmentsFromLegacy(
        body.location ?? null,
        startTimeUTC.toISOString(),
        endTimeUTC?.toISOString() ?? null,
      );
      if (segments.length > 0) {
        await tx.sleepLocationSegment.deleteMany({ where: { sleepId: created.id } });
        await tx.sleepLocationSegment.createMany({
          data: segments.map((segment, index) => ({
            sleepId: created.id,
            location: segment.location,
            startTime: toUTC(segment.startTime),
            endTime: segment.endTime ? toUTC(segment.endTime) : null,
            order: index,
          })),
        });
      }

      const rows = segments.length > 0
        ? serializeSegments(await tx.sleepLocationSegment.findMany({
          where: { sleepId: created.id },
          orderBy: [{ startTime: 'asc' }, { order: 'asc' }],
        }))
        : [];
      return { sleepLog: created, segmentRows: rows };
    });

    // Format dates as ISO strings for response
    const response: SleepLogResponse = {
      ...sleepLog,
      locationSegments: segmentRows,
      startTime: formatForResponse(sleepLog.startTime) || '',
      endTime: formatForResponse(sleepLog.endTime) || null,
      createdAt: formatForResponse(sleepLog.createdAt) || '',
      updatedAt: formatForResponse(sleepLog.updatedAt) || '',
      deletedAt: formatForResponse(sleepLog.deletedAt),
    };
    // Notify subscribers about activity creation (non-blocking)
    notifyActivityCreated(sleepLog.babyId, 'sleep', { accountId: authContext.accountId, caretakerId: authContext.caretakerId }, { type: body.type }).catch(console.error);
    return NextResponse.json<ApiResponse<SleepLogResponse>>({
      success: true,
      data: response,
    });
  } catch (error) {
    console.error('Error creating sleep log:', error);
    return NextResponse.json<ApiResponse<SleepLogResponse>>(
      {
        success: false,
        error: 'Failed to create sleep log',
      },
      { status: 500 }
    );
  }
}

async function handlePut(req: NextRequest, authContext: AuthResult) {
  // Check write permissions for expired accounts
  const writeCheck = checkWritePermission(authContext);
  if (!writeCheck.allowed) {
    return writeCheck.response!;
  }

  try {
    const { familyId: userFamilyId } = authContext;
    if (!userFamilyId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'User is not associated with a family.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const body: Partial<SleepLogCreate> = await req.json();

    if (!id) {
      return NextResponse.json<ApiResponse<SleepLogResponse>>(
        {
          success: false,
          error: 'Sleep log ID is required',
        },
        { status: 400 }
      );
    }

    const existingSleepLog = await prisma.sleepLog.findFirst({
      where: { id, familyId: userFamilyId },
    });

    if (!existingSleepLog) {
      return NextResponse.json<ApiResponse<SleepLogResponse>>(
        {
          success: false,
          error: 'Sleep log not found or access denied',
        },
        { status: 404 }
      );
    }

    // Convert times to UTC for storage
    const startTimeUTC = body.startTime ? toUTC(body.startTime) : undefined;
    const endTimeUTC = body.endTime ? toUTC(body.endTime) : undefined;

    // Calculate duration if end time is provided
    const duration = endTimeUTC
      ? calculateDurationMinutes(startTimeUTC || existingSleepLog.startTime, endTimeUTC)
      : undefined;

    // Client-sent segments are validated before anything is written (400 on failure).
    // locationSegments is consumed by applySegmentUpdate and must not reach the
    // Prisma update input (nested-write shape differs).
    const { locationSegments: _postedLocationSegments, ...restBody } = body;
    let postedSegments: SleepSegmentsShape | null = null;
    if (_postedLocationSegments !== undefined) {
      const normalized = normalizeSegmentPayload(_postedLocationSegments);
      if (!normalized.valid) {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: normalized.error }, { status: 400 });
      }
      postedSegments = normalized.segments;
    }
    const { sleepLog, segmentRows } = await prisma.$transaction(async (tx: TxClient) => {
      const updated = await tx.sleepLog.update({
        where: { id },
        data: {
          ...restBody,
          ...(startTimeUTC && { startTime: startTimeUTC }),
          ...(endTimeUTC && { endTime: endTimeUTC }),
          ...(duration !== undefined && { duration }),
        },
      });

      const { mirrorLocation } = await applySegmentUpdate(
        tx,
        existingSleepLog,
        restBody as Partial<SleepLogCreate>,
        postedSegments,
        endTimeUTC,
        startTimeUTC,
      );
      if (mirrorLocation) {
        await tx.sleepLog.update({ where: { id }, data: { location: mirrorLocation } });
      }

      const rows = await tx.sleepLocationSegment.findMany({
        where: { sleepId: id },
        orderBy: [{ startTime: 'asc' }, { order: 'asc' }],
      });
      return { sleepLog: updated, segmentRows: serializeSegments(rows) };
    });

    // Notify when baby wakes up (endTime set for the first time)
    if (endTimeUTC && !existingSleepLog.endTime) {
      notifyActivityCreated(sleepLog.babyId, 'wake', { accountId: authContext.accountId, caretakerId: authContext.caretakerId }, { duration }).catch(console.error);
    }

    // Format dates as ISO strings for response
    const response: SleepLogResponse = {
      ...sleepLog,
      locationSegments: segmentRows,
      startTime: formatForResponse(sleepLog.startTime) || '',
      endTime: formatForResponse(sleepLog.endTime) || null,
      createdAt: formatForResponse(sleepLog.createdAt) || '',
      updatedAt: formatForResponse(sleepLog.updatedAt) || '',
      deletedAt: formatForResponse(sleepLog.deletedAt),
    };

    return NextResponse.json<ApiResponse<SleepLogResponse>>({
      success: true,
      data: response,
    });
  } catch (error) {
    console.error('Error updating sleep log:', error);
    return NextResponse.json<ApiResponse<SleepLogResponse>>(
      {
        success: false,
        error: 'Failed to update sleep log',
      },
      { status: 500 }
    );
  }
}

async function handleGet(req: NextRequest, authContext: AuthResult) {
  try {
    const { familyId: userFamilyId } = authContext;
    if (!userFamilyId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'User is not associated with a family.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const babyId = searchParams.get('babyId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const locations = searchParams.get('locations');

    // If locations flag is present, return unique custom locations
    if (locations === 'true') {
      const defaultLocations = DEFAULT_SLEEP_LOCATIONS;

      const sleepLogs = await prisma.sleepLog.findMany({
        where: {
          familyId: userFamilyId,
          location: {
            not: null
          },
          deletedAt: null,
        },
        distinct: ['location'],
        select: {
          location: true
        }
      });

      // Include custom names persisted in settings (added via the manager
      // before any sleep entry uses them)
      const settings = await prisma.settings.findFirst({
        where: { familyId: userFamilyId },
        orderBy: { updatedAt: 'desc' },
      });
      let persistedLocations: string[] = [];
      const rawLocationSettings = (settings as unknown as { sleepLocationSettings?: string } | null)?.sleepLocationSettings;
      if (rawLocationSettings) {
        try {
          const parsed = JSON.parse(rawLocationSettings);
          if (Array.isArray(parsed.customLocations)) {
            persistedLocations = parsed.customLocations;
          }
        } catch {
          // ignore malformed settings
        }
      }

      const uniqueLocations = Array.from(new Set([
        ...sleepLogs.map(log => log.location),
        ...persistedLocations,
      ]))
        .filter((location): location is string => location !== null && location.trim() !== '')
        .filter(location => !defaultLocations.some(
          def => def.toLowerCase() === location.toLowerCase()
        ));

      return NextResponse.json<ApiResponse<string[]>>({
        success: true,
        data: uniqueLocations
      });
    }

    const queryParams: any = {
      familyId: userFamilyId,
      ...(babyId && { babyId }),
      ...(startDate && endDate && {
        startTime: {
          gte: toUTC(startDate),
          lte: toUTC(endDate),
        },
      }),
    };

    if (id) {
      const sleepLog = await prisma.sleepLog.findFirst({
        where: {
          id,
          familyId: userFamilyId,
        },
        include: {
          locationSegments: {
            orderBy: [{ startTime: 'asc' }, { order: 'asc' }],
          },
        },
      });

      if (!sleepLog) {
        return NextResponse.json<ApiResponse<SleepLogResponse>>(
          {
            success: false,
            error: 'Sleep log not found or access denied',
          },
          { status: 404 }
        );
      }

      // Format dates as ISO strings for response
      const response: SleepLogResponse = {
        ...sleepLog,
        locationSegments: serializeSegments(sleepLog.locationSegments),
        startTime: formatForResponse(sleepLog.startTime) || '',
        endTime: formatForResponse(sleepLog.endTime) || null,
        createdAt: formatForResponse(sleepLog.createdAt) || '',
        updatedAt: formatForResponse(sleepLog.updatedAt) || '',
        deletedAt: formatForResponse(sleepLog.deletedAt),
      };

      return NextResponse.json<ApiResponse<SleepLogResponse>>({
        success: true,
        data: response,
      });
    }

    const sleepLogs = await prisma.sleepLog.findMany({
      where: queryParams,
      orderBy: {
        startTime: 'desc',
      },
      include: {
        locationSegments: {
          orderBy: [{ startTime: 'asc' }, { order: 'asc' }],
        },
      },
    });

    // Format dates as ISO strings for response
    const response: SleepLogResponse[] = sleepLogs.map(sleepLog => ({
      ...sleepLog,
      locationSegments: serializeSegments(sleepLog.locationSegments),
      startTime: formatForResponse(sleepLog.startTime) || '',
      endTime: formatForResponse(sleepLog.endTime) || null,
      createdAt: formatForResponse(sleepLog.createdAt) || '',
      updatedAt: formatForResponse(sleepLog.updatedAt) || '',
      deletedAt: formatForResponse(sleepLog.deletedAt),
    }));

    return NextResponse.json<ApiResponse<SleepLogResponse[]>>({
      success: true,
      data: response,
    });
  } catch (error) {
    console.error('Error fetching sleep logs:', error);
    return NextResponse.json<ApiResponse<SleepLogResponse[]>>(
      {
        success: false,
        error: 'Failed to fetch sleep logs',
      },
      { status: 500 }
    );
  }
}

async function handleDelete(req: NextRequest, authContext: AuthResult) {
  // Check write permissions for expired accounts
  const writeCheck = checkWritePermission(authContext);
  if (!writeCheck.allowed) {
    return writeCheck.response!;
  }

  try {
    const { familyId: userFamilyId } = authContext;
    if (!userFamilyId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'User is not associated with a family.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json<ApiResponse<void>>(
        {
          success: false,
          error: 'Sleep log ID is required',
        },
        { status: 400 }
      );
    }

    const existingSleepLog = await prisma.sleepLog.findFirst({
      where: { id, familyId: userFamilyId },
    });

    if (!existingSleepLog) {
      return NextResponse.json<ApiResponse<void>>(
        {
          success: false,
          error: 'Sleep log not found or access denied',
        },
        { status: 404 }
      );
    }

    await prisma.sleepLog.delete({
      where: { id },
    });

    return NextResponse.json<ApiResponse<void>>({
      success: true,
    });
  } catch (error) {
    console.error('Error deleting sleep log:', error);
    return NextResponse.json<ApiResponse<void>>(
      {
        success: false,
        error: 'Failed to delete sleep log',
      },
      { status: 500 }
    );
  }
}

// Apply authentication middleware to all handlers
// Use type assertions to handle the multiple return types
export const GET = withAuthContext(handleGet as (req: NextRequest, authContext: AuthResult) => Promise<NextResponse<ApiResponse<any>>>);
export const POST = withAuthContext(handlePost as (req: NextRequest, authContext: AuthResult) => Promise<NextResponse<ApiResponse<any>>>);
export const PUT = withAuthContext(handlePut as (req: NextRequest, authContext: AuthResult) => Promise<NextResponse<ApiResponse<any>>>);
export const DELETE = withAuthContext(handleDelete as (req: NextRequest, authContext: AuthResult) => Promise<NextResponse<ApiResponse<any>>>);
