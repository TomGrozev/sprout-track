import { beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

/**
 * Route-level tests for the family-settings PUT validation of the
 * `milkBagSettings` JSON blob (issue #10). The blob drives the bag
 * storage-lifecycle (freezer type, day/night boundary, one-time upgrade
 * marker) — a garbled or wrong-shaped write must be rejected rather than
 * silently corrupting those live fields. Non-milk payload fields and the
 * byte-level JSON normalization of a valid blob are also pinned.
 */

const mocks = vi.hoisted(() => ({
 prisma: {
  settings: { findFirst: vi.fn(), update: vi.fn() },
  caretaker: { findFirst: vi.fn(), update: vi.fn() },
 },
}));

vi.mock('../app/api/db', () => ({ default: mocks.prisma }));
vi.mock('../app/api/utils/api-logger', () => ({
 logApiCall: vi.fn(() => Promise.resolve()),
 getClientInfo: vi.fn(() => ({ ip: '127.0.0.1', userAgent: 'vitest' })),
}));

import { PUT } from '../app/api/settings/route';
import { NextRequest } from 'next/server';

const JWT_SECRET = 'test-secret';

function putRequest(body: unknown) {
 return new NextRequest('http://localhost/api/settings', {
  method: 'PUT',
  headers: { Authorization: `Bearer ${ownerAuthToken()}`, 'content-type': 'application/json' },
  body: JSON.stringify(body),
 });
}

function ownerAuthToken(): string {
 return jwt.sign(
  { id: 'caretaker-1', name: 'Caretaker One', type: 'CARETAKER', role: 'OWNER', familyId: 'fam-1', familySlug: 'fam-1' },
  JWT_SECRET,
 );
}

async function json(response: Response) {
 return response.json() as Promise<Record<string, unknown>>;
}

const SETTING_ROW = { id: 'set-1', familyId: 'fam-1' };

beforeEach(() => {
 process.env.JWT_SECRET = JWT_SECRET;
 vi.clearAllMocks();
 mocks.prisma.settings.findFirst.mockResolvedValue(SETTING_ROW);
 mocks.prisma.settings.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
  ...SETTING_ROW,
  ...data,
 }));
 mocks.prisma.caretaker.findFirst.mockResolvedValue(null);
});

describe('settings PUT milkBagSettings validation', () => {
 it('accepts and normalizes a valid blob (trim + compact JSON)', async () => {
  const res = await PUT(putRequest({ milkBagSettings: '  {"freezerType":"chest"}  ' }));
  const payload = await json(res);
  expect(res.status).toBe(200);
  expect(payload.success).toBe(true);
  expect(mocks.prisma.settings.update).toHaveBeenCalledWith(
   expect.objectContaining({ data: expect.objectContaining({ milkBagSettings: '{"freezerType":"chest"}' }) }),
  );
 });

 it('rejects a non-JSON milkBagSettings with a 400 and an explanation', async () => {
  const res = await PUT(putRequest({ milkBagSettings: '{not json' }));
  const payload = await json(res);
  expect(res.status).toBe(400);
  expect(payload.success).toBe(false);
  expect(typeof payload.error).toBe('string');
  expect(payload.error).toMatch(/milk bag settings/i);
  expect(mocks.prisma.settings.update).not.toHaveBeenCalled();
 });

 it('rejects a non-object blob (array / number / string)', async () => {
  for (const bad of ['[1,2]', '42', '"str"', 'null']) {
   const res = await PUT(putRequest({ milkBagSettings: bad }));
   const payload = await json(res);
   expect(res.status, `payload ${bad}`).toBe(400);
   expect(payload.success, `payload ${bad}`).toBe(false);
   expect(mocks.prisma.settings.update).not.toHaveBeenCalled();
  }
 });

 it('rejects an unknown freezerType value', async () => {
  const res = await PUT(putRequest({ milkBagSettings: '{"freezerType":"igloo"}' }));
  const payload = await json(res);
  expect(res.status).toBe(400);
  expect(payload.error).toMatch(/freezer/i);
  expect(mocks.prisma.settings.update).not.toHaveBeenCalled();
 });

 it('rejects non-integer dayStartHour (fractional hour would break hour comparisons)', async () => {
  const res = await PUT(putRequest({ milkBagSettings: '{"dayStartHour":7.5}' }));
  const payload = await json(res);
  expect(res.status).toBe(400);
  expect(mocks.prisma.settings.update).not.toHaveBeenCalled();
 });

 it('rejects a dayStartHour of 24 (valid hours are 0-23)', async () => {
  const res = await PUT(putRequest({ milkBagSettings: '{"dayStartHour":24}' }));
  expect(res.status).toBe(400);
  expect(mocks.prisma.settings.update).not.toHaveBeenCalled();
 });

 it('accepts a full valid blob with boundary hours and upgrade marker untouched', async () => {
  const raw = JSON.stringify({ dayStartHour: 6, dayEndHour: 20, freezerType: 'separate-door', milkBagsUpgradedAt: '2026-09-01T00:00:00.000Z', futureKey: true });
  const res = await PUT(putRequest({ milkBagSettings: raw }));
  const payload = await json(res);
  expect(res.status).toBe(200);
  expect(payload.success).toBe(true);
  expect(mocks.prisma.settings.update).toHaveBeenCalledWith(
   expect.objectContaining({
    data: expect.objectContaining({
     milkBagSettings: JSON.stringify({ dayStartHour: 6, dayEndHour: 20, freezerType: 'separate-door', milkBagsUpgradedAt: '2026-09-01T00:00:00.000Z', futureKey: true }),
    }),
   }),
  );
 });

 it('still persists unrelated settings fields untouched by the milk validation', async () => {
  const res = await PUT(putRequest({ dateFormat: 'DD/MM/YYYY' }));
  const payload = await json(res);
  expect(res.status).toBe(200);
  expect(payload.success).toBe(true);
  expect(mocks.prisma.settings.update).toHaveBeenCalledWith(
   expect.objectContaining({ data: expect.objectContaining({ dateFormat: 'DD/MM/YYYY' }) }),
  );
 });
});
