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

import { POST, PUT } from '../app/api/feed-log/route';
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

function putRequest(id: string, body: unknown) {
 return new NextRequest(`http://localhost/api/feed-log?id=${id}`, {
  method: 'PUT',
  headers: { Authorization: authHeader(), 'content-type': 'application/json' },
  body: JSON.stringify(body),
 });
}

// Full record the PUT path reads via findUnique (it must belong to fam-1).
const EXISTING_LOG = {
 id: 'feed-1',
 familyId: 'fam-1',
 babyId: 'baby-1',
 type: 'BOTTLE',
 bottleType: 'Breast Milk',
 amount: 2,
 unitAbbr: 'OZ',
 milkBagId: 'bag-1',
 time: new Date('2026-09-09T10:00:00.000Z'),
 createdAt: new Date('2026-09-09T10:00:00.000Z'),
 updatedAt: new Date('2026-09-09T10:00:00.000Z'),
 deletedAt: null,
};

// Prime the PUT path: findUnique feeds the existing feed log, update returns it
// merged with the new data (mirroring how create resolves inside primeBag).
function primeExistingLog(log: Record<string, unknown> = EXISTING_LOG) {
 mocks.prisma.feedLog.findUnique.mockResolvedValue(log);
 mocks.prisma.feedLog.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
  ...EXISTING_LOG,
  ...data,
  time: EXISTING_LOG.time,
  createdAt: EXISTING_LOG.createdAt,
  updatedAt: EXISTING_LOG.updatedAt,
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

describe('feed-log PUT bag-source editing (issue #13)', () => {
 beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = JWT_SECRET;
  delete process.env.DEPLOYMENT_MODE;
 });

 it('switching bag restores the old bag and consumes the new one transactionally', async () => {
  primeExistingLog(); // existing feed log on bag-1
  primeBag({ id: 'bag-2' }); // new bag-2 lookup (baby-1, available, 90 ml)
  const res = await PUT(putRequest('feed-1', {
   milkBagId: 'bag-2', amount: 2, unitAbbr: 'OZ', bottleType: 'Breast Milk',
  }));
  const body = await json(res);

  expect(res.status).toBe(200);
  expect(body.success).toBe(true);

  // feed-log update carries the new bag id and runs inside the transaction
  expect(mocks.prisma.feedLog.update).toHaveBeenCalledTimes(1);
  expect(mocks.prisma.feedLog.update.mock.calls[0][0].data.milkBagId).toBe('bag-2');

  // exactly two milk-bag writes: restore old (index 0), consume new (index 1)
  expect(mocks.prisma.milkBag.update).toHaveBeenCalledTimes(2);
  const restoreArgs = mocks.prisma.milkBag.update.mock.calls[0][0];
  const consumeArgs = mocks.prisma.milkBag.update.mock.calls[1][0];
  expect(restoreArgs.where).toEqual({ id: 'bag-1' });
  expect(restoreArgs.data).toEqual({ status: 'available', usedAt: null, discardedAmount: null });
  expect(consumeArgs.where).toEqual({ id: 'bag-2' });
  expect(consumeArgs.data.status).toBe('used');
 });

 it('empty milkBagId unlinks: restores the previous bag and clears the source', async () => {
  primeExistingLog(); // existing feed log on bag-1
  const res = await PUT(putRequest('feed-1', { milkBagId: '' }));
  const body = await json(res);

  expect(res.status).toBe(200);
  expect(body.success).toBe(true);
  expect(mocks.prisma.feedLog.update).toHaveBeenCalledTimes(1);
  expect(mocks.prisma.feedLog.update.mock.calls[0][0].data.milkBagId).toBeNull();
  expect(mocks.prisma.milkBag.update).toHaveBeenCalledTimes(1);
  const restoreArgs = mocks.prisma.milkBag.update.mock.calls[0][0];
  expect(restoreArgs.where).toEqual({ id: 'bag-1' });
  expect(restoreArgs.data).toEqual({ status: 'available', usedAt: null, discardedAmount: null });
 });

 it('same bag id is a no-op for the bag: only other fields update', async () => {
  primeExistingLog(); // existing feed log already on bag-1
  const res = await PUT(putRequest('feed-1', { milkBagId: 'bag-1', amount: 3 }));
  const body = await json(res);

  expect(res.status).toBe(200);
  expect(body.success).toBe(true);
  expect(mocks.prisma.milkBag.update).not.toHaveBeenCalled();
  expect(mocks.prisma.feedLog.update).toHaveBeenCalledTimes(1);
  expect(mocks.prisma.feedLog.update.mock.calls[0][0].data.amount).toBe(3);
  expect(mocks.prisma.feedLog.update.mock.calls[0][0].data).not.toHaveProperty('milkBagId');
 });

 it('body without milkBagId leaves the bag untouched', async () => {
  primeExistingLog(); // existing feed log on bag-1
  const res = await PUT(putRequest('feed-1', { amount: 3 }));
  const body = await json(res);

  expect(res.status).toBe(200);
  expect(body.success).toBe(true);
  expect(mocks.prisma.milkBag.update).not.toHaveBeenCalled();
  expect(mocks.prisma.feedLog.update).toHaveBeenCalledTimes(1);
  expect(mocks.prisma.feedLog.update.mock.calls[0][0].data.amount).toBe(3);
 });

 it('rejects a new bag that belongs to a different baby', async () => {
  primeExistingLog();
  primeBag({ id: 'bag-2', babyId: 'baby-2' });
  const res = await PUT(putRequest('feed-1', { milkBagId: 'bag-2' }));
  const body = await json(res);

  expect(res.status).toBe(422);
  expect(body.error).toBe('Milk bag belongs to a different baby.');
  expect(mocks.prisma.milkBag.update).not.toHaveBeenCalled();
  expect(mocks.prisma.feedLog.update).not.toHaveBeenCalled();
 });

 it('rejects a new bag already consumed', async () => {
  primeExistingLog();
  primeBag({ id: 'bag-2', status: 'used' });
  const res = await PUT(putRequest('feed-1', { milkBagId: 'bag-2' }));
  const body = await json(res);

  expect(res.status).toBe(422);
  expect(body.error).toBe('Bag already consumed.');
  expect(mocks.prisma.milkBag.update).not.toHaveBeenCalled();
  expect(mocks.prisma.feedLog.update).not.toHaveBeenCalled();
 });

 it('rejects a non-existent bag id', async () => {
  primeExistingLog();
  mocks.prisma.milkBag.findFirst.mockResolvedValue(null);
  const res = await PUT(putRequest('feed-1', { milkBagId: 'bag-2' }));
  const body = await json(res);

  expect(res.status).toBe(404);
  expect(body.error).toBe('Bag not found.');
  expect(mocks.prisma.milkBag.update).not.toHaveBeenCalled();
  expect(mocks.prisma.feedLog.update).not.toHaveBeenCalled();
 });
});
