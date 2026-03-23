import 'dotenv/config';
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
import { SUPPORTED_FRAMEWORKS, FRAMEWORK_EXTENSIONS } from '../types/index.js';
import type { Framework, ConversionResult } from '../types/index.js';
import type { LLMMessage } from '../llm/provider.js';
import { createLLMProvider } from '../llm/index.js';
import { config } from '../config.js';
import { wireIntoStarter } from '../template/wire-into-starter.js';
import { injectCSS } from '../compile/inject-css.js';
import { attachUser, requireAuth, requireAuthOrFree, incrementFreeTierUsage, isAuthEnabled } from './auth/index.js';
import { authRoutes } from './auth/index.js';

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
}

const sessionStore = new Map<string, SessionEntry>();

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

function setSession(id: string, result: ConversionResult, llmProvider?: string, frameworks?: Framework[]): void {
  const existing = sessionStore.get(id);
  sessionStore.set(id, {
    result,
    createdAt: Date.now(),
    conversation: existing?.conversation || [],
    llmProvider: llmProvider || existing?.llmProvider || config.server.defaultLLM,
    frameworks: frameworks || existing?.frameworks || ['react'],
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

  return {
    componentName,
    mitosisSource,
    frameworkOutputs: frameworkOutputs as any,
    assets,
    componentPropertyDefinitions,
    chartComponents,
    shadcnSubComponents: shadcnSubComponents.length > 0 ? shadcnSubComponents : undefined,
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

// Periodic cleanup of expired sessions (every 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of sessionStore) {
    if (now - entry.createdAt > SESSION_TTL_MS) {
      sessionStore.delete(id);
    }
  }
}, 10 * 60 * 1000);

// Middleware
app.use(express.json({ limit: config.server.jsonLimit }));
app.use(cookieParser());
app.use(attachUser as any);

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
 * POST /api/convert — SSE endpoint
 *
 * Accepts JSON body: { figmaUrl, figmaToken, frameworks }
 * Streams progress via Server-Sent Events, then sends completion data.
 */
app.post('/api/convert', requireAuthOrFree as any, (req: any, res: any) => {
  const { figmaUrl, figmaToken, frameworks, name, llm: requestedLLM, template } = req.body;

  // Validate inputs
  if (!figmaUrl || typeof figmaUrl !== 'string') {
    res.status(400).json({ error: 'figmaUrl is required' });
    return;
  }
  if (!figmaToken || typeof figmaToken !== 'string') {
    res.status(400).json({ error: 'figmaToken is required' });
    return;
  }

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
        sendEvent('step', { message: step });
      },
      onAttempt: (attempt, maxRetries, error) => {
        sendEvent('attempt', { attempt, maxRetries, error: error || null });
      },
    },
  )
    .then((result) => {
      clearInterval(heartbeat);

      try {
        // Increment free tier usage for anonymous users
        if ((req as any)._fingerprint) {
          incrementFreeTierUsage((req as any)._fingerprint);
        }

        // Store result in session
        const llmName = (requestedLLM && typeof requestedLLM === 'string' ? requestedLLM : config.server.defaultLLM);
        setSession(sessionId, result, llmName, selectedFrameworks);

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
          sendEvent('step', { message: `Output saved to ${componentOutputDir}` });
        } catch (writeErr) {
          const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
          sendEvent('step', { message: `Warning: Could not save output to disk: ${msg}` });
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
                message: `Template wired: runnable app in app/ (see Wired app in code view)`,
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              sendEvent('step', { message: `Template wiring failed: ${msg}` });
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
 * POST /api/refine — SSE endpoint for iterative refinement
 *
 * Accepts JSON body: { sessionId, prompt }
 * Streams progress via Server-Sent Events, then sends updated code.
 */
app.post('/api/refine', (req: any, res: any) => {
  const { sessionId, prompt, selectedElement } = req.body;

  if (!sessionId || typeof sessionId !== 'string') {
    res.status(400).json({ error: 'sessionId is required' });
    return;
  }
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    res.status(400).json({ error: 'prompt is required' });
    return;
  }

  const session = getSessionEntry(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found or expired' });
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

  refineComponent({
    currentMitosis,
    currentCSS,
    userPrompt: prompt.trim(),
    conversation: session.conversation,
    llmProvider,
    frameworks: session.frameworks,
    componentName: session.result.componentName,
    selectedElement: selectedElement && typeof selectedElement === 'object' ? selectedElement : undefined,
    elementMap: session.result.elementMap,
    onStep: (step) => sendEvent('step', { message: step }),
  })
    .then((refined) => {
      clearInterval(heartbeat);
      // Safety net: if LLM dropped CSS during refinement, re-inject the original CSS
      if (!refined.css && currentCSS) {
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
      session.result.mitosisSource = refined.mitosisSource;
      for (const [fw, code] of Object.entries(refined.frameworkOutputs)) {
        session.result.frameworkOutputs[fw as Framework] = code;
      }
      session.result.css = refined.css || session.result.css;
      if (refined.elementMap) session.result.elementMap = refined.elementMap;

      // Append to conversation history
      session.conversation.push(
        { role: 'user', content: `[Current code provided]\n\n${prompt.trim()}` },
        { role: 'assistant', content: refined.assistantMessage },
      );

      // Keep conversation history manageable (last 20 turns)
      if (session.conversation.length > 40) {
        session.conversation = session.conversation.slice(-40);
      }

      console.log(`[refine] Session updated. React code length: ${session.result.frameworkOutputs.react?.length || 0}`);

      sendEvent('complete', {
        frameworkOutputs: session.result.frameworkOutputs,
        mitosisSource: session.result.mitosisSource,
        elementMap: session.result.elementMap,
      });
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
app.get('/api/download/:sessionId', requireAuth as any, (req: any, res: any) => {
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
app.get('/api/session/:sessionId/wired-app-files', (req: any, res: any) => {
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
app.post('/api/save-file', async (req: any, res: any) => {
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
app.get('/api/session/:sessionId/push-files', (req: any, res: any) => {
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
app.get('/api/preview/:sessionId', (req: any, res: any) => {
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
app.get('/api/preview/:sessionId/assets/:filename', (req: any, res: any) => {
  const { sessionId, filename } = req.params;
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
