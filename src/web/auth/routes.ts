/**
 * Auth API routes — public config, user info, free tier status, user projects.
 */
import { Router } from 'express';
import { isAuthEnabled } from './cognito.js';
import { getFreeTierInfo, getAuthUsageInfo, requireAuth } from './middleware.js';
import { config } from '../../config.js';
import {
  isDynamoEnabled,
  getUserProjects,
  saveUserProject,
  deleteUserProject,
  migrateLocalProjects,
  getChatHistory,
  saveChatHistory,
} from '../db/index.js';
import type { UserProjectRecord } from '../db/index.js';

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

/** GET /api/auth/free-tier — usage info (auth or anonymous) */
router.get('/free-tier', async (req: any, res: any) => {
  if (!isAuthEnabled()) {
    res.json({ used: 0, limit: 0, remaining: Infinity, tier: 'free' });
    return;
  }

  // Authenticated users: return auth usage limits
  if (req.user) {
    const info = await getAuthUsageInfo(req.user.sub);
    res.json({ ...info, tier: 'auth' });
    return;
  }

  // Anonymous users: return free tier usage
  const cookies = req.cookies || {};
  const fp = cookies['ftfp'];
  if (!fp) {
    res.json({ used: 0, limit: config.freeTier.maxFreeConversions, remaining: config.freeTier.maxFreeConversions, tier: 'free' });
    return;
  }
  const info = await getFreeTierInfo(fp);
  res.json({ ...info, tier: 'free' });
});

// ── User Project Endpoints (DynamoDB) ────────────────────────────────────

/** GET /api/auth/projects — list user's DynamoDB projects (newest first) */
router.get('/projects', requireAuth as any, async (req: any, res: any) => {
  if (!isDynamoEnabled()) {
    res.json({ projects: [] });
    return;
  }
  try {
    const projects = await getUserProjects(req.user.sub);
    res.json({ projects });
  } catch (err) {
    console.error('[projects] list failed:', err);
    res.status(500).json({ error: 'Failed to load projects' });
  }
});

/** POST /api/auth/projects/sync — merge localStorage projects to DynamoDB */
router.post('/projects/sync', requireAuth as any, async (req: any, res: any) => {
  if (!isDynamoEnabled()) {
    res.json({ migrated: 0 });
    return;
  }
  try {
    const { projects, fingerprint } = req.body;
    if (!Array.isArray(projects)) {
      res.status(400).json({ error: 'projects array required' });
      return;
    }

    // Map client projects to DynamoDB records
    const records: UserProjectRecord[] = projects
      .filter((p: any) => p.id && p.sessionId)
      .map((p: any) => ({
        projectId: p.id,
        sessionId: p.sessionId,
        name: p.name || 'Untitled',
        figmaUrl: p.figmaUrl || '',
        frameworks: p.frameworks || [],
        createdAt: p.createdAt || Date.now(),
        updatedAt: p.updatedAt || Date.now(),
      }));

    await migrateLocalProjects(req.user.sub, fingerprint || undefined, records);

    // Return merged project list
    const merged = await getUserProjects(req.user.sub);
    res.json({ migrated: records.length, projects: merged });
  } catch (err) {
    console.error('[projects] sync failed:', err);
    res.status(500).json({ error: 'Failed to sync projects' });
  }
});

/** DELETE /api/auth/projects/:projectId — delete a user project */
router.delete('/projects/:projectId', requireAuth as any, async (req: any, res: any) => {
  if (!isDynamoEnabled()) {
    res.json({ success: true });
    return;
  }
  try {
    await deleteUserProject(req.user.sub, req.params.projectId);
    res.json({ success: true });
  } catch (err) {
    console.error('[projects] delete failed:', err);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

/** GET /api/auth/projects/:projectId/chat — get chat history */
router.get('/projects/:projectId/chat', requireAuth as any, async (req: any, res: any) => {
  if (!isDynamoEnabled()) {
    res.json({ messages: [] });
    return;
  }
  try {
    const messages = await getChatHistory(req.user.sub, req.params.projectId);
    res.json({ messages });
  } catch (err) {
    console.error('[projects] get chat failed:', err);
    res.status(500).json({ error: 'Failed to load chat history' });
  }
});

/** PUT /api/auth/projects/:projectId/chat — save chat history */
router.put('/projects/:projectId/chat', requireAuth as any, async (req: any, res: any) => {
  if (!isDynamoEnabled()) {
    res.json({ success: true });
    return;
  }
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages)) {
      res.status(400).json({ error: 'messages array required' });
      return;
    }
    await saveChatHistory(req.user.sub, req.params.projectId, messages);
    res.json({ success: true });
  } catch (err) {
    console.error('[projects] save chat failed:', err);
    res.status(500).json({ error: 'Failed to save chat history' });
  }
});

export { router as authRoutes };
