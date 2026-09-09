import { beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

/**
 * Route-level tests for the feed-log "feed from bag" branch (issue #11):
 * POST /api/feed-log must refuse to consume a milk bag that belongs to a
 * different baby in the same family, must refuse a bag already consumed, and
 * must consume an available same-baby bag single-use with leftover discarded.
 *
 * The real withAuthContext runs — a real JWT is signed and decoded — only the
 * DB (prisma) and the notification hook are mocked.
 */

const mocks = vi.hoisted(() => {
 const delegate = () => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
 });
 return {
  prisma: {
   baby: { findFirst: vi.fn() },
   family: { findUnique: vi.fn().mockResolvedValue(null) },
   milkBag: delegate(),
   feedLog: delegate(),
   $transaction: vi.fn(async (ops: unknown[]) => (Array.isArray(ops) ? Promise.all(ops) : [])),
  },
 };
});

vi.mock('../app/api/db', () => ({ default: mocks.prisma }));
vi.mock('@/src/lib/notifications/activityHook', () => ({
 notifyActivityCreated: vi.fn(() => Promise.resolve()),
 resetTimerNotificationState: vi.fn(() => Promise.resolve()),
}));

import { POST } from '../app/api/feed-log/route';
import { NextRequest } from 'next/server';

const JWT_SECRET = 'test-secret';

function authHeader(): string {
 const token = jwt.sign(
  { id: 'caretaker-1', name: 'Caretaker One', type: 'CARETAKER', role: 'OWNER', familyId: 'fam-1', familySlug: 'fam-1' },
  JWT_SECRET,
 );
 return `Bearer ${token}`;
}

function postRequest(body: unknown) {
 return new NextRequest('http://localhost/api/feed-log', {
  method: 'POST',
  headers: { Authorization: authHeader(), 'content-type': 'application/json' },
  body: JSON.stringify(body),
 });
}

async function json(response: Response) {
 return response.json() as Promise<Record<string, any>>;
}

const FEED_BODY = {
 babyId: 'baby-1',
 time: '2026-09-09T10:00:00.000Z',
 type: 'BOTTLE',
 amount: 2,
 unitAbbr: 'OZ',
 bottleType: 'Breast Milk',
 milkBagId: 'bag-1',
};

function primeBag(bag: Record<string, unknown>) {
 mocks.prisma.baby.findFirst.mockResolvedValue({ id: 'baby-1', familyId: 'fam-1' });
 mocks.prisma.milkBag.findFirst.mockResolvedValue({
  id: 'bag-1',
  babyId: 'baby-1',
  familyId: 'fam-1',
  amount: 90,
  unitAbbr: 'ml',
  status: 'available',
  ...bag,
 });
 mocks.prisma.feedLog.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
  id: 'feed-1',
  ...data,
  time: new Date('2026-09-09T10:00:00.000Z'),
  createdAt: new Date('2026-09-09T10:00:00.000Z'),
  updatedAt: new Date('2026-09-09T10:00:00.000Z'),
  deletedAt: null,
 }));
}

describe('feed-log POST from-bag branch', () => {
 beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = JWT_SECRET;
  delete process.env.DEPLOYMENT_MODE;
 });

 it('rejects a bag belonging to a different baby in the same family', async () => {
  primeBag({ babyId: 'baby-2' });
  const res = await POST(postRequest({ ...FEED_BODY, babyId: 'baby-1' }));
  const body = await json(res);

  expect(res.status).toBe(422);
  expect(body.success).toBe(false);
  expect(body.error).toBe('Milk bag belongs to a different baby.');
  // Nothing consumed, nothing written
  expect(mocks.prisma.milkBag.update).not.toHaveBeenCalled();
  expect(mocks.prisma.feedLog.create).not.toHaveBeenCalled();
 });

 it('rejects a bag already consumed (single-use, no re-consumption)', async () => {
  primeBag({ status: 'used' });
  const res = await POST(postRequest(FEED_BODY));
  const body = await json(res);

  expect(res.status).toBe(422);
  expect(body.success).toBe(false);
  expect(body.error).toBe('Bag already consumed.');
  expect(mocks.prisma.milkBag.update).not.toHaveBeenCalled();
  expect(mocks.prisma.feedLog.create).not.toHaveBeenCalled();
 });

 it('consumes an available same-baby bag single-use and marks it used', async () => {
  primeBag({}); // baby-1, available, 90 ml
  const res = await POST(postRequest({ ...FEED_BODY, amount: 2, unitAbbr: 'OZ' })); // 2 oz ≈ 59.1475 ml
  const body = await json(res);

  expect(res.status).toBe(200);
  expect(body.success).toBe(true);
  expect(body.data.milkBagId).toBe('bag-1');
  expect(body.data.familyId).toBe('fam-1');
  expect(body.data.babyId).toBe('baby-1');

  // Bag update happens in the same transaction as the feed create
  expect(mocks.prisma.milkBag.update).toHaveBeenCalledTimes(1);
  const updateArgs = mocks.prisma.milkBag.update.mock.calls[0][0];
  expect(updateArgs.where).toEqual({ id: 'bag-1' });
  expect(updateArgs.data.status).toBe('used');
  // Leftover (90 ml - 2 oz in ml) is recorded as discarded, in the bag's unit
  const TWO_OZ_ML = 2 * 29.5735295625;
  // Route rounds the discarded volume to 3 decimals; assert the leftover contract to 2.
  expect(updateArgs.data.discardedAmount).toBeCloseTo(90 - TWO_OZ_ML, 2);

  expect(mocks.prisma.feedLog.create).toHaveBeenCalledTimes(1);
 });
});
