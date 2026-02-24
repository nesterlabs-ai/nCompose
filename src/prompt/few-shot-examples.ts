import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Directory containing few-shot example markdown files.
 */
const EXAMPLES_DIR = resolve(__dirname, '../../prompts/examples');

/**
 * Loads all .md files from prompts/examples/ and returns their
 * contents concatenated with blank-line separators.
 *
 * Each example file should contain an Input/Output pair in markdown.
 * Cached after first read.
 */
let cached: string | null = null;

export function loadFewShotExamples(): string {
  if (cached) return cached;

  const files = readdirSync(EXAMPLES_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort(); // deterministic order: button, card, form, navbar

  const examples = files.map((file) =>
    readFileSync(resolve(EXAMPLES_DIR, file), 'utf-8').trim(),
  );

  cached = examples.join('\n\n---\n\n');
  return cached;
}

/**
 * Returns the number of loaded example files (useful for tests).
 */
export function getExampleCount(): number {
  const files = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.md'));
  return files.length;
}
