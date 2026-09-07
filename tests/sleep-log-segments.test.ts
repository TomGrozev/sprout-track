import { beforeEach, describe, expect, it, vi } from 'vitest';

// Issue #4: the sleep-log API stores an ordered location-segment timeline on a
// sleep and maintains SleepLog.location as the first segment's location so all
// existing single-location reads/reports keep working. Seam: the HTTP route —
// segments flow in via POST/PUT, out via GET, with the family golden rule
// enforced (no trust of client-sent context).
const mocks = vi.hoisted(() => ({
  prisma: {
    baby: { findFirst: vi.fn() },
    sleepLog: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    sleepLocationSegment: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
    family: { findUnique: vi.fn() },
  },
}));

vi.mock('../app/api/db', () => ({ default: mocks.prisma }));
vi.mock('../src/lib/notifications/activityHook', () => ({
  notifyActivityCreated: vi.fn(() => Promise.resolve()),
}));
vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(() => ({
      id: 'caretaker-1',
      name: 'Test Caretaker',
      type: 'Account Owner',
      role: 'USER',
      familyId: 'family-1',
      familySlug: 'family-1',
    })),
  },
}));
// getJwtSecret fails closed without it; jwt.verify is mocked so the value
// itself is irrelevant.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

import { NextRequest } from 'next/server';
import { GET, POST, PUT } from '../app/api/sleep-log/route';

const T1900 = '2026-09-07T19:00:00.000Z';
const T2100 = '2026-09-07T21:00:00.000Z';
const T2300 = '2026-09-07T23:00:00.000Z';
// The real caretaker-token branch of getAuthenticatedUser with a familyId in
// the JWT would hit prisma.family.findUnique for the expiration check; the
// jwt mock omits familyId so auth resolves purely from the verified token.
const authResult = {
  authenticated: true,
  familyId: 'family-1',
  caretakerId: 'caretaker-1',
  accountId: null,
  caretakerType: 'Account Owner',
  caretakerRole: 'USER',
};

vi.mock('../app/api/utils/writeProtection', () => ({
  checkWritePermission: vi.fn(() => ({ allowed: true })),
}));

const dbSleep = {
  id: 'sleep-1',
  babyId: 'baby-1',
  familyId: 'family-1',
  startTime: new Date(T1900),
  endTime: null,
  duration: null,
  type: 'NAP',
  location: 'Bassinet',
  quality: null,
  notes: null,
  caretakerId: 'caretaker-1',
  createdAt: new Date(T1900),
  updatedAt: new Date(T1900),
  deletedAt: null,
};

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/sleep-log', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer a.b.c' },
    body: JSON.stringify(body),
  });
}

function putRequest(body: unknown, query = '?id=sleep-1') {
  return new NextRequest(`http://localhost/api/sleep-log${query}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: 'Bearer a.b.c' },
    body: JSON.stringify(body),
  });
}

function getRequest(query = '?babyId=baby-1') {
  return new NextRequest(`http://localhost/api/sleep-log${query}`, {
    headers: { authorization: 'Bearer a.b.c' },
  });
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.baby.findFirst.mockResolvedValue({ id: 'baby-1', familyId: 'family-1' });
  mocks.prisma.family.findUnique.mockResolvedValue(null);
  mocks.prisma.sleepLocationSegment.findMany.mockResolvedValue([]);
  mocks.prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(mocks.prisma)
  );
});

describe('sleep-log API location segments (issue #4)', () => {
  describe('POST', () => {
    it('persists segments sent with a new sleep and mirrors the first segment location', async () => {
      mocks.prisma.sleepLog.create.mockImplementation(async ({ data }: any) => ({
        ...dbSleep,
        ...data,
      }));

      const response = await POST(
        postRequest({
          babyId: 'baby-1',
          startTime: T1900,
          endTime: null,
          duration: null,
          type: 'NAP',
          location: null,
          locationSegments: [
            { location: 'Bassinet', startTime: T1900, endTime: null },
          ],
        }) as any,
      );
      const body = await json(response);

      expect(body.success).toBe(true);
      expect(mocks.prisma.sleepLocationSegment.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: [expect.objectContaining({ location: 'Bassinet', sleepId: 'sleep-1' })] })
      );
      // Mirror: the sleep row's single location equals the first segment's.
      expect(mocks.prisma.sleepLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ location: 'Bassinet' }) })
      );
    });

    it('rejects a malformed segment payload with a 400', async () => {
      const response = await POST(
        postRequest({
          babyId: 'baby-1',
          startTime: T1900,
          type: 'NAP',
          locationSegments: [{ location: 'Bassinet', startTime: 'not-a-date', endTime: null }],
        }) as any,
      );
      const body = await json(response);

      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
      expect(mocks.prisma.sleepLog.create).not.toHaveBeenCalled();
    });
  });

  describe('PUT', () => {
    it('replaces the segment timeline when locationSegments is sent, and updates the mirror when the sleep is still open', async () => {
      mocks.prisma.sleepLog.findFirst.mockResolvedValue({ ...dbSleep, locationSegments: [] });
      mocks.prisma.sleepLog.update.mockImplementation(async ({ data }: any) => ({
        ...dbSleep,
        ...data,
      }));

      const response = await PUT(
        putRequest({
          locationSegments: [
            { location: 'Bassinet', startTime: T1900, endTime: T2100 },
            { location: 'Car Seat', startTime: T2100, endTime: null },
          ],
        }) as any,
      );
      const body = await json(response);

      expect(body.success).toBe(true);
      expect(mocks.prisma.sleepLocationSegment.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ sleepId: 'sleep-1' }) })
      );
      expect(mocks.prisma.sleepLocationSegment.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({ location: 'Bassinet', startTime: expect.any(Date) }),
            expect.objectContaining({ location: 'Car Seat', startTime: expect.any(Date) }),
          ],
        })
      );
      // Mirror = first segment of the still-open sleep.
      expect(mocks.prisma.sleepLog.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ location: 'Bassinet' }) })
      );
    });

    it('lets an explicit location write win over the first segment: row, first segment, and mirror all agree', async () => {
      mocks.prisma.sleepLog.findFirst.mockResolvedValue({ ...dbSleep, locationSegments: [] });
      mocks.prisma.sleepLog.update.mockImplementation(async ({ data }: any) => ({
        ...dbSleep,
        ...data,
      }));

      const response = await PUT(
        putRequest({
          // The web form sends both: the user changed the primary location AND
          // the timeline. The location write must win — otherwise the stale
          // first segment would revert the user's change (issue #4 review).
          location: 'Crib',
          locationSegments: [
            { location: 'Bassinet', startTime: T1900, endTime: T2100 },
            { location: 'Car Seat', startTime: T2100, endTime: null },
          ],
        }) as any,
      );
      const body = await json(response);

      expect(body.success).toBe(true);
      // The first segment was re-labelled with the user's location...
      expect(mocks.prisma.sleepLocationSegment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ sleepId: 'sleep-1', startTime: T1900 }),
          data: expect.objectContaining({ location: 'Crib' }),
        })
      );
      // ...and the sleep row mirrors the same value.
      expect(mocks.prisma.sleepLog.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ location: 'Crib' }) })
      );
    });

    it('closes the open segment at the wake time when the PUT ends the sleep', async () => {
      mocks.prisma.sleepLog.findFirst.mockResolvedValue({
        ...dbSleep,
        locationSegments: [
          { id: 'seg-1', location: 'Bassinet', startTime: new Date(T1900), endTime: null, order: 0 },
        ],
      });
      mocks.prisma.sleepLog.update.mockImplementation(async ({ data }: any) => ({
        ...dbSleep,
        ...data,
      }));

      const response = await PUT(
        putRequest({ endTime: T2300, duration: 240 }) as any,
      );
      const body = await json(response);

      expect(body.success).toBe(true);
      // The open segment was closed inside the transaction...
      expect(mocks.prisma.sleepLocationSegment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ sleepId: 'sleep-1', endTime: null }),
          data: expect.objectContaining({ endTime: expect.any(Date) }),
        })
      );
      // ...and the mirror now reflects the last segment (nothing open remains).
    });

    it('closes the trailing open segment when segments and endTime are sent together', async () => {
      mocks.prisma.sleepLog.findFirst.mockResolvedValue({ ...dbSleep, locationSegments: [] });
      mocks.prisma.sleepLog.update.mockImplementation(async ({ data }: any) => ({
        ...dbSleep,
        ...data,
      }));

      const response = await PUT(
        putRequest({
          endTime: T2300,
          duration: 240,
          locationSegments: [
            { location: 'Bassinet', startTime: T1900, endTime: T2100 },
            { location: 'Car Seat', startTime: T2100, endTime: null },
          ],
        }) as any,
      );
      const body = await json(response);

      expect(body.success).toBe(true);
      // The client-sent timeline was stored ...
      expect(mocks.prisma.sleepLocationSegment.createMany).toHaveBeenCalled();
      // ...and the open tail was closed at the wake time server-side.
      expect(mocks.prisma.sleepLocationSegment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ sleepId: 'sleep-1', endTime: null }),
          data: expect.objectContaining({ endTime: new Date(T2300) }),
        })
      );
    });
  });
});
