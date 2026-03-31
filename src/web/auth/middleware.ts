/**
 * Express middleware for Cognito auth gates.
 *
 * - attachUser: global — reads Bearer token, sets req.user. Never rejects.
 * - requireAuth: 401 if not authenticated (passthrough when auth disabled).
 * - requireAuthOrFree: allows auth'd users OR anonymous with free-tier quota.
 *
 * Free-tier tracking:
 *   When DynamoDB is enabled → persists across restarts.
 *   Otherwise → in-memory Map (current behaviour, zero breaking changes).
 */
import crypto from 'crypto';
import { isAuthEnabled, verifyIdToken } from './cognito.js';
import { config } from '../../config.js';
import {
  isDynamoEnabled,
  dynamoGetFreeTierUsage,
  dynamoIncrementFreeTierUsage,
} from '../db/index.js';

// ── In-memory fallback ──────────────────────────────────────────────────
const freeTierUsageMap = new Map<string, number>();
const authUsageMap = new Map<string, number>();
const ipUsageMap = new Map<string, number>();

// ── IP helpers ──────────────────────────────────────────────────────────

export function getClientIP(req: any): string {
  return req.ip || req.connection?.remoteAddress || '0.0.0.0';
}

export const FINGERPRINT_COOKIE = 'ftfp';

// ── HMAC signing for fingerprint cookies ────────────────────────────────

/** Resolve the HMAC secret: env var > auto-generated (ephemeral, resets on restart). */
let _fpSecret: string | null = null;
function getFingerprintSecret(): string {
  if (!_fpSecret) {
    _fpSecret = config.fingerprint.secret || crypto.randomBytes(32).toString('hex');
    if (!config.fingerprint.secret) {
      console.warn('[fingerprint] No FINGERPRINT_SECRET set — using ephemeral secret (cookies reset on restart)');
    }
  }
  return _fpSecret;
}

function signFingerprint(fp: string): string {
  const hmac = crypto.createHmac('sha256', getFingerprintSecret()).update(fp).digest('hex');
  return `${fp}.${hmac}`;
}

function verifySignedFingerprint(signed: string): string | null {
  const dotIdx = signed.lastIndexOf('.');
  if (dotIdx === -1) return null;
  const fp = signed.slice(0, dotIdx);
  const sig = signed.slice(dotIdx + 1);
  const expected = crypto.createHmac('sha256', getFingerprintSecret()).update(fp).digest('hex');
  // Timing-safe comparison to prevent timing attacks
  if (sig.length !== expected.length) return null;
  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  return fp;
}

function setFingerprintCookie(res: any, req: any, signedValue: string): void {
  res.cookie(FINGERPRINT_COOKIE, signedValue, {
    httpOnly: true,
    maxAge: config.fingerprint.cookieMaxAgeMs,
    sameSite: 'lax',
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
  });
}

export function getFingerprint(req: any, res: any): string {
  // Primary: client-side FingerprintJS visitor ID sent via header (not HMAC'd — client-controlled)
  const headerFp = req.headers['x-fingerprint'];
  if (headerFp && typeof headerFp === 'string') {
    return headerFp;
  }

  // Fallback: server-generated HMAC-signed cookie
  const cookies = req.cookies || {};
  const raw = cookies[FINGERPRINT_COOKIE];

  if (raw) {
    // Try to verify existing signed cookie
    const verified = verifySignedFingerprint(raw);
    if (verified) return verified;

    // Invalid signature — forge attempt or legacy unsigned cookie. Issue a fresh one.
    console.warn(`[fingerprint] Invalid cookie signature, issuing new fingerprint`);
  }

  // No cookie or invalid — generate fresh
  const fp = crypto.randomUUID();
  setFingerprintCookie(res, req, signFingerprint(fp));
  return fp;
}

export async function getFreeTierInfo(
  fingerprint: string,
): Promise<{ used: number; limit: number; remaining: number }> {
  const limit = config.freeTier.maxFreeConversions;
  let used: number;

  if (isDynamoEnabled()) {
    try {
      used = await dynamoGetFreeTierUsage(fingerprint);
    } catch (err) {
      console.error('[free-tier] DynamoDB read failed, falling back to memory:', err);
      used = freeTierUsageMap.get(fingerprint) || 0;
    }
  } else {
    used = freeTierUsageMap.get(fingerprint) || 0;
  }

  return { used, limit, remaining: Math.max(0, limit - used) };
}

export async function incrementFreeTierUsage(fingerprint: string): Promise<void> {
  // Always update in-memory map (serves as fallback + fast cache)
  freeTierUsageMap.set(fingerprint, (freeTierUsageMap.get(fingerprint) || 0) + 1);

  if (isDynamoEnabled()) {
    try {
      await dynamoIncrementFreeTierUsage(fingerprint);
    } catch (err) {
      console.error('[free-tier] DynamoDB increment failed:', err);
    }
  }
}

// ── IP-based usage tracking ──────────────────────────────────────────

export async function getIPUsageInfo(
  ip: string,
): Promise<{ used: number; limit: number; remaining: number }> {
  const limit = config.freeTier.maxFreeConversions;
  let used: number;

  if (isDynamoEnabled()) {
    try {
      used = await dynamoGetFreeTierUsage(`IP#${ip}`);
    } catch (err) {
      console.error('[ip-usage] DynamoDB read failed, falling back to memory:', err);
      used = ipUsageMap.get(ip) || 0;
    }
  } else {
    used = ipUsageMap.get(ip) || 0;
  }

  return { used, limit, remaining: Math.max(0, limit - used) };
}

export async function incrementIPUsage(ip: string): Promise<void> {
  ipUsageMap.set(ip, (ipUsageMap.get(ip) || 0) + 1);

  if (isDynamoEnabled()) {
    try {
      await dynamoIncrementFreeTierUsage(`IP#${ip}`);
    } catch (err) {
      console.error('[ip-usage] DynamoDB increment failed:', err);
    }
  }
}

// ── Authenticated user usage tracking ───────────────────────────────

export async function getAuthUsageInfo(
  userSub: string,
): Promise<{ used: number; limit: number; remaining: number }> {
  const limit = config.freeTier.maxAuthConversions;
  let used: number;

  if (isDynamoEnabled()) {
    try {
      used = await dynamoGetFreeTierUsage(`auth:${userSub}`);
    } catch (err) {
      console.error('[auth-usage] DynamoDB read failed, falling back to memory:', err);
      used = authUsageMap.get(userSub) || 0;
    }
  } else {
    used = authUsageMap.get(userSub) || 0;
  }

  return { used, limit, remaining: Math.max(0, limit - used) };
}

export async function incrementAuthUsage(userSub: string): Promise<void> {
  authUsageMap.set(userSub, (authUsageMap.get(userSub) || 0) + 1);

  if (isDynamoEnabled()) {
    try {
      await dynamoIncrementFreeTierUsage(`auth:${userSub}`);
    } catch (err) {
      console.error('[auth-usage] DynamoDB increment failed:', err);
    }
  }
}

// ── Middleware ───────────────────────────────────────────────────────────

export async function attachUser(req: any, _res: any, next: any): Promise<void> {
  if (!isAuthEnabled()) { next(); return; }

  const authHeader = req.headers?.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const user = await verifyIdToken(token);
    if (user) req.user = user;
  }
  next();
}

export function requireAuth(req: any, res: any, next: any): void {
  if (!isAuthEnabled()) { next(); return; }
  if (req.user) { next(); return; }
  res.status(401).json({ error: 'Authentication required' });
}

export async function requireAuthOrFree(req: any, res: any, next: any): Promise<void> {
  if (!isAuthEnabled()) { next(); return; }

  const ip = getClientIP(req);
  (req as any)._clientIP = ip;

  // Authenticated users: check auth usage limit
  if (req.user) {
    const info = await getAuthUsageInfo(req.user.sub);
    if (info.remaining > 0) {
      next();
      return;
    }
    res.status(403).json({ error: 'auth_limit_reached', message: 'You have reached your conversion limit. Please contact NesterLabs for more conversions.' });
    return;
  }

  // Anonymous users: check fingerprint quota (primary), IP as logging only
  const fp = getFingerprint(req, res);
  const fpInfo = await getFreeTierInfo(fp);

  if (fpInfo.remaining <= 0) {
    const ipInfo = await getIPUsageInfo(ip);
    console.warn(`[free-tier] Blocked: fp=${fp} fpUsed=${fpInfo.used} ip=${ip} ipUsed=${ipInfo.used}`);
    res.status(401).json({ error: 'Free tier limit reached. Please sign in to continue.' });
    return;
  }

  req._fingerprint = fp;
  next();
}
