import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Path to the system prompt markdown file.
 */
const SYSTEM_PROMPT_PATH = resolve(__dirname, '../../prompts/system.md');

/**
 * Loads and returns the system prompt from prompts/system.md.
 * Cached after first read.
 */
let cached: string | null = null;

export function loadSystemPrompt(): string {
  if (cached) return cached;
  cached = readFileSync(SYSTEM_PROMPT_PATH, 'utf-8').trim();
  return cached;
}
