import type { FigmaUrlParts } from '../types/index.js';

/**
 * Extracts fileKey and optional nodeId from any Figma URL format.
 *
 * Supported formats:
 *   https://www.figma.com/file/XXXX/Title
 *   https://www.figma.com/file/XXXX/Title?node-id=123:456
 *   https://www.figma.com/design/XXXX/Title?node-id=123-456
 *   https://www.figma.com/design/XXXX/Title?node-id=123%3A456
 */
export function parseFigmaUrl(url: string): FigmaUrlParts {
  const fileMatch = url.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/);
  if (!fileMatch) {
    throw new Error(
      `Invalid Figma URL: "${url}"\n` +
      'Expected format: https://www.figma.com/design/<fileKey>/...'
    );
  }

  const fileKey = fileMatch[1];

  // Extract node-id from query string (supports : or - or %3A separators)
  const nodeMatch = url.match(/node-id=([^&]+)/);
  let nodeId: string | undefined;

  if (nodeMatch) {
    // Decode URI component first, then normalize dash to colon
    nodeId = decodeURIComponent(nodeMatch[1]).replace(/-/, ':');

    // Validate the format is digits:digits
    if (!/^\d+:\d+$/.test(nodeId)) {
      throw new Error(
        `Invalid node-id format: "${nodeMatch[1]}"\n` +
        'Expected format: 123:456 or 123-456'
      );
    }
  }

  return { fileKey, nodeId };
}
