import 'dotenv/config';
import express from 'express';
import archiver from 'archiver';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { convertFigmaToCode } from '../convert.js';
import { generateSessionId } from '../utils/session-id.js';
import { generatePreviewHTML } from './preview.js';
import { SUPPORTED_FRAMEWORKS, FRAMEWORK_EXTENSIONS } from '../types/index.js';
import type { Framework, ConversionResult } from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// In-memory session storage
const sessions = new Map<string, ConversionResult>();

// Middleware
app.use(express.json({ limit: '1mb' }));

// Serve static files
app.use(express.static(join(__dirname, 'public')));

/**
 * POST /api/convert — SSE endpoint
 *
 * Accepts JSON body: { figmaUrl, figmaToken, frameworks }
 * Streams progress via Server-Sent Events, then sends completion data.
 */
app.post('/api/convert', (req, res) => {
  const { figmaUrl, figmaToken, frameworks } = req.body;

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
      output: './output',
      llm: 'claude',
      depth: 25,
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

      // Send framework outputs for code display
      sendEvent('complete', {
        sessionId,
        componentName: result.componentName,
        frameworks: selectedFrameworks,
        frameworkOutputs: result.frameworkOutputs,
        mitosisSource: result.mitosisSource,
        assetCount: result.assets?.length ?? 0,
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
app.get('/api/download/:sessionId', (req, res) => {
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

/**
 * GET /api/preview/:sessionId — Standalone preview HTML
 */
app.get('/api/preview/:sessionId', (req, res) => {
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
    result.assets?.map((a) => a.filename) ?? [],
  );
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

/**
 * GET /api/preview/:sessionId/assets/:filename — Serve SVG assets for preview
 */
app.get('/api/preview/:sessionId/assets/:filename', (req, res) => {
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
