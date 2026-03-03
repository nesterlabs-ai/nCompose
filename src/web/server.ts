import 'dotenv/config';
import express from 'express';
import archiver from 'archiver';
import { writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { convertFigmaToCode } from '../convert.js';
import { writeOutputFiles } from '../output.js';
import { generateSessionId } from '../utils/session-id.js';
import { generatePreviewHTML } from './preview.js';
import { SUPPORTED_FRAMEWORKS, FRAMEWORK_EXTENSIONS } from '../types/index.js';
import type { Framework, ConversionResult } from '../types/index.js';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = config.server.port;

// In-memory session storage
const sessions = new Map<string, ConversionResult>();

// Middleware
app.use(express.json({ limit: config.server.jsonLimit }));

// Serve static files
app.use(express.static(join(__dirname, 'public')));

/**
 * POST /api/convert — SSE endpoint
 *
 * Accepts JSON body: { figmaUrl, figmaToken, frameworks }
 * Streams progress via Server-Sent Events, then sends completion data.
 */
app.post('/api/convert', (req: any, res: any) => {
  const { figmaUrl, figmaToken, frameworks, name } = req.body;

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

  // Set the Figma token for this request
  const previousToken = process.env.FIGMA_TOKEN;
  process.env.FIGMA_TOKEN = figmaToken;

  const sessionId = generateSessionId();

  sendEvent('step', { message: 'Starting conversion...' });

  convertFigmaToCode(
    figmaUrl,
    {
      frameworks: selectedFrameworks,
      output: config.server.outputDir,
      name: name && typeof name === 'string' ? name.trim() : undefined,
      llm: config.server.defaultLLM as any,
      depth: config.server.defaultDepth,
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
      sessions.set(sessionId, result);

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
        });
        sendEvent('step', { message: `Output saved to ${componentOutputDir}` });
      } catch (writeErr) {
        const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
        sendEvent('step', { message: `Warning: Could not save output to disk: ${msg}` });
      }

      // Send framework outputs for code display
      sendEvent('complete', {
        sessionId,
        componentName: result.componentName,
        frameworks: selectedFrameworks,
        frameworkOutputs: result.frameworkOutputs,
        mitosisSource: result.mitosisSource,
        assetCount: result.assets?.length ?? 0,
        fidelity: result.fidelityReport
          ? {
              overallPassed: result.fidelityReport.overallPassed,
              checks: Object.fromEntries(
                Object.entries(result.fidelityReport.checks).map(([k, v]) => [k, v?.passed ?? false]),
              ),
            }
          : undefined,
      });

      res.end();
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      sendEvent('error', { message });
      res.end();
    })
    .finally(() => {
      // Restore previous token
      if (previousToken !== undefined) {
        process.env.FIGMA_TOKEN = previousToken;
      } else {
        delete process.env.FIGMA_TOKEN;
      }
    });

  // Handle client disconnect
  req.on('close', () => {
    // Client disconnected — pipeline continues but events stop
  });
});

/**
 * GET /api/download/:sessionId — Zip download
 */
app.get('/api/download/:sessionId', (req: any, res: any) => {
  const { sessionId } = req.params;
  const result = sessions.get(sessionId);

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

  const result = sessions.get(sessionId);
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
  const result = sessions.get(sessionId);

  if (!result) {
    res.status(404).json({ error: 'Session not found or expired' });
    return;
  }

  const files: { name: string; content: string }[] = [];

  // Mitosis source
  files.push({
    name: `${result.componentName}.lite.tsx`,
    content: result.mitosisSource,
  });

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
  const result = sessions.get(sessionId);

  if (!result) {
    res.status(404).send('Session not found or expired');
    return;
  }

  const reactCode = result.frameworkOutputs.react;
  if (!reactCode) {
    res.status(404).send('No React output available for preview');
    return;
  }

  const html = generatePreviewHTML(
    reactCode,
    result.componentName,
    sessionId,
    result.componentPropertyDefinitions,
    result.variantMetadata,
  );
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

/**
 * GET /api/preview/:sessionId/assets/:filename — Serve SVG assets for preview
 */
app.get('/api/preview/:sessionId/assets/:filename', (req: any, res: any) => {
  const { sessionId, filename } = req.params;
  const result = sessions.get(sessionId);

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
