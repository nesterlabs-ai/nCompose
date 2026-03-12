import 'dotenv/config';
import express from 'express';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

// Required for WebContainer (SharedArrayBuffer needs cross-origin isolation)
app.use((_req: any, res: any, next: any) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  next();
});

// Serve static files
app.use(express.static(join(__dirname, 'public')));

/**
 * POST /api/convert — SSE endpoint
 *
 * Accepts JSON body: { figmaUrl, figmaToken, frameworks }
 * Streams progress via Server-Sent Events, then sends completion data.
 */
app.post('/api/convert', (req: any, res: any) => {
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

  const sendEvent = (event: string, data: Record<string, unknown>) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

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
            wireIntoStarter({
              componentOutputDir,
              componentName: result.componentName,
              starterDir,
              componentPropertyDefinitions: result.componentPropertyDefinitions,
              updatedShadcnSource: result.updatedShadcnSource,
              shadcnComponentName: result.shadcnComponentName,
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
        templateWired,
        assetCount: result.assets?.length ?? 0,
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
        componentPropertyDefinitions: result.componentPropertyDefinitions ?? undefined,
      });

      res.end();
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      sendEvent('error', { message });
      res.end();
    })
    ;

  // Handle client disconnect
  req.on('close', () => {
    // Client disconnected — pipeline continues but events stop
  });
});

/**
 * POST /api/refine — SSE endpoint for iterative refinement
 *
 * Accepts JSON body: { sessionId, prompt }
 * Streams progress via Server-Sent Events, then sends updated code.
 */
app.post('/api/refine', (req: any, res: any) => {
  const { sessionId, prompt } = req.body;

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

  const sendEvent = (event: string, data: Record<string, unknown>) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

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
    onStep: (step) => sendEvent('step', { message: step }),
  })
    .then((refined) => {
      // Update session
      session.result.mitosisSource = refined.mitosisSource;
      for (const [fw, code] of Object.entries(refined.frameworkOutputs)) {
        session.result.frameworkOutputs[fw as Framework] = code;
      }
      session.result.css = refined.css || session.result.css;

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
      });
      res.end();
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      sendEvent('error', { message });
      res.end();
    });

  req.on('close', () => {
    // Client disconnected
  });
});

/**
 * GET /api/download/:sessionId — Zip download
 */
app.get('/api/download/:sessionId', (req: any, res: any) => {
  const { sessionId } = req.params;
  const result = getSession(sessionId);

  if (!result) {
    res.status(404).json({ error: 'Session not found or expired' });
    return;
  }

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

  // Chart components are inlined into the main React JSX — no separate files needed.

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
  const result = getSession(sessionId);
  if (!result) {
    res.status(404).json({ error: 'Session not found or expired' });
    return;
  }
  const appDir = join(config.server.outputDir, `${result.componentName}-${sessionId}`, 'app');
  if (!existsSync(appDir)) {
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

  const result = getSession(sessionId);
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
  });
});

/**
 * GET /api/session/:sessionId/push-files — Returns file list for GitHub push
 */
app.get('/api/session/:sessionId/push-files', (req: any, res: any) => {
  const { sessionId } = req.params;
  const { mode } = req.query;
  const result = getSession(sessionId);

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
  const result = getSession(sessionId);

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

  const html = generatePreviewHTML(
    reactCode,
    result.componentName,
    sessionId,
    result.componentPropertyDefinitions,
    result.chartComponents,
  );
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

/**
 * GET /api/preview/:sessionId/assets/:filename — Serve SVG assets for preview
 */
app.get('/api/preview/:sessionId/assets/:filename', (req: any, res: any) => {
  const { sessionId, filename } = req.params;
  const result = getSession(sessionId);

  if (!result) {
    res.status(404).send('Session not found');
    return;
  }

  const asset = result.assets?.find((a) => a.filename === filename);
  if (!asset?.content) {
    res.status(404).send('Asset not found');
    return;
  }

  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(asset.content);
});

// Start server
app.listen(PORT, () => {
  console.log(`\n  Figma → Code Web UI`);
  console.log(`  http://localhost:${PORT}\n`);
});
