/**
 * Component Generation — Hierarchical Pipeline
 *
 * PATH 1: generateSingleComponent()  — one INSTANCE node → semantic HTML + CSS
 * PATH 2: generateCompoundSection()  — section with nested INSTANCEs →
 *           discovers components, generates each via PATH 1, substitutes,
 *           then generates the section layout.
 *
 * Both are used by PATH 3 (convertPage) in convert.ts.
 */

import { dump } from 'js-yaml';
import type { LLMProvider } from '../llm/provider.js';
import type { ParseResult } from '../types/index.js';
import { generateWithRetry } from './retry.js';
import { extractJSXBody } from './stitch.js';
import {
  assembleSystemPrompt,
  assembleUserPrompt,
  assemblePageSectionSystemPrompt,
  assemblePageSectionUserPrompt,
  type PageSectionContext,
} from '../prompt/index.js';
import {
  discoverComponents,
  type DiscoveredComponent,
  type ComponentDiscoveryResult,
} from '../figma/component-discovery.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface GeneratedComponent {
  /** Component name (e.g., "Dropdown Field") */
  name: string;
  /** Inferred form role (e.g., "select", "textInput") */
  formRole: string;
  /** Generated JSX body (without export default function wrapper) */
  html: string;
  /** Generated CSS for this component */
  css: string;
  /** Whether generation succeeded */
  success: boolean;
}

export interface CompoundSectionResult {
  /** Mitosis .lite.tsx raw code for the section */
  rawCode: string;
  /** Extracted CSS for the section */
  css: string;
  /** Whether generation succeeded */
  success: boolean;
  /** Components generated in Pass 1 */
  generatedComponents: GeneratedComponent[];
  /** Discovery result for diagnostics */
  discovery: ComponentDiscoveryResult;
}

// ── Form role → semantic hint mapping ───────────────────────────────────────

const FORM_ROLE_HINTS: Record<string, string> = {
  select:
    'This is a **dropdown/select field**. ' +
    'Wrapper `<div>` is OK, but MUST contain a real `<select>` element with `<option>` children — never a `<div>` pretending to be a dropdown. ' +
    'Use a `<label>` for the field label. The `<select>` should have the current value pre-selected.',
  textInput:
    'This is a **text input field**. ' +
    'Wrapper `<div>` is OK, but MUST contain a real `<input type="text">` element — never a `<div>` with text. ' +
    'Use a `<label>` for the field label. The input should have a `value` and `placeholder` attribute.',
  search:
    'This is a **search input**. ' +
    'Use `<input type="search">` inside a wrapper. Include a search icon if present in the design.',
  textarea:
    'This is a **textarea field**. ' +
    'MUST contain a real `<textarea>` element — never a `<div>` with text.',
  checkbox:
    'This is a **checkbox**. ' +
    'Root MUST be `<label>`. MUST contain `<input type="checkbox">` + visual `<span>` for the check mark.',
  radio:
    'This is a **radio button**. ' +
    'Root MUST be `<label>`. MUST contain `<input type="radio">` + visual `<span>` for the circle.',
  toggle:
    'This is a **toggle/switch**. ' +
    'Use `<button role="switch">` as root. Include track `<span>` and thumb `<span>`.',
  button:
    'This is a **button**. ' +
    'Use `<button type="button">` as root. Include `<span>` for label text.',
  iconButton:
    'This is an **icon button**. ' +
    'Use `<button type="button">` with `aria-label`. Place icon SVG inside.',
  chip:
    'This is a **chip/tag**. ' +
    'Use a `<span>` with label text. Add a remove `<button>` if the design shows an X icon.',
  tab:
    'This is a **tab button**. ' +
    'Use `<button role="tab">` with `aria-selected` attribute.',
  breadcrumb:
    'This is a **breadcrumb navigation**. ' +
    'Use `<nav aria-label="breadcrumb">` with `<ol>` > `<li>` > `<a>` structure.',
  avatar:
    'This is an **avatar**. ' +
    'Use an `<img>` with `alt` text, or a `<div>` with initials.',
  tooltip:
    'This is a **tooltip**. ' +
    'Use a `<div role="tooltip">`.',
  slider:
    'This is a **slider/range input**. ' +
    'MUST contain `<input type="range">`.',
  pagination:
    'This is a **pagination**. ' +
    'Use `<nav>` with numbered `<button>` children.',
  stepper:
    'This is a **step indicator**. ' +
    'Use an `<ol>` with `<li>` children for each step.',
};

// ── PATH 1: Single Component Generation ─────────────────────────────────────

/**
 * Generates a single UI component from a Figma INSTANCE node.
 *
 * Reuses the existing PATH B pipeline:
 *   serializeNodeForPrompt() → assembleSystemPrompt() + assembleUserPrompt()
 *   → generateWithRetry() → extractJSXBody()
 *
 * @param node - The INSTANCE Figma node
 * @param formRole - Inferred form role (e.g., "select", "textInput")
 * @param serializeNode - Function to serialize a Figma node to prompt-ready format
 * @param llm - LLM provider instance
 * @param bemPrefix - BEM class prefix for the component (e.g., "content")
 * @param onAttempt - Progress callback
 */
export async function generateSingleComponent(
  node: any,
  formRole: string,
  serializeNode: (node: any) => any,
  llm: LLMProvider,
  bemPrefix: string,
  onAttempt?: (attempt: number, maxRetries: number, error?: string) => void,
): Promise<GeneratedComponent> {
  const componentName = node.name ?? 'Component';

  // Serialize just this component's node tree (small YAML)
  const serialized = serializeNode(node);
  if (!serialized) {
    return { name: componentName, formRole, html: '', css: '', success: false };
  }

  // Add formRole annotation directly into the serialized data
  serialized.formRole = formRole;

  const yaml = dump(serialized, { lineWidth: 120, noRefs: true });

  // Build semantic hint for this component
  const hint = FORM_ROLE_HINTS[formRole];
  const semanticHint = hint
    ? `## Semantic HTML Hint\n\n${hint}\n`
    : '';

  // Build a focused component name for the user prompt
  const kebabName = componentName.toLowerCase().replace(/\s+/g, '-');
  const componentBemHint = bemPrefix
    ? `Use BEM classes prefixed with "${bemPrefix}" (e.g., "${bemPrefix}__${kebabName}", "${bemPrefix}__${kebabName}-label").`
    : '';

  const systemPrompt = assembleSystemPrompt();
  const userPrompt = assembleUserPrompt(
    yaml,
    componentName,
    semanticHint + (componentBemHint ? `\n${componentBemHint}` : ''),
  );

  // Collect expected text for fidelity validation
  const expectedTexts = collectTextsFromNode(node);

  try {
    const result = await generateWithRetry(
      llm,
      systemPrompt,
      userPrompt,
      onAttempt,
      undefined,        // no pre-built CSS
      undefined,        // no expected root tag (let hint guide)
      undefined,        // no category (using formRole hint instead)
      expectedTexts,
    );

    if (!result.success) {
      return { name: componentName, formRole, html: '', css: '', success: false };
    }

    // Extract the JSX body (strip export default function wrapper)
    const html = extractJSXBody(result.rawCode);
    return {
      name: componentName,
      formRole,
      html,
      css: result.css ?? '',
      success: true,
    };
  } catch {
    return { name: componentName, formRole, html: '', css: '', success: false };
  }
}

// ── PATH 2: Compound Section Generation ─────────────────────────────────────

/**
 * Generates a section that contains nested UI components.
 *
 * 1. Discovers INSTANCE components in the section tree (component discovery)
 * 2. Generates each unique component type via PATH 1 (parallel)
 * 3. Substitutes INSTANCE subtrees with compact references + generated HTML
 * 4. Generates the section layout with the pruned YAML
 *
 * @param sectionNode - Root FRAME of the section
 * @param sectionName - Human-readable section name (e.g., "Content")
 * @param sectionIndex - 1-based index within the page
 * @param totalSections - Total section count
 * @param serializeNode - Function to serialize a Figma node
 * @param llm - LLM provider
 * @param ctx - Page context (width, gap, etc.)
 * @param onStep - Progress callback
 * @param onAttempt - Retry attempt callback
 */
export async function generateCompoundSection(
  sectionNode: any,
  sectionName: string,
  sectionIndex: number,
  totalSections: number,
  serializeNode: (node: any) => any,
  llm: LLMProvider,
  ctx?: PageSectionContext,
  onStep?: (msg: string) => void,
  onAttempt?: (attempt: number, maxRetries: number, error?: string) => void,
): Promise<CompoundSectionResult> {
  const slug = sectionName.toLowerCase().replace(/\s+/g, '-');

  // ── Step 1: Discover components ─────────────────────────────────────────
  const discovery = discoverComponents(sectionNode);

  if (discovery.components.length === 0) {
    // No recognizable components — fall back to monolithic section generation
    onStep?.(`  No recognizable components found — using monolithic generation`);
    return fallbackMonolithicGeneration(
      sectionNode, sectionName, sectionIndex, totalSections,
      serializeNode, llm, ctx, onAttempt, discovery,
    );
  }

  onStep?.(
    `  Discovered ${discovery.components.length} component types ` +
    `(${discovery.totalInstances} instances): ` +
    discovery.components.map((c) => `${c.name}(${c.formRole})`).join(', '),
  );

  // ── Step 2: Generate leaf components via PATH 1 (parallel) ──────────────
  const componentCache = new Map<string, GeneratedComponent>();

  const generationPromises = discovery.components.map(async (comp) => {
    onStep?.(`  [PATH 1] Generating "${comp.name}" (${comp.formRole})...`);
    const generated = await generateSingleComponent(
      comp.representativeNode,
      comp.formRole,
      serializeNode,
      llm,
      slug,
      onAttempt,
    );
    componentCache.set(comp.name, generated);
    onStep?.(
      `  [PATH 1] "${comp.name}" → ${generated.success ? 'OK' : 'FAILED'}`,
    );
    return generated;
  });

  const generatedComponents = await Promise.all(generationPromises);

  const successCount = generatedComponents.filter((g) => g.success).length;
  onStep?.(
    `  Pass 1 complete: ${successCount}/${discovery.components.length} components generated`,
  );

  // ── Step 3: Build substituted section YAML ──────────────────────────────
  const substitutedNode = substituteComponents(
    sectionNode,
    discovery,
    componentCache,
    serializeNode,
  );
  const sectionYaml = dump(substitutedNode, { lineWidth: 120, noRefs: true });

  onStep?.(
    `  Section YAML after substitution: ${sectionYaml.length} chars ` +
    `(was ~${estimateOriginalSize(sectionNode, serializeNode)} chars)`,
  );

  // ── Step 4: Generate section layout (Pass 2) ───────────────────────────
  // Build a custom user prompt that includes pre-generated component HTML
  const componentRefBlock = buildComponentReferenceBlock(componentCache);
  const sectionSystemPrompt = assemblePageSectionSystemPrompt();

  const baseUserPrompt = assemblePageSectionUserPrompt(
    sectionYaml,
    sectionName,
    sectionIndex,
    totalSections,
    ctx,
  );

  // Insert component references before the YAML block
  const userPrompt = injectComponentReferences(baseUserPrompt, componentRefBlock);

  onStep?.(`  [PATH 2] Generating section layout with ${successCount} pre-built components...`);

  try {
    const result = await generateWithRetry(
      llm,
      sectionSystemPrompt,
      userPrompt,
      onAttempt,
    );

    return {
      rawCode: result.rawCode,
      css: mergeSectionCSS(result.css ?? '', generatedComponents),
      success: result.success,
      generatedComponents,
      discovery,
    };
  } catch {
    return {
      rawCode: '',
      css: '',
      success: false,
      generatedComponents,
      discovery,
    };
  }
}

// ── Substitution Logic ──────────────────────────────────────────────────────

/**
 * Walks the section tree and replaces recognized INSTANCE subtrees with
 * compact references containing the pre-generated HTML.
 */
function substituteComponents(
  node: any,
  discovery: ComponentDiscoveryResult,
  cache: Map<string, GeneratedComponent>,
  serializeNode: (node: any) => any,
): any {
  if (!node || node.visible === false) return null;
  if (node.name?.startsWith('_')) return null;

  // Check if this is a recognized component instance
  if (node.type === 'INSTANCE' && node.name) {
    const generated = cache.get(node.name);
    if (generated && generated.success) {
      // Replace entire subtree with a compact reference
      const props = extractVisibleProps(node);
      return {
        name: node.name,
        type: 'COMPONENT_REF',
        formRole: generated.formRole,
        props,
        generatedHTML: generated.html,
        // Keep basic layout info for the parent to position correctly
        ...(node.layoutGrow ? { flexGrow: node.layoutGrow } : {}),
        ...(node.absoluteBoundingBox?.width ? { width: `${Math.round(node.absoluteBoundingBox.width)}px` } : {}),
        ...(node.absoluteBoundingBox?.height ? { height: `${Math.round(node.absoluteBoundingBox.height)}px` } : {}),
      };
    }
  }

  // Serialize this node (but recurse into children for substitution)
  const serialized = serializeNode(node);
  if (!serialized) return null;

  // Replace children recursively
  if (node.children && Array.isArray(node.children)) {
    const substitutedChildren = node.children
      .map((child: any) => substituteComponents(child, discovery, cache, serializeNode))
      .filter(Boolean);
    if (substitutedChildren.length > 0) {
      serialized.children = substitutedChildren;
    } else {
      delete serialized.children;
    }
  }

  return serialized;
}

/**
 * Extracts visible/relevant props from componentProperties.
 * Strips Figma internal IDs and skips "Show *" toggle props that are false.
 */
function extractVisibleProps(node: any): Record<string, string | boolean> {
  const raw = node.componentProperties ?? node.componentPropertyValues ?? {};
  const props: Record<string, string | boolean> = {};

  for (const [key, val] of Object.entries(raw)) {
    const cleanKey = key.replace(/#[\d:]+$/, '').trim();
    const value = typeof val === 'object' && val !== null
      ? (val as any).value ?? String(val)
      : val as string | boolean;

    // Skip "Show *" toggles that are false — they control invisible children
    if (cleanKey.startsWith('Show ') && value === false) continue;
    // Skip Figma internal node IDs (values like "9927:1467")
    if (typeof value === 'string' && /^\d+:\d+$/.test(value)) continue;

    props[cleanKey] = value;
  }

  return props;
}

// ── Component Reference Block ───────────────────────────────────────────────

/**
 * Builds a markdown block describing pre-generated component HTML
 * that the LLM should USE (not regenerate) when assembling the section.
 */
function buildComponentReferenceBlock(
  cache: Map<string, GeneratedComponent>,
): string {
  const blocks: string[] = [];

  for (const [name, comp] of cache) {
    if (!comp.success || !comp.html) continue;

    blocks.push(
      `### ${name} (${comp.formRole})\n` +
      `Use the following HTML when you encounter a "${name}" component in the YAML:\n` +
      '```html\n' +
      comp.html + '\n' +
      '```',
    );
  }

  if (blocks.length === 0) return '';

  return (
    '## Pre-Generated Components\n\n' +
    'The following components have already been generated. ' +
    'When you see a `type: COMPONENT_REF` node in the YAML, ' +
    'use the provided `generatedHTML` directly. ' +
    'Adapt the text content from the `props` (e.g., swap labels and values) ' +
    'but keep the HTML structure and class names. ' +
    'Do NOT regenerate these as `<div>` — use the semantic HTML provided.\n\n' +
    blocks.join('\n\n')
  );
}

/**
 * Injects the component reference block into the user prompt,
 * right before the YAML block.
 */
function injectComponentReferences(userPrompt: string, refBlock: string): string {
  if (!refBlock) return userPrompt;

  // Insert before the ```yaml fence
  const yamlFenceIdx = userPrompt.indexOf('```yaml');
  if (yamlFenceIdx === -1) return userPrompt + '\n\n' + refBlock;

  return (
    userPrompt.slice(0, yamlFenceIdx) +
    refBlock + '\n\n' +
    userPrompt.slice(yamlFenceIdx)
  );
}

// ── CSS Merging ─────────────────────────────────────────────────────────────

/**
 * Merges the section's CSS with CSS from all generated components.
 * Component CSS is included first so section CSS can override if needed.
 */
function mergeSectionCSS(
  sectionCSS: string,
  components: GeneratedComponent[],
): string {
  const parts: string[] = [];

  for (const comp of components) {
    if (comp.success && comp.css) {
      parts.push(`/* — Component: ${comp.name} — */\n${comp.css}`);
    }
  }

  if (sectionCSS) {
    parts.push(`/* — Section Layout — */\n${sectionCSS}`);
  }

  return parts.join('\n\n');
}

// ── Fallback ────────────────────────────────────────────────────────────────

/**
 * Fallback: when no recognizable components are found, generate the section
 * monolithically (same as the old PATH C behavior).
 */
async function fallbackMonolithicGeneration(
  sectionNode: any,
  sectionName: string,
  sectionIndex: number,
  totalSections: number,
  serializeNode: (node: any) => any,
  llm: LLMProvider,
  ctx: PageSectionContext | undefined,
  onAttempt: ((attempt: number, maxRetries: number, error?: string) => void) | undefined,
  discovery: ComponentDiscoveryResult,
): Promise<CompoundSectionResult> {
  const serialized = serializeNode(sectionNode);
  const yaml = dump(serialized, { lineWidth: 120, noRefs: true });

  const systemPrompt = assemblePageSectionSystemPrompt();
  const userPrompt = assemblePageSectionUserPrompt(
    yaml, sectionName, sectionIndex, totalSections, ctx,
  );

  try {
    const result = await generateWithRetry(llm, systemPrompt, userPrompt, onAttempt);
    return {
      rawCode: result.rawCode,
      css: result.css ?? '',
      success: result.success,
      generatedComponents: [],
      discovery,
    };
  } catch {
    return {
      rawCode: '',
      css: '',
      success: false,
      generatedComponents: [],
      discovery,
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Collects all text content from a node tree (for text fidelity validation).
 */
function collectTextsFromNode(node: any): string[] {
  const texts = new Set<string>();
  const walk = (n: any) => {
    if (!n || n.visible === false) return;
    const text =
      typeof n.characters === 'string' ? n.characters.trim()
      : typeof n.text === 'string' ? n.text.trim()
      : '';
    if (text) texts.add(text);
    if (Array.isArray(n.children)) n.children.forEach(walk);
  };
  walk(node);
  return [...texts];
}

/**
 * Rough estimate of the original YAML size before substitution.
 */
function estimateOriginalSize(node: any, serializeNode: (n: any) => any): number {
  const full = serializeNode(node);
  return dump(full, { lineWidth: 120, noRefs: true }).length;
}
