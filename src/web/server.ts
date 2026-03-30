import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import archiver from 'archiver';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { convertFigmaToCode } from '../convert.js';
import { writeOutputFiles } from '../output.js';
import { generateSessionId } from '../utils/session-id.js';
import { generatePreviewHTML } from './preview.js';
import { refineComponent } from './refine.js';
import { classifyMessageIntent } from './chat-intent.js';
import { SUPPORTED_FRAMEWORKS, FRAMEWORK_EXTENSIONS } from '../types/index.js';
import type { Framework, ConversionResult } from '../types/index.js';
import type { LLMMessage } from '../llm/provider.js';
import { createLLMProvider } from '../llm/index.js';
import { config } from '../config.js';
import { wireIntoStarter } from '../template/wire-into-starter.js';
import { injectCSS } from '../compile/inject-css.js';
import rateLimit from 'express-rate-limit';
import { attachUser, requireAuth, requireAuthOrFree, incrementFreeTierUsage, incrementAuthUsage, incrementIPUsage, isAuthEnabled, getFingerprint, FINGERPRINT_COOKIE } from './auth/index.js';
import { authRoutes } from './auth/index.js';
import { isDynamoEnabled, saveUserProject } from './db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Process-level error handlers ─────────────────────────────────────────
// Prevent the Node.js process from crashing on unhandled errors.
// Without these, any unhandled promise rejection or exception in the
// shadcn/template pipeline kills the process, Docker restarts it,
// and all active SSE connections get ERR_INCOMPLETE_CHUNKED_ENCODING.
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception (process kept alive):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection (process kept alive):', reason);
});

const app = express();
const PORT = config.server.port;

// In-memory session storage with TTL (1 hour)
const SESSION_TTL_MS = 60 * 60 * 1000;

interface SessionEntry {
  result: ConversionResult;
  createdAt: number;
  conversation: LLMMessage[];
  llmProvider: string;
  frameworks: Framework[];
  ownerFingerprint?: string;
  ownerSub?: string;
  refineCount: number;
}

const sessionStore = new Map<string, SessionEntry>();

// In-memory token storage with TTL (24 hours)
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const tokenStore = new Map<string, { token: string; createdAt: number }>();

function getSession(id: string): ConversionResult | undefined {
  const entry = sessionStore.get(id);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > SESSION_TTL_MS) {
    sessionStore.delete(id);
    return undefined;
  }
  return entry.result;
}

function getSessionEntry(id: string): SessionEntry | undefined {
  const entry = sessionStore.get(id);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > SESSION_TTL_MS) {
    sessionStore.delete(id);
    return undefined;
  }
  return entry;
}

function setSession(id: string, result: ConversionResult, llmProvider?: string, frameworks?: Framework[], ownerFingerprint?: string, ownerSub?: string): void {
  const existing = sessionStore.get(id);
  sessionStore.set(id, {
    result,
    createdAt: Date.now(),
    conversation: existing?.conversation || [],
    llmProvider: llmProvider || existing?.llmProvider || config.server.defaultLLM,
    frameworks: frameworks || existing?.frameworks || ['react'],
    // Only set owner on initial creation, don't overwrite on re-hydration
    ownerFingerprint: existing?.ownerFingerprint || ownerFingerprint,
    ownerSub: existing?.ownerSub || ownerSub,
    refineCount: existing?.refineCount || 0,
  });
}

/**
 * Load a conversion result from disk when the in-memory session has expired.
 * Scans the output directory for a folder ending with `-{sessionId}`.
 */
function loadResultFromDisk(sessionId: string): ConversionResult | undefined {
  const outputDir = config.server.outputDir;
  if (!existsSync(outputDir)) return undefined;

  // Find directory matching *-{sessionId}
  let matchDir: string | undefined;
  try {
    const dirs = readdirSync(outputDir, { withFileTypes: true });
    for (const d of dirs) {
      if (d.isDirectory() && d.name.endsWith(`-${sessionId}`)) {
        matchDir = join(outputDir, d.name);
        break;
      }
    }
  } catch {
    return undefined;
  }
  if (!matchDir) return undefined;

  // Derive component name from directory name (strip -sessionId suffix)
  const dirName = matchDir.split('/').pop() || '';
  const componentName = dirName.slice(0, dirName.length - sessionId.length - 1);
  if (!componentName) return undefined;

  // Read mitosis source
  let mitosisSource = '';
  const mitosisPath = join(matchDir, `${componentName}.lite.tsx`);
  try { mitosisSource = readFileSync(mitosisPath, 'utf-8'); } catch { /* optional */ }

  // Read framework outputs
  const frameworkOutputs: Record<string, string> = {};
  const fwExts: Record<string, string> = { react: '.jsx', vue: '.vue', svelte: '.svelte', angular: '.ts', solid: '.tsx' };
  for (const [fw, ext] of Object.entries(fwExts)) {
    const fwPath = join(matchDir, `${componentName}${ext}`);
    try { frameworkOutputs[fw] = readFileSync(fwPath, 'utf-8'); } catch { /* skip */ }
  }

  // Read meta.json for componentPropertyDefinitions and elementMap
  let componentPropertyDefinitions: Record<string, any> | undefined;
  let elementMap: Record<string, any> | undefined;
  const metaPath = join(matchDir, `${componentName}.meta.json`);
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    componentPropertyDefinitions = meta.componentPropertyDefinitions;
    elementMap = meta.elementMap;
  } catch { /* optional */ }

  // Read assets
  const assets: Array<{ filename: string; content: string }> = [];
  const assetsDir = join(matchDir, 'assets');
  if (existsSync(assetsDir)) {
    try {
      for (const f of readdirSync(assetsDir)) {
        try {
          const content = readFileSync(join(assetsDir, f), 'utf-8');
          assets.push({ filename: f, content });
        } catch { /* skip binary */ }
      }
    } catch { /* skip */ }
  }

  // Read chart components
  const chartComponents: Array<{ name: string; reactCode: string; css: string }> = [];

  // Read shadcn sub-components from disk (written as {name}.tsx files at root level)
  const shadcnSubComponents: Array<{ shadcnComponentName: string; updatedShadcnSource: string }> = [];
  try {
    const allFiles = readdirSync(matchDir);
    for (const f of allFiles) {
      // shadcn sub-components are .tsx files at root level that are NOT the main component
      // They have lowercase names like "button.tsx", "card.tsx", "input.tsx"
      if (f.endsWith('.tsx') && f !== `${componentName}.lite.tsx` && f !== `${componentName}.tsx`) {
        const name = f.slice(0, -4); // strip .tsx
        // Only include lowercase-named files (shadcn convention)
        if (name === name.toLowerCase() && name.length > 0) {
          try {
            const source = readFileSync(join(matchDir, f), 'utf-8');
            shadcnSubComponents.push({ shadcnComponentName: name, updatedShadcnSource: source });
          } catch { /* skip */ }
        }
      }
    }
  } catch { /* skip */ }

  // For shadcn PATH A: derive updatedShadcnSource + shadcnComponentName from
  // shadcnSubComponents (which were read from {name}.tsx files on disk).
  // If there's exactly one sub-component AND the main mitosis source has the
  // shadcn/ui codegen marker, it's a PATH A shadcn result.
  let updatedShadcnSource: string | undefined;
  let shadcnComponentName: string | undefined;
  if (
    shadcnSubComponents.length === 1 &&
    mitosisSource.includes('shadcn/ui codegen')
  ) {
    shadcnComponentName = shadcnSubComponents[0].shadcnComponentName;
    updatedShadcnSource = shadcnSubComponents[0].updatedShadcnSource;
  }

  return {
    componentName,
    mitosisSource,
    frameworkOutputs: frameworkOutputs as any,
    assets,
    componentPropertyDefinitions,
    chartComponents,
    shadcnSubComponents: shadcnSubComponents.length > 0 ? shadcnSubComponents : undefined,
    updatedShadcnSource,
    shadcnComponentName,
    elementMap,
  } as ConversionResult;
}

/**
 * Get session result from memory, falling back to disk if expired.
 * Optionally re-hydrates the session store.
 */
function getSessionWithDiskFallback(sessionId: string): ConversionResult | undefined {
  const memResult = getSession(sessionId);
  if (memResult) return memResult;

  const diskResult = loadResultFromDisk(sessionId);
  if (diskResult) {
    // Re-hydrate into session store for subsequent requests
    setSession(sessionId, diskResult);
  }
  return diskResult;
}

/**
 * Middleware: validates that the requesting user owns the session.
 * Checks Cognito sub for auth'd users, fingerprint for guests.
 * Legacy sessions (no owner) are allowed through for backward compat.
 */
function requireSessionOwner(req: any, res: any, next: any): void {
  if (!isAuthEnabled()) { next(); return; }

  const sessionId = req.params.sessionId || req.body?.sessionId;
  if (!sessionId) { res.status(400).json({ error: 'sessionId required' }); return; }

  const entry = getSessionEntry(sessionId);
  if (!entry) {
    // Session not in memory — try disk fallback so ownership check can proceed
    const diskResult = loadResultFromDisk(sessionId);
    if (!diskResult) { res.status(404).json({ error: 'Session not found' }); return; }
    // Re-hydrate (no owner info from disk — legacy session, allow through)
    setSession(sessionId, diskResult);
    next();
    return;
  }

  // Auth user: match by Cognito sub
  if (req.user) {
    if (entry.ownerSub && entry.ownerSub === req.user.sub) { next(); return; }
    if (!entry.ownerSub && !entry.ownerFingerprint) { next(); return; }
  }

  // Guest user: match by fingerprint
  const fp = req.headers['x-fingerprint'] || req.cookies?.[FINGERPRINT_COOKIE];
  if (fp && entry.ownerFingerprint && entry.ownerFingerprint === fp) { next(); return; }

  // Legacy session with no owner — allow (backward compat)
  if (!entry.ownerSub && !entry.ownerFingerprint) { next(); return; }

  res.status(403).json({ error: 'You do not have access to this session' });
}

// ── Step message sanitizer ────────────────────────────────────────────────
// Strips internal tool names (LLM providers, Mitosis, shadcn, paths) from
// progress messages before sending to the web client. Raw messages are
// preserved in server logs and CLI output.

const LLM_NAME_RE = /\bvia\s+(Claude|DeepSeek|GPT-4o|OpenAI)\b/gi;
const SHADCN_PREFIX_RE = /^\[shadcn(?:-(?:structural|composite))?\]\s*/;
const PATH_LABEL_RE = /^\[PATH\s+\d+\]\s*/;
const MITOSIS_RE = /\bMitosis\b/g;
const OUTPUT_PATH_RE = /\s*(to\s+)?\.?\/[\w./-]+/;

/** Map of raw messages to user-friendly replacements (prefix match). */
const STEP_REWRITES: [RegExp, string][] = [
  [/^Assembling prompts\.\.\./, 'Preparing code generation...'],
  [/^Injecting (?:variant |page )?CSS\.\.\./, 'Applying styles...'],
  [/^Parsing stitched page component\.\.\./, 'Finalizing page layout...'],
  [/^Building variant CSS from design tokens\.\.\./, 'Building styles from design...'],
  [/^Building variant prompt data\.\.\./, 'Preparing variant data...'],
  [/^Generating React \+ Tailwind component\b.*/, 'Generating component...'],
  [/^Output saved to\b.*/, 'Output saved'],
  [/^Template wir(?:ed|ing)\b.*/, 'Template ready'],
  [/Failed:.*falling back to standard codegen/, 'Retrying with fallback approach...'],
  [/Failed:.*falling back to composite discovery/, 'Retrying with fallback approach...'],
  [/Failed:.*falling back to React/, 'Retrying with fallback approach...'],
  [/Failed:.*falling back to raw HTML/, 'Retrying with fallback approach...'],
];

function sanitizeStepMessage(raw: string): string {
  // Apply full rewrites first
  for (const [pattern, replacement] of STEP_REWRITES) {
    if (pattern.test(raw)) return replacement;
  }

  let msg = raw;

  // Strip [shadcn*] and [PATH N] prefixes
  msg = msg.replace(SHADCN_PREFIX_RE, '');
  msg = msg.replace(PATH_LABEL_RE, '');

  // Strip LLM provider names: "via DeepSeek" → "via NesterAI"
  msg = msg.replace(LLM_NAME_RE, 'via NesterAI');

  // Replace "Mitosis" with "component"
  msg = msg.replace(MITOSIS_RE, 'component');

  // Strip internal tool/library names
  msg = msg.replace(/\bshadcn\b\s*/gi, '');
  msg = msg.replace(/\bRecharts\b\s*/gi, '');
  msg = msg.replace(/\bcodegen\s*(?:path)?\b/gi, '');
  msg = msg.replace(/\bBEM\b/g, 'CSS');

  // Strip internal detail like "(class-based)"
  msg = msg.replace(/\s*\(class-based\)/g, '');

  // Strip file paths from messages
  msg = msg.replace(/Output saved to\s+\S+/, 'Output saved');

  // Clean up artifacts: "→ using  path..." → "→ processing..."
  msg = msg.replace(/→\s*using\s+(?:path|)\s*\.{3}/, '→ processing...');
  // "Detected "button" → processing..."
  msg = msg.replace(/Detected\s+"([^"]+)"\s*→\s*processing\.\.\./, 'Processing "$1" component...');

  // Clean up redundant words and double spaces
  msg = msg.replace(/\bcomponent component\b/g, 'component');
  msg = msg.replace(/\s{2,}/g, ' ').trim();

  return msg;
}

// Periodic cleanup of expired sessions and tokens (every 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of sessionStore) {
    if (now - entry.createdAt > SESSION_TTL_MS) {
      sessionStore.delete(id);
    }
  }
  for (const [id, entry] of tokenStore) {
    if (now - entry.createdAt > TOKEN_TTL_MS) {
      tokenStore.delete(id);
    }
  }
}, 10 * 60 * 1000);

// Middleware
app.use(express.json({ limit: config.server.jsonLimit }));
app.use(cookieParser());
app.use(attachUser as any);

// Trust proxy (for correct req.ip behind load balancers)
app.set('trust proxy', config.server.trustProxy);

// Rate limiters
const globalLimiter = rateLimit({
  windowMs: config.rateLimit.globalWindowMs,
  max: config.rateLimit.globalMaxRequests,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});
app.use('/api', globalLimiter);

const expensiveLimiter = rateLimit({
  windowMs: config.rateLimit.expensiveWindowMs,
  max: config.rateLimit.expensiveMaxRequests,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait before trying again.' },
});

// Required for WebContainer (SharedArrayBuffer needs cross-origin isolation)
// Only set on HTTPS or localhost — browsers ignore these headers on plain HTTP
app.use((req: any, res: any, next: any) => {
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const isLocalhost = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
  if (isSecure || isLocalhost) {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  }
  next();
});

// Serve static files
app.use(express.static(join(__dirname, 'public')));

// Auth routes
app.use('/api/auth', authRoutes);

/**
 * POST /api/store-token — Store Figma token server-side, return a tokenId
 */
app.post('/api/store-token', (req: any, res: any) => {
  const { figmaToken } = req.body;
  if (!figmaToken || typeof figmaToken !== 'string') {
    return res.status(400).json({ error: 'figmaToken is required' });
  }
  const tokenId = crypto.randomUUID();
  tokenStore.set(tokenId, { token: figmaToken, createdAt: Date.now() });
  res.json({ tokenId });
});

/**
 * GET /api/verify-token/:id — Check if a stored token is still valid
 */
app.get('/api/verify-token/:id', (req: any, res: any) => {
  const entry = tokenStore.get(req.params.id);
  if (!entry || Date.now() - entry.createdAt > TOKEN_TTL_MS) {
    if (entry) tokenStore.delete(req.params.id);
    return res.json({ valid: false });
  }
  res.json({ valid: true });
});

/**
 * POST /api/convert — SSE endpoint
 *
 * Accepts JSON body: { figmaUrl, tokenId, frameworks }
 * Streams progress via Server-Sent Events, then sends completion data.
 */
app.post('/api/convert', expensiveLimiter as any, requireAuthOrFree as any, (req: any, res: any) => {
  const { figmaUrl, tokenId, frameworks, name, llm: requestedLLM, template } = req.body;

  // Validate inputs
  if (!figmaUrl || typeof figmaUrl !== 'string') {
    res.status(400).json({ error: 'figmaUrl is required' });
    return;
  }
  if (!tokenId || typeof tokenId !== 'string') {
    res.status(400).json({ error: 'tokenId is required' });
    return;
  }
  const tokenEntry = tokenStore.get(tokenId);
  if (!tokenEntry || Date.now() - tokenEntry.createdAt > TOKEN_TTL_MS) {
    if (tokenEntry) tokenStore.delete(tokenId);
    res.status(401).json({ error: 'Token expired. Please re-enter your Figma token.' });
    return;
  }
  const figmaToken = tokenEntry.token;

  const selectedFrameworks: Framework[] = (frameworks || ['react'])
    .filter((f: string) => SUPPORTED_FRAMEWORKS.includes(f as Framework));

  if (selectedFrameworks.length === 0) {
    res.status(400).json({ error: 'At least one valid framework is required' });
    return;
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Guard against writes to dead sockets (prevents Node.js crash)
  // IMPORTANT: Only listen on `res` events, NOT `req.on('close')`.
  // For POST requests, `req.on('close')` fires as soon as the request body
  // is fully received — which is almost immediately. This was setting
  // clientGone=true before the SSE stream even started, silently dropping
  // ALL subsequent events → ERR_INCOMPLETE_CHUNKED_ENCODING on the client.
  let clientGone = false;
  res.on('error', () => { clientGone = true; });
  res.on('close', () => { clientGone = true; });

  const sendEvent = (event: string, data: Record<string, unknown>) => {
    if (clientGone || res.writableEnded || res.destroyed) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch { clientGone = true; }
  };

  // SSE heartbeat — keeps TCP alive through NAT/firewall idle timeouts
  const heartbeat = setInterval(() => {
    if (clientGone || res.writableEnded || res.destroyed) return;
    try { res.write(':keepalive\n\n'); } catch { clientGone = true; }
  }, 15_000);

  const sessionId = generateSessionId();

  // Send sessionId early so the client can create a placeholder project immediately
  sendEvent('session', { sessionId });

  sendEvent('step', { message: 'Starting conversion...' });

  convertFigmaToCode(
    figmaUrl,
    {
      frameworks: selectedFrameworks,
      output: config.server.outputDir,
      name: name && typeof name === 'string' ? name.trim() : undefined,
      llm: (requestedLLM && typeof requestedLLM === 'string' ? requestedLLM : config.server.defaultLLM) as any,
      depth: config.server.defaultDepth,
      figmaToken,
      templateMode: Boolean(template),
    },
    {
      onStep: (step) => {
        sendEvent('step', { message: sanitizeStepMessage(step) });
      },
      onAttempt: (attempt, maxRetries, error) => {
        sendEvent('attempt', { attempt, maxRetries, error: error || null });
      },
    },
  )
    .then(async (result) => {
      clearInterval(heartbeat);

      try {
        // Increment usage counters
        if ((req as any)._fingerprint) {
          await incrementFreeTierUsage((req as any)._fingerprint);
        } else if (req.user) {
          await incrementAuthUsage(req.user.sub);
        }
        // Also increment IP-based usage for anonymous users
        if ((req as any)._clientIP && !req.user) {
          await incrementIPUsage((req as any)._clientIP);
        }

        // Store result in session (with owner binding)
        const llmName = (requestedLLM && typeof requestedLLM === 'string' ? requestedLLM : config.server.defaultLLM);
        const ownerFp = (req as any)._fingerprint || getFingerprint(req, res);
        const ownerSub = req.user?.sub;
        setSession(sessionId, result, llmName, selectedFrameworks, ownerFp, ownerSub);

        // Persist project metadata to DynamoDB for authenticated users
        if (req.user && isDynamoEnabled()) {
          try {
            await saveUserProject(req.user.sub, {
              projectId: sessionId,
              sessionId,
              name: result.componentName,
              figmaUrl: figmaUrl,
              frameworks: selectedFrameworks,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
          } catch (dbErr) {
            console.error('[convert] DynamoDB project save failed:', dbErr);
          }
        }

        // Write output files to disk (same as CLI)
        const componentOutputDir = join(config.server.outputDir, `${result.componentName}-${sessionId}`);
        try {
          writeOutputFiles({
            outputDir: componentOutputDir,
            componentName: result.componentName,
            mitosisSource: result.mitosisSource,
            frameworkOutputs: result.frameworkOutputs,
            assets: result.assets,
            componentPropertyDefinitions: result.componentPropertyDefinitions,
            variantMetadata: result.variantMetadata,
            fidelityReport: result.fidelityReport,
            chartComponents: result.chartComponents,
            updatedShadcnSource: result.updatedShadcnSource,
            shadcnComponentName: result.shadcnComponentName,
            shadcnSubComponents: result.shadcnSubComponents,
            elementMap: result.elementMap,
          });
          sendEvent('step', { message: 'Output saved' });
        } catch (writeErr) {
          const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
          sendEvent('step', { message: 'Warning: Could not save output' });
        }

        // Wire into starter template when requested (same behavior as CLI --template)
        let templateWired = false;
        if (template) {
          const projectRoot = join(__dirname, '..'); // points to src/
          const starterDir = join(projectRoot, 'figma-to-code-starter-main');
          if (existsSync(starterDir)) {
            try {
              // Build figmaVariantNames from variant metadata for filtering non-existent combos
              const figmaVariantNames = result.variantMetadata?.variants?.map((v: { props: Record<string, string> }) =>
                Object.entries(v.props).map(([k, val]) => `${k}=${val}`).join(', ')
              );
              wireIntoStarter({
                componentOutputDir,
                componentName: result.componentName,
                starterDir,
                componentPropertyDefinitions: result.componentPropertyDefinitions,
                updatedShadcnSource: result.updatedShadcnSource,
                shadcnComponentName: result.shadcnComponentName,
                figmaVariantNames,
                shadcnSubComponents: result.shadcnSubComponents,
              });
              templateWired = true;
              sendEvent('step', {
                message: 'Template ready — see Wired app in code view',
              });
            } catch (err) {
              sendEvent('step', { message: 'Template setup failed' });
            }
          }
        }

        // Send framework outputs for code display
        sendEvent('complete', {
          sessionId,
          componentName: result.componentName,
          frameworks: selectedFrameworks,
          frameworkOutputs: result.frameworkOutputs,
          mitosisSource: result.mitosisSource,
          elementMap: result.elementMap,
          templateWired,
          assetCount: result.assets?.length ?? 0,
          assets: (result.assets || []).filter(a => a.content).map(a => ({ filename: a.filename, content: a.content })),
          chartComponents: result.chartComponents?.map((c) => ({
            name: c.name,
            reactCode: c.reactCode,
            css: c.css,
          })) ?? [],
          fidelity: result.fidelityReport
            ? {
              overallPassed: result.fidelityReport.overallPassed,
              checks: Object.fromEntries(
                Object.entries(result.fidelityReport.checks).map(([k, v]) => [k, v?.passed ?? false]),
              ),
            }
            : undefined,
          updatedShadcnSource: result.updatedShadcnSource ?? undefined,
          shadcnComponentName: result.shadcnComponentName ?? undefined,
          shadcnSubComponents: result.shadcnSubComponents ?? undefined,
          componentPropertyDefinitions: result.componentPropertyDefinitions ?? undefined,
          variantMetadata: result.variantMetadata ?? undefined,
        });
      } catch (thenErr) {
        console.error('[convert] Error in post-conversion handler:', thenErr);
        sendEvent('error', {
          message: thenErr instanceof Error ? thenErr.message : String(thenErr),
        });
      }

      if (!res.writableEnded) res.end();
    })
    .catch((err) => {
      clearInterval(heartbeat);
      const message = err instanceof Error ? err.message : String(err);
      sendEvent('error', { message });
      if (!res.writableEnded) res.end();
    })
    ;
});

/**
 * Fallback: apply visual edit CSS changes directly to the original CSS string.
 * Used when the LLM drops the CSS section during a visual-edit refinement.
 */
function applyVisualEditsToCSS(
  css: string,
  visualEdits: Record<string, { changes: Record<string, string | boolean>; tagName?: string; textContent?: string }>,
  elementMap: Record<string, { path: string; tagName: string; textContent?: string; className?: string; id?: string }>,
): string {
  let result = css;

  for (const [veId, item] of Object.entries(visualEdits)) {
    const entry = elementMap[veId];
    // Build effective element info: prefer elementMap, fall back to client-provided metadata
    const effectiveTagName = entry?.tagName || item.tagName || 'unknown';
    const effectiveClassName = entry?.className || '';
    const effectiveTextContent = entry?.textContent || item.textContent || '';

    if (!entry && !item.tagName) {
      console.log(`[visual-edit-css] No elementMap entry and no client metadata for veId="${veId}", skipping`);
      continue;
    }

    console.log(`[visual-edit-css] Processing veId="${veId}" tag=<${effectiveTagName}> class="${effectiveClassName || '(none)'}" text="${effectiveTextContent.substring(0, 30)}"`);

    // Alias entry for remaining code that uses entry.className / entry.tagName
    const entryForCSS = { tagName: effectiveTagName, className: effectiveClassName, textContent: effectiveTextContent };

    for (const [prop, value] of Object.entries(item.changes)) {
      if (prop === 'delete' || typeof value !== 'string') continue;

      // Convert camelCase CSS prop to kebab-case
      const kebabProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
      console.log(`[visual-edit-css]   Applying ${kebabProp}: ${value}`);

      let applied = false;

      // Strategy 1: Match by className (most reliable)
      if (entryForCSS.className) {
        const classNames = entryForCSS.className.split(/\s+/);
        for (const cls of classNames) {
          const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          // Try to update existing property in a rule for this class
          const selectorPattern = new RegExp(
            `(\\.${escaped}\\s*\\{[^}]*?)(${kebabProp}\\s*:\\s*)[^;]*(;)`,
          );
          if (selectorPattern.test(result)) {
            result = result.replace(selectorPattern, `$1$2${value}$3`);
            applied = true;
            console.log(`[visual-edit-css]   ✓ Updated existing "${kebabProp}" in .${cls}`);
            break;
          }
        }

        // If property wasn't found in existing rules, append it to the first matching class block
        if (!applied) {
          for (const cls of classNames) {
            const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const blockPattern = new RegExp(
              `(\\.${escaped}\\s*\\{)([^}]*)\\}`,
            );
            const match = result.match(blockPattern);
            if (match) {
              const existingBlock = match[2].trimEnd();
              const semi = existingBlock.endsWith(';') ? '' : ';';
              result = result.replace(
                blockPattern,
                `$1${existingBlock}${semi}\n  ${kebabProp}: ${value};\n}`,
              );
              applied = true;
              console.log(`[visual-edit-css]   ✓ Appended "${kebabProp}" to .${cls}`);
              break;
            }
          }
        }

        // Strategy 1c: No CSS rule exists for any class — create one
        if (!applied) {
          const primaryClass = classNames[0];
          result += `\n.${primaryClass} {\n  ${kebabProp}: ${value};\n}\n`;
          applied = true;
          console.log(`[visual-edit-css]   ✓ Created new rule .${primaryClass} { ${kebabProp}: ${value} }`);
        }
      }

      // Strategy 2: Match by tagName (for elements without className)
      if (!applied && entryForCSS.tagName) {
        const tag = entryForCSS.tagName.toLowerCase();
        const tagSelectorPattern = new RegExp(
          `((?:^|\\n)\\s*${tag}\\s*\\{[^}]*?)(${kebabProp}\\s*:\\s*)[^;]*(;)`,
        );
        if (tagSelectorPattern.test(result)) {
          result = result.replace(tagSelectorPattern, `$1$2${value}$3`);
          applied = true;
          console.log(`[visual-edit-css]   ✓ Updated existing "${kebabProp}" in ${tag} selector`);
        }
      }

      if (!applied) {
        console.log(`[visual-edit-css]   ✗ Could not apply "${kebabProp}: ${value}" — no matching selector found`);
      }
    }
  }

  return result;
}

/**
 * Strip previously-injected CSS from framework output so we can re-inject with updated CSS.
 * Each framework injects CSS differently; this reverses that injection.
 */
function stripInjectedCSS(code: string, framework: Framework): string {
  switch (framework) {
    case 'react':
    case 'solid':
      return code.replace(/<style>\{`[\s\S]*?`\}<\/style>/g, '');
    case 'vue':
      // Remove the entire <style scoped>...</style> section
      return code.replace(/<style scoped>[\s\S]*?<\/style>\s*/g, '');
    case 'svelte':
      return code.replace(/<style>[\s\S]*?<\/style>\s*/g, '');
    case 'angular':
      // Reset styles array to empty
      return code.replace(/styles:\s*\[\s*`[\s\S]*?`\s*,?\s*\]/g, 'styles: []');
    default:
      return code;
  }
}

/**
 * Build a floating-edit prompt server-side from the user's raw request + element metadata.
 */
function buildFloatingEditPrompt(
  userRequest: string,
  elementMap: Record<string, { path: string; tagName: string; textContent?: string; className?: string; id?: string }>,
  dataVeId: string,
  variantLabel?: string | null,
): string {
  const entry = elementMap[dataVeId];
  if (!entry) return userRequest;

  let variantDetails = '';
  if (variantLabel && variantLabel !== 'undefined / undefined') {
    variantDetails = ` [Clicked inside variant state: "${variantLabel}"]`;
  }
  const textSnippet = (entry.textContent || '').replace(/\n/g, ' ').substring(0, 30).trim();

  return `You are an expert Frontend Developer. Please update the underlying React component code based on the following user request.

IMPORTANT: Only modify the SPECIFIC element identified below. Do NOT change any other elements in the component.

Target Element: <${entry.tagName.toUpperCase()}> (data-ve-id="${dataVeId}") containing text "${textSnippet}"${variantDetails}

User Request: "${userRequest}"

Return the fully rewritten React component code incorporating this requested modification ONLY to the target element. Leave all other elements unchanged.`;
}

/**
 * Build a batch visual-edit save prompt server-side.
 */
function buildVisualEditSavePrompt(
  visualEdits: Record<string, { changes: Record<string, string | boolean>; tagName?: string; textContent?: string }>,
  elementMap: Record<string, { path: string; tagName: string; textContent?: string; className?: string; id?: string }>,
  isShadcn: boolean,
): string {
  const cssHint = isShadcn
    ? 'Apply these changes using Tailwind utility classes or inline styles within the React source.'
    : 'Apply these changes by updating the CSS rules in the ---CSS--- section. Find the CSS selector that targets the element (by its class name) and update the relevant CSS property there. Do NOT use inline styles or css={{}}. You MUST include the complete ---CSS--- section with ALL existing rules plus the modifications.';

  const lines: string[] = [
    'You are an expert Frontend Developer. Please update the component code to permanently apply the following visual style edits.',
    cssHint,
    '',
  ];

  let i = 1;
  for (const [veId, item] of Object.entries(visualEdits)) {
    const entry = elementMap[veId];
    // Use elementMap entry when available, fall back to client-provided metadata
    const tagName = entry?.tagName || item.tagName || 'UNKNOWN';
    const textSnippet = (entry?.textContent || item.textContent || '').replace(/\n/g, ' ').substring(0, 30).trim();
    const className = entry?.className || '';

    lines.push(`${i}. Target Element: <${tagName.toUpperCase()}>${className ? ` class="${className}"` : ''} containing text "${textSnippet}"`);
    lines.push('   Updates to apply:');

    for (const [prop, value] of Object.entries(item.changes)) {
      if (prop === 'delete') {
        lines.push('   - -> Remove/Delete this element completely');
      } else {
        lines.push(`   - -> Change CSS property '${prop}' to '${value}'`);
      }
    }
    lines.push('');
    i++;
  }

  if (!isShadcn) {
    lines.push('IMPORTANT: Output the complete .lite.tsx code followed by ---CSS--- and the complete updated CSS. Do NOT omit the CSS section.');
  }
  lines.push('Return the fully rewritten component code containing these exact modifications.');
  return lines.join('\n');
}

/**
 * POST /api/refine — SSE endpoint for iterative refinement
 *
 * Accepts JSON body: { sessionId, userRequest?, dataVeId?, variantLabel?, variantProps?, visualEdits? }
 * Streams progress via Server-Sent Events, then sends updated code.
 */
app.post('/api/refine', expensiveLimiter as any, requireAuthOrFree as any, requireSessionOwner as any, (req: any, res: any) => {
  const { sessionId, userRequest, dataVeId, variantLabel, variantProps, visualEdits } = req.body;

  if (!sessionId || typeof sessionId !== 'string') {
    res.status(400).json({ error: 'sessionId is required' });
    return;
  }
  if (!userRequest && !visualEdits) {
    res.status(400).json({ error: 'userRequest or visualEdits is required' });
    return;
  }

  let session = getSessionEntry(sessionId);
  if (!session) {
    // Try disk fallback — re-hydrate into memory
    const diskResult = loadResultFromDisk(sessionId);
    if (diskResult) {
      setSession(sessionId, diskResult);
      session = getSessionEntry(sessionId);
    }
  }
  if (!session) {
    res.status(404).json({ error: 'Session not found or expired' });
    return;
  }

  // Per-session refine limit
  const maxRefines = req.user
    ? config.freeTier.maxAuthRefinesPerSession
    : config.freeTier.maxFreeRefinesPerSession;
  if (session.refineCount >= maxRefines) {
    res.status(429).json({
      error: `Refine limit reached (${maxRefines} per session). ${req.user ? 'Please start a new conversion.' : 'Please sign in for a higher limit.'}`,
    });
    return;
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Guard against writes to dead sockets (same fix as /api/convert — no req.on('close'))
  let clientGone = false;
  res.on('error', () => { clientGone = true; });
  res.on('close', () => { clientGone = true; });

  const sendEvent = (event: string, data: Record<string, unknown>) => {
    if (clientGone || res.writableEnded || res.destroyed) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch { clientGone = true; }
  };

  // SSE heartbeat
  const heartbeat = setInterval(() => {
    if (clientGone || res.writableEnded || res.destroyed) return;
    try { res.write(':keepalive\n\n'); } catch { clientGone = true; }
  }, 15_000);

  sendEvent('step', { message: 'Starting refinement...' });

  // Create LLM provider
  let llmProvider;
  try {
    llmProvider = createLLMProvider(session.llmProvider as any);
  } catch (err) {
    clearInterval(heartbeat);
    const msg = err instanceof Error ? err.message : String(err);
    sendEvent('error', { message: `Failed to create LLM provider: ${msg}` });
    res.end();
    return;
  }

  // Extract current CSS: check ---CSS--- delimiter first, then fall back to result.css
  let currentMitosis = session.result.mitosisSource;
  let currentCSS = '';
  const cssDelimIdx = currentMitosis.indexOf('---CSS---');
  if (cssDelimIdx !== -1) {
    currentCSS = currentMitosis.slice(cssDelimIdx + '---CSS---'.length).trim();
    currentMitosis = currentMitosis.slice(0, cssDelimIdx).trim();
  } else if (session.result.css) {
    currentCSS = session.result.css;
  }

  // For shadcn components, the thin wrapper just imports the sub-component.
  // The actual editable elements live in updatedShadcnSource.
  // Swap currentMitosis to the sub-component code so the LLM can see and modify it.
  let refiningShadcnSub = false;
  const isShadcnWrapper = currentMitosis.includes('shadcn/ui codegen');
  if (isShadcnWrapper && session.result.updatedShadcnSource) {
    currentMitosis = `// shadcn/ui codegen\n${session.result.updatedShadcnSource}`;
    refiningShadcnSub = true;
    console.log(`[refine] Shadcn sub-component swap: sending updatedShadcnSource (${session.result.updatedShadcnSource.length} chars) instead of thin wrapper`);
  }

  // Construct the effective prompt server-side from raw payload data
  let effectivePrompt: string;
  let resolvedSelectedElement: any;

  const eMap = session.result.elementMap || {};
  const isShadcn = currentMitosis.includes('shadcn/ui codegen');
  if (visualEdits && typeof visualEdits === 'object') {
    // Batch visual edit save
    effectivePrompt = buildVisualEditSavePrompt(visualEdits, eMap, isShadcn);
  } else if (dataVeId && typeof dataVeId === 'string' && eMap[dataVeId]) {
    // Floating prompt targeting a specific element
    effectivePrompt = buildFloatingEditPrompt(userRequest.trim(), eMap, dataVeId, variantLabel);
    const entry = eMap[dataVeId];
    resolvedSelectedElement = {
      dataVeId,
      tagName: entry.tagName,
      textContent: entry.textContent,
      variantLabel: variantLabel || null,
      variantProps: variantProps || null,
    };
  } else {
    // Regular chat — raw user request
    effectivePrompt = userRequest.trim();
  }

  // ── Conversational fast-path ──────────────────────────────────────────
  // For plain chat messages (not visual edits or element-targeted prompts),
  // classify intent and skip the full refinement pipeline for conversational
  // messages like greetings, affirmations, or meta-questions.
  if (!visualEdits && !dataVeId && userRequest && classifyMessageIntent(userRequest.trim()) === 'conversational') {
    const chatMessages: LLMMessage[] = [
      {
        role: 'system',
        content: 'You are a helpful assistant for a Figma-to-code conversion tool. You help users convert Figma designs into React, Vue, Svelte, Angular, and Solid components. Respond briefly and helpfully. Do not generate any code.',
      },
      ...session.conversation,
      { role: 'user', content: userRequest.trim() },
    ];

    llmProvider.generateMultiTurn(chatMessages)
      .then((reply) => {
        clearInterval(heartbeat);
        // Append to conversation history (no code context prefix)
        session!.conversation.push(
          { role: 'user', content: userRequest.trim() },
          { role: 'assistant', content: reply },
        );
        if (session!.conversation.length > 40) {
          session!.conversation = session!.conversation.slice(-40);
        }
        sendEvent('chat_response', { message: reply });
        res.end();
      })
      .catch((err) => {
        clearInterval(heartbeat);
        const msg = err instanceof Error ? err.message : String(err);
        sendEvent('error', { message: `Chat error: ${msg}` });
        res.end();
      });
    return;
  }

  refineComponent({
    currentMitosis,
    currentCSS,
    userPrompt: effectivePrompt,
    conversation: session.conversation,
    llmProvider,
    frameworks: session.frameworks,
    componentName: session.result.componentName,
    selectedElement: resolvedSelectedElement,
    elementMap: session.result.elementMap,
    onStep: (step) => sendEvent('step', { message: sanitizeStepMessage(step) }),
  })
    .then((refined) => {
      clearInterval(heartbeat);

      // For visual edits: always ensure CSS changes are applied,
      // regardless of whether the LLM included/updated CSS correctly.
      if (visualEdits && typeof visualEdits === 'object') {
        console.log(`[refine] Visual edits detected. LLM returned css: ${refined.css ? refined.css.length + ' chars' : '(none)'}. currentCSS: ${currentCSS ? currentCSS.length + ' chars' : '(none)'}`);
        console.log(`[refine] Visual edits payload:`, JSON.stringify(visualEdits));
        console.log(`[refine] ElementMap keys for edits:`, Object.keys(visualEdits).map(k => `${k} → ${JSON.stringify(eMap[k] || 'NOT FOUND')}`));
        const baseCSS = refined.css || currentCSS;
        if (baseCSS) {
          const patchedCSS = applyVisualEditsToCSS(baseCSS, visualEdits, eMap);
          if (patchedCSS !== baseCSS) {
            console.log(`[refine] CSS was patched (base ${baseCSS.length} → patched ${patchedCSS.length} chars)`);
          } else {
            console.log(`[refine] CSS patch produced no changes — edits may already be applied by LLM or no matching selectors`);
          }
          // Always set the patched CSS (even if unchanged, to guarantee consistency)
          refined.css = patchedCSS;
          // Update mitosis source with patched CSS
          if (refined.mitosisSource.includes('---CSS---')) {
            refined.mitosisSource = refined.mitosisSource.replace(/---CSS---[\s\S]*$/, `---CSS---\n${patchedCSS}`);
          } else {
            refined.mitosisSource = `${refined.mitosisSource}\n---CSS---\n${patchedCSS}`;
          }
          // Strip existing CSS injection from framework outputs and re-inject with patched CSS
          for (const fw of session.frameworks) {
            const code = refined.frameworkOutputs[fw];
            if (code && !code.startsWith('// Error')) {
              const stripped = stripInjectedCSS(code, fw);
              refined.frameworkOutputs[fw] = injectCSS(stripped, patchedCSS, fw);
            }
          }
        }
      } else if (!refined.css && currentCSS) {
        // Regular (non-visual-edit) refine: re-inject original CSS if LLM dropped it
        console.log(`[refine] LLM dropped CSS — re-injecting original CSS (${currentCSS.length} chars)`);
        refined.css = currentCSS;
        refined.mitosisSource = `${refined.mitosisSource}\n---CSS---\n${currentCSS}`;
        for (const fw of session.frameworks) {
          const code = refined.frameworkOutputs[fw];
          if (code && !code.startsWith('// Error')) {
            refined.frameworkOutputs[fw] = injectCSS(code, currentCSS, fw);
          }
        }
      }

      // Update session
      if (refiningShadcnSub) {
        // Shadcn sub-component refinement: update the sub-component source, NOT the wrapper
        const updatedSubSource = refined.frameworkOutputs.react || refined.mitosisSource.replace(/^\/\/ shadcn\/ui codegen\n?/, '');
        session.result.updatedShadcnSource = updatedSubSource;
        // Also update the shadcnSubComponents array entry
        if (session.result.shadcnSubComponents && session.result.shadcnComponentName) {
          const sub = session.result.shadcnSubComponents.find(
            (s: any) => s.shadcnComponentName === session.result.shadcnComponentName,
          );
          if (sub) sub.updatedShadcnSource = updatedSubSource;
        }
        console.log(`[refine] Shadcn sub-component updated (${updatedSubSource.length} chars). Wrapper unchanged.`);
      } else {
        session.result.mitosisSource = refined.mitosisSource;
        for (const [fw, code] of Object.entries(refined.frameworkOutputs)) {
          session.result.frameworkOutputs[fw as Framework] = code;
        }
      }
      session.result.css = refined.css || session.result.css;
      if (refined.elementMap) session.result.elementMap = refined.elementMap;

      // Increment per-session refine counter
      session.refineCount += 1;

      // Append to conversation history
      session.conversation.push(
        { role: 'user', content: `[Current code provided]\n\n${effectivePrompt}` },
        { role: 'assistant', content: refined.assistantMessage },
      );

      // Keep conversation history manageable (last 20 turns)
      if (session.conversation.length > 40) {
        session.conversation = session.conversation.slice(-40);
      }

      console.log(`[refine] Session updated. React code length: ${session.result.frameworkOutputs.react?.length || 0}. CSS length: ${session.result.css?.length || 0}`);
      if (refiningShadcnSub) {
        console.log(`[refine] Shadcn updatedShadcnSource length: ${session.result.updatedShadcnSource?.length || 0}`);
      }

      // Verification: check if visual edit values are present in the final output
      if (visualEdits && typeof visualEdits === 'object') {
        const checkTarget = refiningShadcnSub ? (session.result.updatedShadcnSource || '') : (session.result.frameworkOutputs.react || '');
        for (const [veId, item] of Object.entries(visualEdits as Record<string, { changes: Record<string, string | boolean> }>)) {
          for (const [prop, value] of Object.entries(item.changes)) {
            if (typeof value !== 'string') continue;
            const inCSS = (session.result.css || '').includes(value);
            const inCode = checkTarget.includes(value);
            console.log(`[refine-verify] veId="${veId}" ${prop}="${value}" → inCSS: ${inCSS}, inCode: ${inCode}`);
          }
        }
      }

      const completePayload: any = {
        frameworkOutputs: session.result.frameworkOutputs,
        mitosisSource: session.result.mitosisSource,
        elementMap: session.result.elementMap,
      };
      // Include updated shadcn data so the client can update its state
      if (refiningShadcnSub) {
        completePayload.updatedShadcnSource = session.result.updatedShadcnSource;
        completePayload.shadcnSubComponents = session.result.shadcnSubComponents;
      }
      sendEvent('complete', completePayload);
      res.end();
    })
    .catch((err) => {
      clearInterval(heartbeat);
      const message = err instanceof Error ? err.message : String(err);
      sendEvent('error', { message });
      if (!res.writableEnded) res.end();
    });
});

/**
 * GET /api/download/:sessionId — Zip download
 *
 * If a wired app/ directory exists on disk, ZIPs the full runnable project
 * (Lovable-style). Otherwise falls back to component-only ZIP.
 */
app.get('/api/download/:sessionId', requireAuth as any, requireSessionOwner as any, (req: any, res: any) => {
  const { sessionId } = req.params;
  const result = getSessionWithDiskFallback(sessionId);

  if (!result) {
    res.status(404).json({ error: 'Session not found or expired' });
    return;
  }

  // Try to find the wired app/ directory on disk
  let appDir: string | undefined;
  const primaryDir = join(config.server.outputDir, `${result.componentName}-${sessionId}`, 'app');
  if (existsSync(primaryDir)) {
    appDir = primaryDir;
  } else {
    // Disk fallback: scan for directory ending with -sessionId
    try {
      const dirs = readdirSync(config.server.outputDir, { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory() && d.name.endsWith(`-${sessionId}`)) {
          const candidate = join(config.server.outputDir, d.name, 'app');
          if (existsSync(candidate)) { appDir = candidate; break; }
        }
      }
    } catch { /* fall through */ }
  }

  // Full project ZIP when app/ directory exists
  if (appDir) {
    const zipName = `${result.componentName}-project.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);
    // Add all files from app/ (skip node_modules), flatten into ZIP root
    archive.directory(appDir, false, (entry: any) => {
      // Skip node_modules directory entries
      if (entry.name.startsWith('node_modules/') || entry.name === 'node_modules') return false;
      return entry;
    });
    archive.finalize();
    return;
  }

  // Fallback: component-only ZIP (no wired app available)
  const zipName = `${result.componentName}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(res);

  // Add Mitosis source
  archive.append(result.mitosisSource, {
    name: `${result.componentName}/${result.componentName}.lite.tsx`,
  });

  // Add framework outputs
  for (const [fw, code] of Object.entries(result.frameworkOutputs)) {
    if (code && !code.startsWith('// Error')) {
      const ext = FRAMEWORK_EXTENSIONS[fw as Framework] ?? '.tsx';
      archive.append(code, {
        name: `${result.componentName}/${result.componentName}${ext}`,
      });
    }
  }

  // Add SVG assets
  if (result.assets) {
    for (const asset of result.assets) {
      if (asset.content) {
        archive.append(asset.content, {
          name: `${result.componentName}/assets/${asset.filename}`,
        });
      }
    }
  }

  archive.finalize();
});

/**
 * Recursively read directory and return map of relative path -> content (UTF-8).
 * Skips node_modules and binary files.
 */
function readDirToFilesMap(dirPath: string, baseDir: string = dirPath): Record<string, string> {
  const out: Record<string, string> = {};
  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dirPath, e.name);
    const rel = full.slice(baseDir.length).replace(/^[/\\]/, '').replace(/\\/g, '/');
    if (e.name === 'node_modules') continue;
    if (e.isDirectory()) {
      Object.assign(out, readDirToFilesMap(full, baseDir));
    } else {
      try {
        const content = readFileSync(full, 'utf8');
        out[rel] = content;
      } catch {
        // skip binary or unreadable
      }
    }
  }
  return out;
}

/**
 * GET /api/session/:sessionId/wired-app-files — List and read all files in the wired app (template) directory
 */
app.get('/api/session/:sessionId/wired-app-files', requireSessionOwner as any, (req: any, res: any) => {
  const { sessionId } = req.params;
  let result = getSession(sessionId);

  // Try to find the app directory either via session or by scanning output dir
  let appDir: string | undefined;

  if (result) {
    appDir = join(config.server.outputDir, `${result.componentName}-${sessionId}`, 'app');
  } else {
    // Disk fallback: scan for directory ending with -sessionId
    const outputDir = config.server.outputDir;
    if (existsSync(outputDir)) {
      try {
        const dirs = readdirSync(outputDir, { withFileTypes: true });
        for (const d of dirs) {
          if (d.isDirectory() && d.name.endsWith(`-${sessionId}`)) {
            appDir = join(outputDir, d.name, 'app');
            break;
          }
        }
      } catch { /* fall through */ }
    }
  }

  if (!appDir || !existsSync(appDir)) {
    res.status(404).json({ error: 'No wired app for this session' });
    return;
  }
  const files = readDirToFilesMap(appDir);
  res.json({ files });
});

const FILE_EXTENSIONS: Record<string, string> = {
  mitosis: '.lite.tsx',
  react: '.jsx',
  vue: '.vue',
  svelte: '.svelte',
  angular: '.ts',
  solid: '.tsx',
};

/**
 * POST /api/save-file — Save edited file content
 */
app.post('/api/save-file', requireAuthOrFree as any, requireSessionOwner as any, async (req: any, res: any) => {
  const { sessionId, fileKey, content } = req.body;

  if (!sessionId || !fileKey || typeof content !== 'string') {
    res.status(400).json({ error: 'sessionId, fileKey, and content are required' });
    return;
  }

  const result = getSessionWithDiskFallback(sessionId);
  if (!result) {
    res.status(404).json({ error: 'Session not found or expired' });
    return;
  }

  const ext = FILE_EXTENSIONS[fileKey];
  if (!ext) {
    res.status(400).json({ error: `Invalid fileKey: ${fileKey}` });
    return;
  }

  try {
    if (fileKey === 'mitosis') {
      result.mitosisSource = content;
    } else if (SUPPORTED_FRAMEWORKS.includes(fileKey as Framework)) {
      result.frameworkOutputs[fileKey as Framework] = content;
    } else {
      res.status(400).json({ error: `Invalid fileKey: ${fileKey}` });
      return;
    }

    const componentOutputDir = join(config.server.outputDir, `${result.componentName}-${sessionId}`);
    const filename = `${result.componentName}${ext}`;
    const filePath = join(componentOutputDir, filename);
    await writeFile(filePath, content, 'utf-8');

    res.json({ success: true, message: 'File saved' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Failed to save: ${message}` });
  }
});

/**
 * GET /api/config — Returns Supabase config for GitHub push (if configured)
 */
app.get('/api/config', (_req: any, res: any) => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
  res.json({
    supabaseUrl: supabaseUrl || null,
    supabaseKey: supabaseKey || null,
    githubPushConfigured: Boolean(supabaseUrl && supabaseKey),
    authEnabled: isAuthEnabled(),
  });
});

/**
 * GET /api/session/:sessionId/push-files — Returns file list for GitHub push
 */
app.get('/api/session/:sessionId/push-files', requireSessionOwner as any, (req: any, res: any) => {
  const { sessionId } = req.params;
  const { mode } = req.query;
  const result = getSessionWithDiskFallback(sessionId);

  if (!result) {
    res.status(404).json({ error: 'Session not found or expired' });
    return;
  }

  const files: { name: string; content: string }[] = [];

  if (mode === 'wired') {
    const appDir = join(config.server.outputDir, `${result.componentName}-${sessionId}`, 'app');
    if (existsSync(appDir)) {
      const wiredFilesMap = readDirToFilesMap(appDir);
      for (const [name, content] of Object.entries(wiredFilesMap)) {
        files.push({ name, content });
      }
    }
  } else {
    // Mitosis source
    files.push({
      name: `${result.componentName}.lite.tsx`,
      content: result.mitosisSource,
    });

    // Chart components are inlined into the main React JSX — no separate files needed.

    // Framework outputs
    for (const [fw, code] of Object.entries(result.frameworkOutputs)) {
      if (code && !code.startsWith('// Error')) {
        const ext = FRAMEWORK_EXTENSIONS[fw as Framework] ?? '.tsx';
        files.push({
          name: `${result.componentName}${ext}`,
          content: code,
        });
      }
    }

    // Assets
    if (result.assets) {
      for (const asset of result.assets) {
        if (asset.content) {
          files.push({
            name: `assets/${asset.filename}`,
            content: asset.content,
          });
        }
      }
    }
  }

  res.json({ files });
});

/**
 * GET /auth/github/callback — OAuth callback page (posts code to opener, then closes)
 */
app.get('/auth/github/callback', (_req: any, res: any) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>GitHub Auth</title></head>
<body>
  <div style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;text-align:center;">
    <div>
      <p style="font-weight:500;">Connecting GitHub...</p>
      <p style="color:#71717a;font-size:12px;">If this window does not close automatically, you can close it.</p>
    </div>
  </div>
  <script>
    (function(){
      var q = new URLSearchParams(window.location.search);
      var payload = {
        type: 'github-oauth',
        code: q.get('code') || undefined,
        state: q.get('state') || undefined,
        error: q.get('error_description') || q.get('error') || undefined
      };
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(payload, window.location.origin);
        window.close();
      }
    })();
  </script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

/**
 * GET /api/preview/:sessionId — Standalone preview HTML
 */
app.get('/api/preview/:sessionId', requireSessionOwner as any, (req: any, res: any) => {
  const { sessionId } = req.params;
  const result = getSessionWithDiskFallback(sessionId);

  if (!result) {
    res.status(404).send('Session not found or expired');
    return;
  }

  const reactCode = result.frameworkOutputs.react;
  if (!reactCode) {
    res.status(404).send('No React output available for preview');
    return;
  }

  console.log(`[preview] Serving preview for ${sessionId}, react code length: ${reactCode.length}, first 100 chars: ${reactCode.substring(0, 100)}`);

  // Prevent browser caching so refinement updates are always fresh
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  // Build shadcn sub-components for preview inlining.
  // PATH A shadcn sets updatedShadcnSource + shadcnComponentName but NOT shadcnSubComponents.
  // PATH B composite sets shadcnSubComponents directly.
  // Merge both sources so the preview always has all shadcn component definitions.
  let previewShadcnSubs = result.shadcnSubComponents ? [...result.shadcnSubComponents] : [];
  if (result.updatedShadcnSource && result.shadcnComponentName) {
    const alreadyIncluded = previewShadcnSubs.some(
      (s) => s.shadcnComponentName === result.shadcnComponentName,
    );
    if (!alreadyIncluded) {
      previewShadcnSubs.push({
        shadcnComponentName: result.shadcnComponentName,
        updatedShadcnSource: result.updatedShadcnSource,
      });
    }
  }

  const html = generatePreviewHTML(
    reactCode,
    result.componentName,
    sessionId,
    result.componentPropertyDefinitions,
    result.chartComponents,
    previewShadcnSubs.length > 0 ? previewShadcnSubs : undefined,
  );
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

/**
 * GET /api/preview/:sessionId/assets/:filename — Serve SVG assets for preview
 */
app.get('/api/preview/:sessionId/assets/:filename', requireSessionOwner as any, (req: any, res: any) => {
  const { sessionId, filename } = req.params;

  // Reject path traversal attempts
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    res.status(400).send('Invalid filename');
    return;
  }

  let result = getSession(sessionId);

  // Try in-memory first, then disk fallback for asset file directly
  if (result) {
    const asset = result.assets?.find((a) => a.filename === filename);
    if (asset?.content) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.send(asset.content);
      return;
    }
  }

  // Disk fallback: read asset file directly from output directory
  const outputDir = config.server.outputDir;
  if (existsSync(outputDir)) {
    try {
      const dirs = readdirSync(outputDir, { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory() && d.name.endsWith(`-${sessionId}`)) {
          const assetPath = join(outputDir, d.name, 'assets', filename);
          if (existsSync(assetPath)) {
            const content = readFileSync(assetPath, 'utf-8');
            res.setHeader('Content-Type', 'image/svg+xml');
            res.send(content);
            return;
          }
        }
      }
    } catch { /* fall through to 404 */ }
  }

  res.status(404).send('Asset not found');
});

// Global Express error handler — catches any unhandled errors in route handlers
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('[express] Unhandled route error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`\n  Figma → Code Web UI`);
  console.log(`  http://localhost:${PORT}\n`);
});

// Increase timeouts for long-running SSE connections (LLM calls can take minutes)
server.keepAliveTimeout = 10 * 60 * 1000;  // 10 minutes
server.headersTimeout = 10 * 60 * 1000 + 1000;  // slightly more than keepAliveTimeout
server.requestTimeout = 0;  // disable request timeout for SSE streams
