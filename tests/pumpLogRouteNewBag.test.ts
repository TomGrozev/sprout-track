import { beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

/**
 * Route-level tests for the pump-log "new bag" creation branch (issue #9):
 * POST /api/pump-log with newBagDayNight creates a MilkBag inside the same
 * transaction and links the pump; omission falls back to auto-derivation from
 * the family boundary; appended (existing) bags still increment.
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
   settings: { findFirst: vi.fn() },
   milkBag: delegate(),
   pumpLog: delegate(),
   feedLog: delegate(),
   $transaction: vi.fn(),
  },
 };
});

vi.mock('../app/api/db', () => ({ default: mocks.prisma }));
vi.mock('@/src/lib/notifications/activityHook', () => ({
 notifyActivityCreated: vi.fn(() => Promise.resolve()),
 resetTimerNotificationState: vi.fn(() => Promise.resolve()),
}));

import { POST } from '../app/api/pump-log/route';
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
 return new NextRequest('http://localhost/api/pump-log', {
  method: 'POST',
  headers: { Authorization: authHeader(), 'content-type': 'application/json' },
  body: JSON.stringify(body),
 });
}

async function json(response: Response) {
 return response.json() as Promise<Record<string, any>>;
}

/**
 * Transaction pass-through: the route uses prisma.$transaction(fn) where fn
 * receives the same mock delegates (no interactive-commit semantics needed).
 */
function txnPassThrough() {
 mocks.prisma.$transaction.mockImplementation(async (fn: (tx: typeof mocks.prisma) => Promise<unknown>) => fn(mocks.prisma));
}

function primeHappyPath(overrides: Record<string, unknown> = {}) {
 mocks.prisma.baby.findFirst.mockResolvedValue({ id: 'baby-1', familyId: 'fam-1' });
 mocks.prisma.settings.findFirst.mockResolvedValue({
  familyId: 'fam-1',
  enableBreastMilkTracking: true,
  milkBagSettings: JSON.stringify({ dayStartHour: 7, dayEndHour: 19, freezerType: 'separate-door' }),
 });
 mocks.prisma.pumpLog.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
  id: 'pump-1',
  ...data,
  createdAt: new Date('2026-09-09T10:00:00.000Z'),
  updatedAt: new Date('2026-09-09T10:00:00.000Z'),
  deletedAt: null,
 }));
 mocks.prisma.feedLog.create.mockResolvedValue({});
 txnPassThrough();
 Object.assign(mocks.prisma, overrides);
}

const PUMP_BODY = {
 babyId: 'baby-1',
 startTime: '2026-09-09T22:30:00.000Z', // 22:30 UTC -> night under default 07-19 boundary
 endTime: '2026-09-09T22:45:00.000Z',
 totalAmount: 90,
 unitAbbr: 'ml',
 pumpAction: 'STORED',
};

describe('pump-log POST new-bag branch', () => {
 beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = JWT_SECRET;
  delete process.env.DEPLOYMENT_MODE;
 });

 it('creates a bag with the day/night label the form sends and links the pump', async () => {
  primeHappyPath();
  mocks.prisma.milkBag.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
   return { id: 'bag-new', ...data };
  });

  // The form derives the label from the pump start (22:30 local -> night).
  const res = await POST(postRequest({ ...PUMP_BODY, newBagDayNight: 'night' }));
  const body = await json(res);

  expect(res.status).toBe(200);
  expect(body.success).toBe(true);

  expect(mocks.prisma.milkBag.create).toHaveBeenCalledTimes(1);
  const bagData = mocks.prisma.milkBag.create.mock.calls[0][0].data;
  expect(bagData.dayNight).toBe('night');
  expect(bagData.familyId).toBe('fam-1');
  expect(bagData.babyId).toBe('baby-1');
  expect(bagData.amount).toBe(90);

  const pumpData = mocks.prisma.pumpLog.create.mock.calls[0][0].data;
  expect(pumpData.milkBagId).toBe('bag-new');

  // Freshly-created bag must NOT be incremented a second time
  expect(mocks.prisma.milkBag.update).not.toHaveBeenCalled();
 });

 it('stores a day label when the form sends day', async () => {
  primeHappyPath();
  mocks.prisma.milkBag.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'bag-new', ...data }));

  const res = await POST(postRequest({ ...PUMP_BODY, newBagDayNight: 'day' }));
  const body = await json(res);

  expect(res.status).toBe(200);
  const bagData = mocks.prisma.milkBag.create.mock.calls[0][0].data;
  expect(bagData.dayNight).toBe('day');
 });

 it('rejects a new bag with neither valid amount (STORED required, amount > 0)', async () => {
  primeHappyPath();
  const res = await POST(postRequest({ ...PUMP_BODY, totalAmount: 0, newBagDayNight: 'day' }));
  const body = await json(res);
  expect(res.status).toBe(422);
  expect(body.success).toBe(false);
  expect(mocks.prisma.milkBag.create).not.toHaveBeenCalled();

  const resFed = await POST(postRequest({ ...PUMP_BODY, pumpAction: 'DISCARDED', newBagDayNight: 'day' }));
  expect(resFed.status).toBe(422);
  expect(mocks.prisma.milkBag.create).not.toHaveBeenCalled();
 });

 it('rejects specifying both appendToBagId and newBagDayNight', async () => {
  primeHappyPath();
  mocks.prisma.milkBag.findFirst.mockResolvedValue({ id: 'bag-1', babyId: 'baby-1', familyId: 'fam-1', startedAt: new Date('2026-09-09T20:30:00.000Z'), status: 'available', lastLocationChangedAt: null, provenance: 'fresh', storageLocation: 'fridge' });

  const res = await POST(postRequest({ ...PUMP_BODY, appendToBagId: 'bag-1', newBagDayNight: 'day' }));
  const body = await json(res);
  expect(res.status).toBe(422);
  expect(body.success).toBe(false);
  expect(mocks.prisma.milkBag.create).not.toHaveBeenCalled();
 });

 it('appending to an existing bag links and increments, creating no bag', async () => {
  primeHappyPath();
  mocks.prisma.milkBag.findFirst.mockResolvedValue({
   id: 'bag-1',
   babyId: 'baby-1',
   familyId: 'fam-1',
   startedAt: new Date('2026-09-09T20:30:00.000Z'),
   status: 'available',
   lastLocationChangedAt: null,
   provenance: 'fresh',
   storageLocation: 'fridge',
   amount: 30,
   unitAbbr: 'ml',
  });
  mocks.prisma.milkBag.findUnique.mockResolvedValue({ amount: 30, unitAbbr: 'ml' });
  mocks.prisma.milkBag.update.mockResolvedValue({});

  const res = await POST(postRequest({ ...PUMP_BODY, appendToBagId: 'bag-1' }));
  const body = await json(res);

  expect(res.status).toBe(200);
  expect(body.success).toBe(true);
  expect(mocks.prisma.milkBag.create).not.toHaveBeenCalled();

  const pumpData = mocks.prisma.pumpLog.create.mock.calls[0][0].data;
  expect(pumpData.milkBagId).toBe('bag-1');
  expect(mocks.prisma.milkBag.update).toHaveBeenCalledTimes(1);
  const updateData = mocks.prisma.milkBag.update.mock.calls[0][0].data;
  expect(updateData.amount).toBe(120); // 30 + 90
 });

 it('creates no bag when no bag intent is sent', async () => {
  primeHappyPath();
  const res = await POST(postRequest({ ...PUMP_BODY, newBagDayNight: undefined, appendToBagId: undefined }));
  const body = await json(res);
  expect(res.status).toBe(200);
  expect(body.success).toBe(true);
  // No bag fields = no bag intent: the API never invents inventory on its own.
  expect(mocks.prisma.milkBag.create).not.toHaveBeenCalled();
  const pumpData = mocks.prisma.pumpLog.create.mock.calls[0][0].data;
  expect(pumpData.milkBagId).toBeNull();
 });
});
