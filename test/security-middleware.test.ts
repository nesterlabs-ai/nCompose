/**
 * Tests for security middleware: HMAC fingerprint cookies, IP tracking, multi-signal auth.
 *
 * Runs entirely in-process — no server or deployment needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// ── Mock DynamoDB before importing middleware ────────────────────────────
vi.mock('../src/web/db/index.js', () => ({
  isDynamoEnabled: () => false,
  dynamoGetFreeTierUsage: vi.fn(),
  dynamoIncrementFreeTierUsage: vi.fn(),
}));

// ── Mock cognito (auth disabled for most tests) ─────────────────────────
vi.mock('../src/web/auth/cognito.js', () => ({
  isAuthEnabled: () => true,
  verifyIdToken: vi.fn().mockResolvedValue(null),
}));

// Now import the actual middleware
import {
  getFingerprint,
  getFreeTierInfo,
  incrementFreeTierUsage,
  getIPUsageInfo,
  incrementIPUsage,
  getClientIP,
  requireAuthOrFree,
  FINGERPRINT_COOKIE,
} from '../src/web/auth/middleware.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function mockReq(overrides: Record<string, any> = {}): any {
  return {
    ip: '127.0.0.1',
    headers: {},
    cookies: {},
    secure: false,
    connection: { remoteAddress: '127.0.0.1' },
    ...overrides,
  };
}

function mockRes(): any {
  const res: any = {
    _cookies: {} as Record<string, { value: string; options: any }>,
    _status: 200,
    _json: null as any,
    cookie(name: string, value: string, options: any) {
      res._cookies[name] = { value, options };
    },
    status(code: number) {
      res._status = code;
      return res;
    },
    json(body: any) {
      res._json = body;
    },
  };
  return res;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('getClientIP', () => {
  it('returns req.ip when available', () => {
    expect(getClientIP({ ip: '10.0.0.1' })).toBe('10.0.0.1');
  });

  it('falls back to connection.remoteAddress', () => {
    expect(getClientIP({ ip: undefined, connection: { remoteAddress: '192.168.1.1' } })).toBe('192.168.1.1');
  });

  it('returns 0.0.0.0 as last resort', () => {
    expect(getClientIP({})).toBe('0.0.0.0');
  });
});

describe('HMAC fingerprint cookies', () => {
  it('generates a signed cookie for new visitors', () => {
    const req = mockReq();
    const res = mockRes();

    const fp = getFingerprint(req, res);

    // Should return a valid UUID
    expect(fp).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    // Cookie should be set with signed value (uuid.hmac_hex)
    const cookie = res._cookies[FINGERPRINT_COOKIE];
    expect(cookie).toBeDefined();
    expect(cookie.value).toContain(fp);
    expect(cookie.value).toContain('.');
    // Format: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.64charhex"
    const parts = cookie.value.split('.');
    expect(parts.length).toBe(2);
    expect(parts[0]).toBe(fp);
    expect(parts[1]).toMatch(/^[0-9a-f]{64}$/); // SHA-256 HMAC = 64 hex chars
  });

  it('verifies and returns fingerprint from valid signed cookie', () => {
    // First request: generate a signed cookie
    const req1 = mockReq();
    const res1 = mockRes();
    const fp1 = getFingerprint(req1, res1);
    const signedValue = res1._cookies[FINGERPRINT_COOKIE].value;

    // Second request: present the signed cookie
    const req2 = mockReq({ cookies: { [FINGERPRINT_COOKIE]: signedValue } });
    const res2 = mockRes();
    const fp2 = getFingerprint(req2, res2);

    // Same fingerprint returned, no new cookie set
    expect(fp2).toBe(fp1);
    expect(res2._cookies[FINGERPRINT_COOKIE]).toBeUndefined();
  });

  it('rejects tampered cookie and issues new fingerprint', () => {
    // Generate a valid signed cookie
    const req1 = mockReq();
    const res1 = mockRes();
    const fp1 = getFingerprint(req1, res1);
    const signedValue = res1._cookies[FINGERPRINT_COOKIE].value;

    // Tamper with the HMAC (flip last char)
    const lastChar = signedValue.slice(-1);
    const tampered = signedValue.slice(0, -1) + (lastChar === 'a' ? 'b' : 'a');

    const req2 = mockReq({ cookies: { [FINGERPRINT_COOKIE]: tampered } });
    const res2 = mockRes();
    const fp2 = getFingerprint(req2, res2);

    // Different fingerprint, new cookie set
    expect(fp2).not.toBe(fp1);
    expect(res2._cookies[FINGERPRINT_COOKIE]).toBeDefined();
  });

  it('rejects unsigned (legacy) cookie and issues new fingerprint', () => {
    const legacyCookie = crypto.randomUUID(); // no HMAC signature
    const req = mockReq({ cookies: { [FINGERPRINT_COOKIE]: legacyCookie } });
    const res = mockRes();
    const fp = getFingerprint(req, res);

    // Should NOT return the legacy value
    expect(fp).not.toBe(legacyCookie);
    // Should set a new signed cookie
    expect(res._cookies[FINGERPRINT_COOKIE]).toBeDefined();
    expect(res._cookies[FINGERPRINT_COOKIE].value).toContain('.');
  });

  it('prefers x-fingerprint header over cookie', () => {
    const req = mockReq({ headers: { 'x-fingerprint': 'client-fp-123' } });
    const res = mockRes();
    const fp = getFingerprint(req, res);

    expect(fp).toBe('client-fp-123');
    // No cookie set when header is used
    expect(res._cookies[FINGERPRINT_COOKIE]).toBeUndefined();
  });

  it('sets secure flag on HTTPS', () => {
    const req = mockReq({ secure: true });
    const res = mockRes();
    getFingerprint(req, res);

    expect(res._cookies[FINGERPRINT_COOKIE].options.secure).toBe(true);
  });

  it('sets secure flag via x-forwarded-proto', () => {
    const req = mockReq({ headers: { 'x-forwarded-proto': 'https' } });
    const res = mockRes();
    getFingerprint(req, res);

    expect(res._cookies[FINGERPRINT_COOKIE].options.secure).toBe(true);
  });

  it('cookie maxAge is ~90 days', () => {
    const req = mockReq();
    const res = mockRes();
    getFingerprint(req, res);

    const maxAge = res._cookies[FINGERPRINT_COOKIE].options.maxAge;
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;
    expect(maxAge).toBe(ninetyDays);
  });
});

describe('IP usage tracking', () => {
  it('starts at 0 for new IP', async () => {
    const info = await getIPUsageInfo('10.99.99.99');
    expect(info.used).toBe(0);
    expect(info.remaining).toBeGreaterThan(0);
  });

  it('increments correctly', async () => {
    const ip = `test-ip-${Date.now()}`;
    await incrementIPUsage(ip);
    await incrementIPUsage(ip);

    const info = await getIPUsageInfo(ip);
    expect(info.used).toBe(2);
  });

  it('limit matches config', async () => {
    const info = await getIPUsageInfo('fresh-ip');
    expect(info.limit).toBe(10); // default maxFreeConversions
  });
});

describe('requireAuthOrFree — multi-signal', () => {
  beforeEach(() => {
    // Reset usage maps by using unique IPs/fingerprints per test
  });

  it('allows anonymous user with quota remaining', async () => {
    const req = mockReq({ ip: `allow-${Date.now()}` });
    const res = mockRes();
    let nextCalled = false;

    await requireAuthOrFree(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    expect(req._fingerprint).toBeDefined();
    expect(req._clientIP).toBeDefined();
  });

  it('blocks when fingerprint quota exhausted', async () => {
    const fp = `exhaust-fp-${Date.now()}`;
    // Exhaust fingerprint quota (default 10)
    for (let i = 0; i < 10; i++) await incrementFreeTierUsage(fp);

    const req = mockReq({
      ip: `fresh-ip-${Date.now()}`,
      headers: { 'x-fingerprint': fp },
    });
    const res = mockRes();
    let nextCalled = false;

    await requireAuthOrFree(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res._status).toBe(401);
    expect(res._json.error).toContain('Free tier limit');
  });

  it('allows when IP quota exhausted but fingerprint has remaining', async () => {
    const ip = `exhaust-ip-${Date.now()}`;
    // Exhaust IP quota (default 10)
    for (let i = 0; i < 10; i++) await incrementIPUsage(ip);

    const req = mockReq({ ip });
    const res = mockRes();
    let nextCalled = false;

    await requireAuthOrFree(req, res, () => { nextCalled = true; });

    // IP alone no longer blocks — fingerprint is the primary check
    expect(nextCalled).toBe(true);
  });

  it('stashes _clientIP on request for downstream increment', async () => {
    const req = mockReq({ ip: `stash-test-${Date.now()}` });
    const res = mockRes();

    await requireAuthOrFree(req, res, () => {});

    expect(req._clientIP).toBe(req.ip);
  });
});
