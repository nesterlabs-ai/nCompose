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
import type { ChartComponent } from '../types/index.js';
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
  computeStructuralFingerprint,
  type DiscoveredComponent,
  type ComponentDiscoveryResult,
} from '../figma/component-discovery.js';
import { extractChartMetadata } from '../figma/chart-detection.js';
import { generateChartCode } from './chart-codegen.js';

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
  /** Chart components discovered and generated (Recharts code) */
  chartComponents: ChartComponent[];
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
 * @param bemSuffix - Optional variant suffix to produce unique class names (e.g., "-v2")
 * @param templateMode - When true, use Tailwind + CSS variables for the starter
 */
export async function generateSingleComponent(
  node: any,
  formRole: string,
  serializeNode: (node: any) => any,
  llm: LLMProvider,
  bemPrefix: string,
  onAttempt?: (attempt: number, maxRetries: number, error?: string) => void,
  bemSuffix?: string,
  templateMode?: boolean,
): Promise<GeneratedComponent> {
  const componentName = node.name ?? 'Component';

  // Serialize just this component's node tree (small YAML)
  const serialized = serializeNode(node);
  if (!serialized) {
    return { name: componentName, formRole, html: '', css: '', success: false };
  }

  // Add formRole annotation directly into the serialized data
  serialized.formRole = formRole;

  // ALWAYS strip root-level dimensions for PATH 1 components.
  // Components generated here are always placed inside a sized wrapper by
  // the section LLM (PATH 2), which controls the component's outer dimensions
  // via inline styles or wrapper CSS. The component root should use width:100%
  // to fill its wrapper — not a hardcoded pixel value from the representative
  // instance (which may differ from other instances of the same component).
  delete serialized.width;
  delete serialized.height;

  const yaml = dump(serialized, { lineWidth: 120, noRefs: true });

  // Build semantic hint for this component
  const hint = FORM_ROLE_HINTS[formRole];
  const semanticHint = hint
    ? `## Semantic HTML Hint\n\n${hint}\n`
    : '';

  // Build a focused component name for the user prompt
  // Append bemSuffix so each structural variant gets unique CSS class names
  const kebabName = componentName.toLowerCase().replace(/\s+/g, '-') + (bemSuffix ?? '');
  const responsiveHint =
    '## Sizing\n' +
    'The component root element MUST use `width: 100%` (never a fixed pixel width). ' +
    'A parent wrapper controls the outer dimensions.\n' +
    'The root height should be `height: auto` so it sizes to content.\n' +
    'Internal child elements that have `widthMode: fill` in the YAML should also use `width: 100%`. ' +
    'Only use fixed pixel widths on children that have an explicit `width` in the YAML.\n';
  const componentBemHint = bemPrefix
    ? `Use BEM classes prefixed with "${bemPrefix}" (e.g., "${bemPrefix}__${kebabName}", "${bemPrefix}__${kebabName}-label").`
    : '';

  const systemPrompt = assembleSystemPrompt(templateMode);
  const userPrompt = assembleUserPrompt(
    yaml,
    componentName,
    semanticHint + responsiveHint + (componentBemHint ? `\n${componentBemHint}` : ''),
    templateMode,
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
 * @param templateMode - When true, prompts use Tailwind + CSS variables for the starter
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
  templateMode?: boolean,
  rawSectionNode?: any,
  existingChartNames?: Set<string>,
): Promise<CompoundSectionResult> {
  const slug = sectionName.toLowerCase().replace(/\s+/g, '-');

  // ── Step 1: Discover components (including charts) ─────────────────────
  const discovery = discoverComponents(sectionNode, rawSectionNode);

  if (discovery.components.length === 0) {
    // No recognizable components — fall back to monolithic section generation
    onStep?.(`  No recognizable components found — using monolithic generation`);
    return fallbackMonolithicGeneration(
      sectionNode, sectionName, sectionIndex, totalSections,
      serializeNode, llm, ctx, onAttempt, discovery, templateMode, rawSectionNode,
    );
  }

  onStep?.(
    `  Discovered ${discovery.components.length} component types ` +
    `(${discovery.totalInstances} instances): ` +
    discovery.components.map((c) =>
      c.variantKey !== c.name
        ? `${c.name}[${c.variantKey.slice(c.name.length + 2)}](${c.formRole})`
        : `${c.name}(${c.formRole})`,
    ).join(', '),
  );

  // ── Step 2: Generate leaf components via PATH 1 (parallel) ──────────────
  const componentCache = new Map<string, GeneratedComponent>();

  // Compute BEM suffixes for components that share the same name
  // so each structural variant gets unique CSS class names
  const nameCount = new Map<string, number>();
  for (const comp of discovery.components) {
    nameCount.set(comp.name, (nameCount.get(comp.name) ?? 0) + 1);
  }
  const nameIndex = new Map<string, number>();
  const bemSuffixes = new Map<string, string>(); // variantKey → suffix
  for (const comp of discovery.components) {
    const count = nameCount.get(comp.name) ?? 1;
    if (count === 1) {
      bemSuffixes.set(comp.variantKey, '');
    } else {
      const idx = (nameIndex.get(comp.name) ?? 0) + 1;
      nameIndex.set(comp.name, idx);
      bemSuffixes.set(comp.variantKey, `-v${idx}`);
    }
  }

  // Separate chart components from UI components
  const chartComps = discovery.components.filter((c) => c.formRole === 'chart');
  const uiComps = discovery.components.filter((c) => c.formRole !== 'chart');
  const chartComponents: ChartComponent[] = [];

  // Generate chart components via deterministic Recharts codegen (no LLM)
  const usedChartNames = new Set<string>(existingChartNames);
  for (const comp of chartComps) {
    const rawNode = comp.representativeRawNode ?? comp.representativeNode;
    onStep?.(`  [PATH 1] Generating chart "${comp.name}" via Recharts codegen...`);
    try {
      const meta = await extractChartMetadata(rawNode, llm);
      // Build a unique component name from the chart's Figma name
      const pascal = comp.name
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .split(/\s+/).filter(Boolean)
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join('');
      let chartComponentName = pascal + (pascal.toLowerCase().endsWith('chart') ? '' : 'Chart');
      // Deduplicate: if another chart already has this name, append a suffix
      if (usedChartNames.has(chartComponentName)) {
        let suffix = 2;
        while (usedChartNames.has(`${chartComponentName}${suffix}`)) suffix++;
        chartComponentName = `${chartComponentName}${suffix}`;
      }
      usedChartNames.add(chartComponentName);
      const bemBase = chartComponentName
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '');
      const metaWithName = { ...meta, componentName: chartComponentName, bemBase };
      const { reactCode, css } = generateChartCode(metaWithName);
      chartComponents.push({ name: chartComponentName, reactCode, css });

      // Put a placeholder in the component cache so substitution works
      const placeholderHTML = `<div class="chart-section-${chartComponentName}" />`;
      componentCache.set(comp.variantKey, {
        name: comp.name,
        formRole: 'chart',
        html: placeholderHTML,
        css: '',
        success: true,
      });
      onStep?.(`  [PATH 1] Chart "${chartComponentName}" → OK (${meta.chartType}, ${meta.dataPointCount} data points)`);
    } catch (err) {
      onStep?.(`  [PATH 1] Chart "${comp.name}" → FAILED: ${err}`);
    }
  }

  // Generate UI components via LLM (PATH 1 — parallel)
  const generationPromises = uiComps.map(async (comp) => {
    const suffix = bemSuffixes.get(comp.variantKey) ?? '';
    const displayName = comp.variantKey !== comp.name
      ? `${comp.name} [${comp.variantKey.slice(comp.name.length + 2)}]`
      : comp.name;
    onStep?.(`  [PATH 1] Generating "${displayName}" (${comp.formRole})${suffix ? ` → BEM suffix "${suffix}"` : ''}...`);
    const generated = await generateSingleComponent(
      comp.representativeNode,
      comp.formRole,
      serializeNode,
      llm,
      slug,
      onAttempt,
      suffix || undefined,
      templateMode,
    );
    componentCache.set(comp.variantKey, generated);
    onStep?.(
      `  [PATH 1] "${displayName}" → ${generated.success ? 'OK' : 'FAILED'}`,
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

  // Deduplicate sibling names: same-named nodes with different visual
  // properties (dimensions, colors, etc.) get unique suffixes so the
  // section LLM generates distinct CSS classes for each.
  deduplicateSiblingNames(substitutedNode);

  const sectionYaml = dump(substitutedNode, { lineWidth: 120, noRefs: true });

  onStep?.(
    `  Section YAML after substitution: ${sectionYaml.length} chars ` +
    `(was ~${estimateOriginalSize(sectionNode, serializeNode)} chars)`,
  );

  // ── Step 4: Generate section layout (Pass 2) ───────────────────────────
  // Build a custom user prompt that includes pre-generated component HTML
  const componentRefBlock = buildComponentReferenceBlock(componentCache);
  const sectionSystemPrompt = assemblePageSectionSystemPrompt(templateMode);

  const baseUserPrompt = assemblePageSectionUserPrompt(
    sectionYaml,
    sectionName,
    sectionIndex,
    totalSections,
    ctx,
    templateMode,
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
      chartComponents,
    };
  } catch {
    return {
      rawCode: '',
      css: '',
      success: false,
      generatedComponents,
      discovery,
      chartComponents,
    };
  }
}

// ── Substitution Logic ──────────────────────────────────────────────────────

/**
 * Walks the section tree and replaces recognized INSTANCE subtrees with
 * compact references containing the pre-generated HTML.
 * Also replaces chart sections with chart placeholder references.
 */
function substituteComponents(
  node: any,
  discovery: ComponentDiscoveryResult,
  cache: Map<string, GeneratedComponent>,
  serializeNode: (node: any) => any,
  path: number[] = [],
): any {
  if (!node || node.visible === false) return null;
  if (node.name?.startsWith('_')) return null;

  // Check if this node matches a chart component (identified by tree path)
  const chartPathKey = path.join('-');
  for (const [variantKey, generated] of cache) {
    if (variantKey.startsWith('chart::') && generated.success) {
      // Chart variant keys are "chart::ChartName::treePath"
      const pathPart = variantKey.split('::')[2];
      if (pathPart === chartPathKey) {
        // Replace chart subtree with a COMPONENT_REF containing the placeholder
        const ref: any = {
          name: node.name ?? 'Chart',
          type: 'COMPONENT_REF',
          formRole: 'chart',
          props: {},
          generatedHTML: generated.html,
        };
        if (node.absoluteBoundingBox?.width) {
          ref.width = `${Math.round(node.absoluteBoundingBox.width)}px`;
        }
        if (node.absoluteBoundingBox?.height) {
          ref.height = `${Math.round(node.absoluteBoundingBox.height)}px`;
        }
        return ref;
      }
    }
  }

  // Check if this is a recognized component instance
  if (node.type === 'INSTANCE' && node.name) {
    const fingerprint = computeStructuralFingerprint(node);
    const cacheKey = fingerprint ? `${node.name}::${fingerprint}` : node.name;
    const generated = cache.get(cacheKey);
    if (generated && generated.success) {
      // Replace entire subtree with a compact reference
      const props = extractVisibleProps(node);

      // Determine sizing mode: use flat API properties (layoutSizingHorizontal/Vertical)
      // or nested figma-complete object (layoutSizing.horizontal/vertical).
      // When sizing is FILL, emit widthMode/heightMode instead of pixel values
      // so the section LLM sizes the wrapper with width:100% instead of fixed pixels.
      const hSizing = node.layoutSizing?.horizontal ?? node.layoutSizingHorizontal;
      const vSizing = node.layoutSizing?.vertical ?? node.layoutSizingVertical;

      const ref: any = {
        name: node.name,
        type: 'COMPONENT_REF',
        formRole: generated.formRole,
        props,
        generatedHTML: generated.html,
        ...(node.layoutGrow ? { flexGrow: node.layoutGrow } : {}),
      };

      // Width: fill → widthMode, otherwise pixel value
      if (hSizing === 'FILL') {
        ref.widthMode = 'fill';
      } else if (node.absoluteBoundingBox?.width) {
        ref.width = `${Math.round(node.absoluteBoundingBox.width)}px`;
      }

      // Height: fill → heightMode, otherwise pixel value
      if (vSizing === 'FILL') {
        ref.heightMode = 'fill';
      } else if (node.absoluteBoundingBox?.height) {
        ref.height = `${Math.round(node.absoluteBoundingBox.height)}px`;
      }

      return ref;
    }
  }

  // Serialize this node (but recurse into children for substitution)
  const serialized = serializeNode(node);
  if (!serialized) return null;

  // Replace children recursively
  if (node.children && Array.isArray(node.children)) {
    const substitutedChildren = node.children
      .map((child: any, i: number) => substituteComponents(child, discovery, cache, serializeNode, [...path, i]))
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

  for (const [variantKey, comp] of cache) {
    if (!comp.success || !comp.html) continue;

    // Extract fingerprint portion for display if present
    const separatorIdx = variantKey.indexOf('::');
    const displayName = comp.name;
    const fingerprint = separatorIdx !== -1
      ? variantKey.slice(separatorIdx + 2)
      : '';
    const variantLabel = fingerprint
      ? ` (${comp.formRole}, variant: ${fingerprint})`
      : ` (${comp.formRole})`;

    blocks.push(
      `### ${displayName}${variantLabel}\n` +
      `Use the following HTML when you encounter a "${displayName}" component ` +
      (fingerprint ? `with structural props [${fingerprint}] ` : '') +
      `in the YAML:\n` +
      '```html\n' +
      comp.html + '\n' +
      '```',
    );
  }

  if (blocks.length === 0) return '';

  // Collect all component class prefixes so we can tell the section LLM to skip them
  const componentClassPrefixes: string[] = [];
  for (const [, comp] of cache) {
    if (!comp.success || !comp.html) continue;
    // Extract the root class from the generated HTML (first class="..." value)
    const classMatch = comp.html.match(/class="([^"]+)"/);
    if (classMatch) {
      const rootClass = classMatch[1].split(/\s+/)[0];
      if (rootClass) componentClassPrefixes.push(rootClass);
    }
  }

  const skipCssNote = componentClassPrefixes.length > 0
    ? '\n\n**CSS rule:** CSS for these components is already provided separately. ' +
      'Do NOT generate CSS for any class that starts with: ' +
      componentClassPrefixes.map((c) => `\`${c}\``).join(', ') + '. ' +
      'Only generate CSS for your own section layout elements (wrappers, containers, grids). ' +
      'Use the `width` and `height` from each COMPONENT_REF YAML node to size the **parent wrapper** around the component.\n'
    : '';

  return (
    '## Pre-Generated Components\n\n' +
    'The following components have already been generated. ' +
    'When you see a `type: COMPONENT_REF` node in the YAML, ' +
    'use the provided `generatedHTML` directly. ' +
    'Adapt the text content from the `props` (e.g., swap labels and values) ' +
    'but keep the HTML structure and class names. ' +
    'Do NOT regenerate these as `<div>` — use the semantic HTML provided.\n\n' +
    '**Sizing COMPONENT_REF wrappers:** When a COMPONENT_REF has `widthMode: fill`, ' +
    'its wrapper must use `width: 100%` (NOT a fixed pixel width). ' +
    'When it has a `width` in pixels, use that exact width on the wrapper. ' +
    'Same for `heightMode: fill` → `height: 100%` vs fixed `height`.' +
    skipCssNote + '\n\n' +
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
  templateMode?: boolean,
  rawSectionNode?: any,
): Promise<CompoundSectionResult> {
  const serialized = serializeNode(sectionNode);
  const yaml = dump(serialized, { lineWidth: 120, noRefs: true });

  const systemPrompt = assemblePageSectionSystemPrompt(templateMode);
  const userPrompt = assemblePageSectionUserPrompt(
    yaml, sectionName, sectionIndex, totalSections, ctx, templateMode,
  );

  try {
    const result = await generateWithRetry(llm, systemPrompt, userPrompt, onAttempt);
    return {
      rawCode: result.rawCode,
      css: result.css ?? '',
      success: result.success,
      generatedComponents: [],
      discovery,
      chartComponents: [],
    };
  } catch {
    return {
      rawCode: '',
      css: '',
      success: false,
      generatedComponents: [],
      discovery,
      chartComponents: [],
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

// ── Sibling Name Deduplication ───────────────────────────────────────────────

/**
 * Computes a visual-property fingerprint for a serialized node.
 *
 * Two nodes with the same name but different fingerprints need unique names
 * so the LLM generates distinct CSS classes for each.
 *
 * Includes: width, height, widthMode, heightMode, fills, strokes, borderRadius,
 * opacity, layout (padding, gap, direction), flexGrow, position.
 * Excludes: name, type, text, children, generatedHTML, props, formRole
 * (content-only fields that don't affect CSS).
 */
function computeVisualFingerprint(node: any): string {
  const parts: string[] = [];

  // Dimensions & sizing mode
  if (node.width) parts.push(`w:${node.width}`);
  if (node.height) parts.push(`h:${node.height}`);
  if (node.widthMode) parts.push(`wm:${node.widthMode}`);
  if (node.heightMode) parts.push(`hm:${node.heightMode}`);
  if (node.flexGrow) parts.push(`fg:${node.flexGrow}`);

  // Layout
  if (node.layout) {
    const l = node.layout;
    if (l.direction) parts.push(`ld:${l.direction}`);
    if (l.padding) parts.push(`lp:${l.padding}`);
    if (l.gap) parts.push(`lg:${l.gap}`);
    if (l.justifyContent) parts.push(`lj:${l.justifyContent}`);
    if (l.alignItems) parts.push(`la:${l.alignItems}`);
  }

  // Visual properties
  if (node.fills) parts.push(`f:${JSON.stringify(node.fills)}`);
  if (node.strokes) parts.push(`s:${JSON.stringify(node.strokes)}`);
  if (node.borderRadius) parts.push(`br:${node.borderRadius}`);
  if (node.opacity !== undefined) parts.push(`op:${node.opacity}`);
  if (node.effects) parts.push(`e:${JSON.stringify(node.effects)}`);

  // Positioning
  if (node.position) parts.push(`pos:${node.position}`);
  if (node.left) parts.push(`l:${node.left}`);
  if (node.top) parts.push(`t:${node.top}`);

  return parts.join('|');
}

/**
 * Walks a serialized tree and renames same-named siblings that have different
 * visual properties by appending numeric suffixes (e.g., "Dropdown Field 2").
 *
 * Nodes with IDENTICAL visual properties keep the same name (they can share CSS).
 * Only nodes with DIFFERENT properties get suffixed to produce unique CSS classes.
 *
 * Mutates the tree in place.
 */
export function deduplicateSiblingNames(node: any): void {
  if (!node || !Array.isArray(node.children) || node.children.length === 0) return;

  // Group children by name
  const nameGroups = new Map<string, Array<{ child: any; index: number }>>();
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (!child?.name) continue;
    const name = child.name;
    if (!nameGroups.has(name)) nameGroups.set(name, []);
    nameGroups.get(name)!.push({ child, index: i });
  }

  // For each name group with multiple members, check visual properties
  for (const [, members] of nameGroups) {
    if (members.length <= 1) continue;

    // Sub-group by visual fingerprint — nodes with identical visuals share a name
    const fpGroups = new Map<string, Array<{ child: any; index: number }>>();
    for (const member of members) {
      const fp = computeVisualFingerprint(member.child);
      if (!fpGroups.has(fp)) fpGroups.set(fp, []);
      fpGroups.get(fp)!.push(member);
    }

    // If all members have the same fingerprint, no renaming needed
    if (fpGroups.size <= 1) continue;

    // Multiple visual variants exist — assign unique suffixes
    // First group (most members, or first encountered) keeps the original name
    const sortedGroups = [...fpGroups.values()].sort((a, b) => b.length - a.length);
    let suffixCounter = 1;
    for (let gi = 0; gi < sortedGroups.length; gi++) {
      if (gi === 0) continue; // first group keeps original name
      suffixCounter++;
      for (const member of sortedGroups[gi]) {
        member.child.name = `${member.child.name} ${suffixCounter}`;
      }
    }
  }

  // Recurse into children
  for (const child of node.children) {
    if (child) deduplicateSiblingNames(child);
  }
}
