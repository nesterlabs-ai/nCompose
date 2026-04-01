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
export function parseFigmaUrl(rawInput: string): FigmaUrlParts {
  // Extract the first URL from surrounding text (e.g. "Implement this design from Figma. @https://...")
  const urlMatch = rawInput.match(/https?:\/\/[^\s]+/);
  const url = urlMatch ? urlMatch[0] : rawInput.trim();

  // Validate hostname to prevent SSRF (CWE-918)
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `Invalid Figma URL: "${url}"\n` +
      'Expected format: https://www.figma.com/design/<fileKey>/...'
    );
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Figma URL must use HTTPS protocol');
  }

  if (parsed.hostname !== 'www.figma.com' && parsed.hostname !== 'figma.com') {
    throw new Error(
      `Invalid Figma hostname: "${parsed.hostname}"\n` +
      'URL must point to figma.com or www.figma.com'
    );
  }

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
