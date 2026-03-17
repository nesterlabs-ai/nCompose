/**
 * Auth API routes — public config, user info, free tier status.
 */
import { Router } from 'express';
import { isAuthEnabled } from './cognito.js';
import { getFreeTierInfo } from './middleware.js';
import { config } from '../../config.js';

const router = Router();

/** GET /api/auth/config — public Cognito config for frontend SDK init */
router.get('/config', (_req: any, res: any) => {
  res.json({
    authEnabled: isAuthEnabled(),
    userPoolId: config.cognito.userPoolId || null,
    clientId: config.cognito.clientId || null,
    region: config.cognito.region,
  });
});

/** GET /api/auth/me — current user info */
router.get('/me', (req: any, res: any) => {
  res.json({
    authEnabled: isAuthEnabled(),
    authenticated: Boolean(req.user),
    user: req.user ? { email: req.user.email, name: req.user.name } : null,
  });
});

/** GET /api/auth/free-tier — anonymous free tier usage */
router.get('/free-tier', (req: any, res: any) => {
  if (!isAuthEnabled()) {
    res.json({ used: 0, limit: 0, remaining: Infinity });
    return;
  }

  const cookies = req.cookies || {};
  const fp = cookies['ftfp'];
  if (!fp) {
    res.json({ used: 0, limit: config.freeTier.maxFreeConversions, remaining: config.freeTier.maxFreeConversions });
    return;
  }
  res.json(getFreeTierInfo(fp));
});

export { router as authRoutes };
