/**
 * shadcn/ui Source Reader (Option A)
 *
 * Reads base shadcn component source from the starter template on disk.
 * No network, no registry API — just readFileSync.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** In-memory cache: component name → source code */
const cache = new Map<string, string>();

/**
 * Read the base shadcn component source from the starter template.
 * Path: src/figma-to-code-starter-main/src/components/ui/{name}.tsx
 *
 * @throws if the file doesn't exist
 */
export function readShadcnSource(componentName: string): string {
  const cached = cache.get(componentName);
  if (cached) return cached;

  const starterDir = join(__dirname, '..', 'figma-to-code-starter-main');
  const filePath = join(starterDir, 'src', 'components', 'ui', `${componentName}.tsx`);

  if (!existsSync(filePath)) {
    throw new Error(
      `shadcn base source not found: ${filePath}\n` +
      `Add the ${componentName}.tsx file to the starter template.`
    );
  }

  const source = readFileSync(filePath, 'utf-8');
  cache.set(componentName, source);
  return source;
}

/**
 * Clear the source cache (for testing).
 */
export function clearSourceCache(): void {
  cache.clear();
}
