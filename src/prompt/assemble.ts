import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSystemPrompt } from './system-prompt.js';
import { loadFewShotExamples } from './few-shot-examples.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TEMPLATE_MODE_PROMPT_PATH = resolve(__dirname, '../../prompts/template-mode.md');
let cachedTemplateModeAddendum: string | null = null;

/**
 * Loads the template-mode addendum (Tailwind + cn() + CSS variables for the starter).
 * Exported for use in variant-prompt-builder (PATH A).
 */
export function loadTemplateModeAddendum(): string {
  if (cachedTemplateModeAddendum) return cachedTemplateModeAddendum;
  cachedTemplateModeAddendum = readFileSync(TEMPLATE_MODE_PROMPT_PATH, 'utf-8').trim();
  return cachedTemplateModeAddendum;
}

/**
 * Assembles the full system prompt by combining:
 * 1. The base system prompt (Mitosis rules, styling mappings, semantic mapping)
 * 2. Few-shot examples (input/output pairs)
 * 3. Optionally: template-mode addendum (Tailwind + CSS variables for starter)
 *
 * This is passed as the system/instruction message to the LLM.
 */
export function assembleSystemPrompt(templateMode?: boolean): string {
  const base = loadSystemPrompt();
  const examples = loadFewShotExamples();
  // Do not inject Tailwind/template-mode styling; keep original BEM + CSS class strategy
  const templateBlock = '';

  return `${base}

## Few-Shot Examples

${examples}${templateBlock}`;
}

/**
 * Assembles the user prompt from the simplified Figma YAML.
 * Wraps the YAML in clear delimiters so the LLM knows where
 * design data starts and ends.
 *
 * @param yamlContent - The simplified Figma design as a YAML string
 * @param componentName - Optional component name hint
 * @param semanticHint - Optional semantic HTML hint (detected category, tag, ARIA role)
 * @param templateMode - When true, remind LLM to use Tailwind + CSS variables for the starter
 */
export function assembleUserPrompt(
  yamlContent: string,
  componentName?: string,
  semanticHint?: string,
  templateMode?: boolean,
  assetHints?: string,
): string {
  const nameHint = componentName
    ? `\nComponent name: ${componentName}\n`
    : '';

  const semanticBlock = semanticHint
    ? `\n${semanticHint}\n`
    : '';

  // Do not inject Tailwind instructions; use same class/CSS strategy as non-template mode
  const templateReminder = '';

  const assetBlock = assetHints || '';

  return `Convert the following Figma design to a Mitosis component (.lite.tsx):
${nameHint}${semanticBlock}${templateReminder}${assetBlock}
Fidelity requirements:
- **PIXEL PERFECT** — every CSS value must match the YAML data exactly. Copy fills, text colors, font sizes, border colors, shadows, and border-radius values VERBATIM.
- Preserve exact text content from Figma; do NOT replace with placeholders.
- Preserve exact numeric dimensions, spacing, and typography values from the design data.
- Every node with visual properties (fills, border, shadows, textStyle, borderRadius, opacity) MUST have a CSS class with those exact values.
- **TEXT nodes**: Do NOT apply fills as background-color. Text color is already in textStyle.color.
- **ICON nodes** (type: ICON with assetFile): MUST render as \`<img src="{assetFile}" alt="" />\` with the node's width and height. Never render as empty div or CSS shape.
- Do not invent responsive substitutions unless they are explicitly present in the input.
- Do NOT skip any visual property from the YAML — if it exists, it must appear in the CSS.

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
 * When templateMode is true, appends the template-mode styling addendum.
 */
export function assemblePageSectionSystemPrompt(templateMode?: boolean): string {
  const base = loadSystemPrompt();
  const sectionAddendum = loadPageSectionPrompt();
  const templateBlock = '';
  return `${base}\n\n${sectionAddendum}${templateBlock}`;
}

export interface PageSectionContext {
  /** Page width in pixels */
  pageWidth?: number;
  /** Page height in pixels */
  pageHeight?: number;
  /** Gap between sections in pixels */
  sectionGap?: number;
  /** Page-level padding */
  pagePadding?: { top: number; right: number; bottom: number; left: number };
  /** Name of the section immediately before this one (null if first) */
  prevSectionName?: string | null;
  /** Name of the section immediately after this one (null if last) */
  nextSectionName?: string | null;
  /** Dominant background color of the page root */
  pageBackground?: string;
  /** This section's width in pixels (from absoluteBoundingBox) */
  sectionWidth?: number;
  /** This section's height in pixels (from absoluteBoundingBox) */
  sectionHeight?: number;
  /** How this section is positioned in the page layout */
  sectionPositioning?: 'flex' | 'absolute';
  /** Horizontal sizing mode from Figma auto-layout */
  sectionWidthMode?: 'fill' | 'hug' | 'fixed';
  /** Vertical sizing mode from Figma auto-layout */
  sectionHeightMode?: 'fill' | 'hug' | 'fixed';
  /** Page-level layout direction */
  pageLayoutDirection?: 'row' | 'column' | 'none';
}

/**
 * Assembles the user prompt for a single page section in PATH C.
 *
 * @param yamlContent - The simplified Figma data for this section
 * @param sectionName - Human-readable section name (e.g. "Hero")
 * @param sectionIndex - 1-based index of this section within the page
 * @param totalSections - Total number of sections in the page
 * @param ctx - Optional page-level context (width, gap, neighbors)
 * @param templateMode - When true, remind LLM to use Tailwind + CSS variables
 */
export function assemblePageSectionUserPrompt(
  yamlContent: string,
  sectionName: string,
  sectionIndex: number,
  totalSections: number,
  ctx?: PageSectionContext,
  templateMode?: boolean,
): string {
  const slug = sectionName.toLowerCase().replace(/\s+/g, '-');
  const templateReminder = '';

  const contextLines: string[] = [];
  if (ctx) {
    if (ctx.pageWidth) contextLines.push(`- Page canvas width: ${ctx.pageWidth}px`);
    if (ctx.sectionGap) contextLines.push(`- Gap between sections: ${ctx.sectionGap}px`);
    if (ctx.pagePadding) {
      const { top, right, bottom, left } = ctx.pagePadding;
      if (top || right || bottom || left) {
        contextLines.push(`- Page padding: ${top}px ${right}px ${bottom}px ${left}px`);
      }
    }
    if (ctx.sectionWidth) contextLines.push(`- **This section's width: ${ctx.sectionWidth}px** — your root element MUST NOT exceed this width`);
    if (ctx.sectionHeight) contextLines.push(`- **This section's height: ${ctx.sectionHeight}px**`);
    if (ctx.pageBackground) contextLines.push(`- Page background: ${ctx.pageBackground}`);
    if (ctx.prevSectionName) contextLines.push(`- Previous section: "${ctx.prevSectionName}"`);
    else contextLines.push(`- This is the FIRST section (no section above)`);
    if (ctx.nextSectionName) contextLines.push(`- Next section: "${ctx.nextSectionName}"`);
    else contextLines.push(`- This is the LAST section (no section below)`);
    if (ctx.sectionPositioning) {
      const dir = ctx.pageLayoutDirection ?? 'column';
      contextLines.push(`- **Section positioning: ${ctx.sectionPositioning}** — this section is a ${ctx.sectionPositioning} item in a ${dir} layout`);
    }
    if (ctx.sectionWidthMode) {
      if (ctx.sectionWidthMode === 'fill') contextLines.push(`- **Width mode: fill** — use width: 100%, NOT a fixed pixel value`);
      else if (ctx.sectionWidthMode === 'hug') contextLines.push(`- **Width mode: hug** — use width: auto (fit content), NOT a fixed pixel value`);
      else contextLines.push(`- **Width mode: fixed** — use the exact pixel value from section width`);
    }
    if (ctx.sectionHeightMode) {
      if (ctx.sectionHeightMode === 'fill') contextLines.push(`- **Height mode: fill** — use height: 100% or flex: 1, NOT a fixed pixel value`);
      else if (ctx.sectionHeightMode === 'hug') contextLines.push(`- **Height mode: hug** — use height: auto, NOT a fixed pixel value`);
      else contextLines.push(`- **Height mode: fixed** — use the exact pixel value from section height`);
    }
  }

  const contextBlock = contextLines.length > 0
    ? `\n**Page context:**\n${contextLines.join('\n')}\n`
    : '';

  return `Convert the following Figma section to static Mitosis JSX (.lite.tsx).

This is **Section ${sectionIndex} of ${totalSections}: "${sectionName}"**.
${contextBlock}${templateReminder}
Use BEM class names prefixed with "${slug}" (e.g. "${slug}__title", "${slug}__cta-button").
- Do NOT invent class names — derive them from the element's role in the design.
- **PIXEL PERFECT CSS** — copy ALL fills, colors, fonts, borders, shadows, border-radius, opacity values VERBATIM from the YAML into CSS. Do NOT skip or approximate any visual property.
- Preserve exact text content and numeric dimensions from the input data.
- Do not replace labels/content with placeholders.
- If a fill has type "image", render it as a CSS background-image (cover/contain based on scaleMode).
- Every YAML node with visual properties MUST get a CSS rule with ALL those properties.
- **TEXT nodes**: Do NOT apply fills as background-color. Text color is already in textStyle.color.
- **ICON nodes** (type: ICON with assetFile): MUST render as \`<img src="{assetFile}" alt="" />\` with the node's width and height. Never render as empty div or CSS shape.

\`\`\`yaml
${yamlContent.trim()}
\`\`\``;
}
