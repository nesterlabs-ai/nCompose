import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSystemPrompt } from './system-prompt.js';
import { loadFewShotExamples } from './few-shot-examples.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Assembles the full system prompt by combining:
 * 1. The base system prompt (Mitosis rules, styling mappings, semantic mapping)
 * 2. Few-shot examples (input/output pairs)
 *
 * This is passed as the system/instruction message to the LLM.
 */
export function assembleSystemPrompt(): string {
  const base = loadSystemPrompt();
  const examples = loadFewShotExamples();

  return `${base}

## Few-Shot Examples

${examples}`;
}

/**
 * Assembles the user prompt from the simplified Figma YAML.
 * Wraps the YAML in clear delimiters so the LLM knows where
 * design data starts and ends.
 *
 * @param yamlContent - The simplified Figma design as a YAML string
 * @param componentName - Optional component name hint
 * @param semanticHint - Optional semantic HTML hint (detected category, tag, ARIA role)
 */
export function assembleUserPrompt(
  yamlContent: string,
  componentName?: string,
  semanticHint?: string,
): string {
  const nameHint = componentName
    ? `\nComponent name: ${componentName}\n`
    : '';

  const semanticBlock = semanticHint
    ? `\n${semanticHint}\n`
    : '';

  return `Convert the following Figma design to a Mitosis component (.lite.tsx):
${nameHint}${semanticBlock}
Fidelity requirements:
- Preserve exact text content from Figma; do NOT replace with placeholders.
- Preserve exact numeric dimensions, spacing, and typography values from the design data.
- Do not invent responsive substitutions unless they are explicitly present in the input.

\`\`\`yaml
${yamlContent.trim()}
\`\`\``;
}

// ── Page section prompts (PATH C) ──────────────────────────────────────────

const PAGE_SECTION_PROMPT_PATH = resolve(__dirname, '../../prompts/page-section.md');
let cachedPageSection: string | null = null;

function loadPageSectionPrompt(): string {
  if (cachedPageSection) return cachedPageSection;
  cachedPageSection = readFileSync(PAGE_SECTION_PROMPT_PATH, 'utf-8').trim();
  return cachedPageSection;
}

/**
 * Assembles the system prompt for a single page section.
 * Combines the base system prompt with the page-section addendum.
 */
export function assemblePageSectionSystemPrompt(): string {
  const base = loadSystemPrompt();
  const sectionAddendum = loadPageSectionPrompt();
  return `${base}\n\n${sectionAddendum}`;
}

/**
 * Assembles the user prompt for a single page section in PATH C.
 *
 * @param yamlContent - The simplified Figma data for this section
 * @param sectionName - Human-readable section name (e.g. "Hero")
 * @param sectionIndex - 1-based index of this section within the page
 * @param totalSections - Total number of sections in the page
 */
export function assemblePageSectionUserPrompt(
  yamlContent: string,
  sectionName: string,
  sectionIndex: number,
  totalSections: number,
): string {
  return `Convert the following Figma section to static Mitosis JSX (.lite.tsx).

This is **Section ${sectionIndex} of ${totalSections}: "${sectionName}"**.

Use BEM class names prefixed with "${sectionName.toLowerCase().replace(/\s+/g, '-')}" (e.g. "${sectionName.toLowerCase().replace(/\s+/g, '-')}__title").
Preserve exact text content and numeric dimensions from the input data.
Do not replace labels/content with placeholders.

\`\`\`yaml
${yamlContent.trim()}
\`\`\``;
}
