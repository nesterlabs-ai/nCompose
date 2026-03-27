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

const FINGERPRINT_COOKIE = 'ftfp';

function getFingerprint(req: any, res: any): string {
  const cookies = req.cookies || {};
  let fp = cookies[FINGERPRINT_COOKIE];
  if (!fp) {
    fp = crypto.randomUUID();
    res.cookie(FINGERPRINT_COOKIE, fp, {
      httpOnly: true,
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
      sameSite: 'lax',
    });
  }
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

  // Anonymous users: check free tier limit
  const fp = getFingerprint(req, res);
  const info = await getFreeTierInfo(fp);
  if (info.remaining > 0) {
    req._fingerprint = fp;
    next();
    return;
  }
  res.status(401).json({ error: 'Free tier limit reached. Please sign in to continue.' });
}
