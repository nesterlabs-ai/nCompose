/**
 * Express middleware for Cognito auth gates.
 *
 * - attachUser: global — reads Bearer token, sets req.user. Never rejects.
 * - requireAuth: 401 if not authenticated (passthrough when auth disabled).
 * - requireAuthOrFree: allows auth'd users OR anonymous with free-tier quota.
 */
import crypto from 'crypto';
import { isAuthEnabled, verifyIdToken } from './cognito.js';
import { config } from '../../config.js';

// ── Free tier tracking (in-memory) ──────────────────────────────────────────

const freeTierUsage = new Map<string, number>();

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

export function getFreeTierInfo(fingerprint: string): { used: number; limit: number; remaining: number } {
  const limit = config.freeTier.maxFreeConversions;
  const used = freeTierUsage.get(fingerprint) || 0;
  return { used, limit, remaining: Math.max(0, limit - used) };
}

export function incrementFreeTierUsage(fingerprint: string): void {
  freeTierUsage.set(fingerprint, (freeTierUsage.get(fingerprint) || 0) + 1);
}

// ── Middleware ───────────────────────────────────────────────────────────────

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

export function requireAuthOrFree(req: any, res: any, next: any): void {
  if (!isAuthEnabled()) { next(); return; }
  if (req.user) { next(); return; }

  const fp = getFingerprint(req, res);
  const info = getFreeTierInfo(fp);
  if (info.remaining > 0) {
    // Store fingerprint on request for later incrementing
    req._fingerprint = fp;
    next();
    return;
  }
  res.status(401).json({ error: 'Free tier limit reached. Please sign in to continue.' });
}
