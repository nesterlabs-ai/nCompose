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
import { generateReactDirect } from './react-direct-gen.js';
import { extractJSXBody, scopeSectionCSS } from './stitch.js';
import {
  assembleSystemPrompt,
  assembleUserPrompt,
  assemblePageSectionSystemPrompt,
  assemblePageSectionUserPrompt,
  assembleReactSystemPrompt,
  assembleReactUserPrompt,
  assembleReactSectionSystemPrompt,
  assembleReactSectionUserPrompt,
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
import { isShadcnSupported } from '../shadcn/shadcn-types.js';
import { generateShadcnInlineComponent } from '../shadcn/shadcn-codegen.js';
import { detectComponentCategory } from '../figma/component-set-parser.js';

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
  /** Props from the representative instance used to generate the HTML.
   *  Used to do per-instance text substitution in substituteComponents(). */
  representativeProps?: Record<string, string | boolean>;
  /** Ordered text content from the representative instance's node tree.
   *  Used for positional text substitution when componentProperties lacks TEXT props. */
  representativeTexts?: string[];
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
    'Use a `<span>` with label text. If the design shows an X/close icon, add a `<button type="button" aria-label="Remove">` ' +
    'containing a `<span>` styled as a CSS × mark (two rotated lines via `::before`/`::after` pseudo-elements). ' +
    'Use `position: relative` on the span, and `position: absolute; top: 50%; left: 0; width: 100%; height: 1.5px; background: currentColor;` ' +
    'on both pseudo-elements, with `transform: rotate(45deg)` and `transform: rotate(-45deg)` respectively.',
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
 * @param assetHints - Optional asset hints string (icon SVG file references for the LLM)
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
  assetHints?: string,
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

  // Static content restriction: this component is part of a static page section.
  // The LLM must NOT use useStore, Show, For, or any dynamic expressions.
  const staticContentRule =
    '## Static Content Only\n' +
    'This component is part of a **static page layout**. ' +
    'Do NOT use `useStore`, `Show`, `For`, or any props/state. ' +
    'All text content, values, and options MUST be hardcoded directly in the JSX. ' +
    'Do NOT generate `{state.label}`, `{state.selectedValue}`, or similar dynamic expressions. ' +
    'Copy text VERBATIM from the YAML `text` or `characters` field.\n';

  // ── templateMode ON: React + Tailwind direct (no Mitosis) ─────────────
  if (templateMode) {
    const category = detectComponentCategory(componentName);

    // Try shadcn inline path for recognized components
    if (isShadcnSupported(formRole) || (category !== 'unknown' && isShadcnSupported(category))) {
      try {
        const shadcnRole = isShadcnSupported(formRole) ? formRole : category;
        const result = await generateShadcnInlineComponent(
          node, shadcnRole, componentName, llm, yaml,
        );
        return {
          name: componentName,
          formRole,
          html: result.html,
          css: '',
          success: true,
          representativeProps: extractVisibleProps(node),
          representativeTexts: collectOrderedTexts(node),
        };
      } catch { /* fall through to React direct */ }
    }

    // Fallback: React + Tailwind direct (no Mitosis)
    try {
      const reactSystemPrompt = assembleReactSystemPrompt();
      const reactUserPrompt = assembleReactUserPrompt(
        yaml, componentName,
        staticContentRule + semanticHint + responsiveHint,
        assetHints,
      );
      const result = await generateReactDirect(llm, reactSystemPrompt, reactUserPrompt);
      const html = extractJSXBody(result.reactCode);
      return {
        name: componentName,
        formRole,
        html,
        css: result.css,
        success: true,
        representativeProps: extractVisibleProps(node),
        representativeTexts: collectOrderedTexts(node),
      };
    } catch {
      return { name: componentName, formRole, html: '', css: '', success: false };
    }
  }

  // ── templateMode OFF: existing Mitosis pipeline (unchanged) ───────────
  const systemPrompt = assembleSystemPrompt(templateMode);
  const userPrompt = assembleUserPrompt(
    yaml,
    componentName,
    staticContentRule + semanticHint + responsiveHint + (componentBemHint ? `\n${componentBemHint}` : ''),
    templateMode,
    assetHints,
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
      undefined,        // no layout fidelity enforcement
      yaml,             // source YAML for CSS fidelity validation
    );

    if (!result.success) {
      return { name: componentName, formRole, html: '', css: '', success: false };
    }

    // Strip dynamic state from the generated code.
    // PATH 1 components are part of static page sections — useStore, state.*,
    // and event handlers must be removed and replaced with static content.
    const cleanedCode = stripDynamicState(result.rawCode, expectedTexts);

    // Extract the JSX body (strip export default function wrapper)
    const html = extractJSXBody(cleanedCode);
    return {
      name: componentName,
      formRole,
      html,
      css: result.css ?? '',
      success: true,
      representativeProps: extractVisibleProps(node),
      representativeTexts: collectOrderedTexts(node),
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
 * @param assetHints - Optional asset hints string (icon SVG file references for the LLM)
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
  assetHints?: string,
): Promise<CompoundSectionResult> {
  const slug = sectionName.toLowerCase().replace(/\s+/g, '-');

  // ── Step 1: Discover components (including charts) ─────────────────────
  const discovery = discoverComponents(sectionNode, rawSectionNode);

  if (discovery.components.length === 0) {
    // No recognizable components — fall back to monolithic section generation
    onStep?.(`  No recognizable components found — using monolithic generation`);
    return fallbackMonolithicGeneration(
      sectionNode, sectionName, sectionIndex, totalSections,
      serializeNode, llm, ctx, onAttempt, discovery, templateMode, rawSectionNode, assetHints,
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
      assetHints,
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

  // ── Step 2.5: Fix class name collisions ────────────────────────────────
  // If a component's root CSS class matches the section slug, the section
  // layout CSS and component CSS will share the same selector after scoping,
  // causing parent styles to leak into the component and vice-versa.
  // Rename the colliding component's root class to use BEM child naming.
  fixComponentClassCollisions(componentCache, slug, onStep);

  // ── Step 3: Build substituted section YAML ──────────────────────────────
  const substitutedNode = substituteComponents(
    sectionNode,
    discovery,
    componentCache,
    serializeNode,
  );

  // Fix stretch dimension conflicts: when a node has alignSelf: stretch,
  // remove the cross-axis pixel dimension (width in column parent, height
  // in row parent) since stretch handles the sizing. The serializer can't
  // always do this because substituteComponents() does its own recursion
  // without passing parent layout direction.
  fixStretchDimensions(substitutedNode);

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

  // When templateMode is on, use React prompts (no Mitosis)
  const sectionSystemPrompt = templateMode
    ? assembleReactSectionSystemPrompt()
    : assemblePageSectionSystemPrompt(templateMode);

  const baseUserPrompt = templateMode
    ? assembleReactSectionUserPrompt(sectionYaml, sectionName, sectionIndex, totalSections, ctx)
    : assemblePageSectionUserPrompt(sectionYaml, sectionName, sectionIndex, totalSections, ctx, templateMode);

  // Insert component references and asset hints before the YAML block
  let userPrompt = injectComponentReferences(baseUserPrompt, componentRefBlock);
  if (assetHints) {
    const yamlIdx = userPrompt.indexOf('```yaml');
    if (yamlIdx !== -1) {
      userPrompt = userPrompt.slice(0, yamlIdx) + assetHints + '\n\n' + userPrompt.slice(yamlIdx);
    } else {
      userPrompt += '\n\n' + assetHints;
    }
  }

  onStep?.(`  [PATH 2] Generating section layout with ${successCount} pre-built components...`);

  try {
    // When templateMode is on, use React direct generation (skip Mitosis parsing)
    if (templateMode) {
      const reactResult = await generateReactDirect(llm, sectionSystemPrompt, userPrompt);
      return {
        rawCode: reactResult.reactCode,
        css: mergeSectionCSS(reactResult.css, generatedComponents),
        success: true,
        generatedComponents,
        discovery,
        chartComponents,
      };
    }

    const result = await generateWithRetry(
      llm,
      sectionSystemPrompt,
      userPrompt,
      onAttempt,
      undefined, undefined, undefined, undefined, undefined,
      sectionYaml,  // source YAML for CSS fidelity validation
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

      // Per-instance text substitution: replace the representative instance's
      // text with this specific instance's text. Two strategies:
      // 1. componentProperties-based (when TEXT props have overrides)
      // 2. Positional: compare ordered child TEXT nodes between representative and instance
      let instanceHTML = applyInstanceTextSubstitution(
        generated.html,
        generated.representativeProps ?? {},
        props,
      );

      // Fallback: positional text substitution from actual child TEXT nodes.
      // Figma only includes TEXT props in componentProperties when overridden,
      // so most instances have no TEXT entries. Positional matching handles this.
      if (instanceHTML === generated.html && generated.representativeTexts?.length) {
        const instanceTexts = collectOrderedTexts(node);
        instanceHTML = applyPositionalTextSubstitution(
          instanceHTML,
          generated.representativeTexts,
          instanceTexts,
        );
      }

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
        generatedHTML: instanceHTML,
        ...(node.layoutGrow ? { flexGrow: node.layoutGrow } : {}),
      };

      // Width: fill → widthMode, hug → widthMode, fixed → pixel value
      if (hSizing === 'FILL') {
        ref.widthMode = 'fill';
      } else if (hSizing === 'HUG') {
        ref.widthMode = 'hug';
      } else if (node.absoluteBoundingBox?.width) {
        ref.width = `${Math.round(node.absoluteBoundingBox.width)}px`;
      }

      // Height: fill → heightMode, hug → heightMode, fixed → pixel value
      if (vSizing === 'FILL') {
        ref.heightMode = 'fill';
      } else if (vSizing === 'HUG') {
        ref.heightMode = 'hug';
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

// ── Per-Instance Text Substitution ───────────────────────────────────────────

/**
 * Replaces the representative instance's text with this specific instance's
 * text in the generated HTML.
 *
 * For each string prop that differs between the representative and this instance,
 * all occurrences of the representative's value are replaced with the instance's
 * value. Replacements are sorted longest-first to avoid partial-match issues.
 *
 * @param html - The representative's generated HTML
 * @param repProps - Props from the representative instance
 * @param instanceProps - Props from this specific instance
 * @returns HTML with this instance's text content
 */
function applyInstanceTextSubstitution(
  html: string,
  repProps: Record<string, string | boolean>,
  instanceProps: Record<string, string | boolean>,
): string {
  // Collect all text replacements needed
  const replacements: Array<[string, string]> = [];

  for (const [key, instanceValue] of Object.entries(instanceProps)) {
    if (typeof instanceValue !== 'string' || !instanceValue) continue;
    const repValue = repProps[key];
    if (typeof repValue !== 'string' || !repValue) continue;
    if (repValue === instanceValue) continue;
    replacements.push([repValue, instanceValue]);
  }

  if (replacements.length === 0) return html;

  // Sort longest first to avoid replacing substrings of longer values
  replacements.sort((a, b) => b[0].length - a[0].length);

  let result = html;
  for (const [from, to] of replacements) {
    result = result.split(from).join(to);
  }

  return result;
}

// ── Positional Text Substitution ─────────────────────────────────────────────

/**
 * Collects text content from a node's subtree in depth-first order.
 * Unlike collectTextsFromNode (which deduplicates via Set), this preserves
 * order and duplicates so positional matching works correctly.
 */
function collectOrderedTexts(node: any): string[] {
  const texts: string[] = [];
  const walk = (n: any) => {
    if (!n || n.visible === false) return;
    const text =
      typeof n.characters === 'string' ? n.characters.trim()
      : typeof n.text === 'string' ? n.text.trim()
      : '';
    if (text) texts.push(text);
    if (Array.isArray(n.children)) n.children.forEach(walk);
  };
  walk(node);
  return texts;
}

/**
 * Replaces text in HTML by matching positional text between the representative
 * and this instance's node trees.
 *
 * If text at position i differs between representative and instance, we replace
 * occurrences of the representative text with the instance text in the HTML.
 * Replacements are sorted longest-first to avoid partial-match issues.
 */
function applyPositionalTextSubstitution(
  html: string,
  repTexts: string[],
  instanceTexts: string[],
): string {
  const len = Math.min(repTexts.length, instanceTexts.length);
  const replacements: Array<[string, string]> = [];

  for (let i = 0; i < len; i++) {
    if (repTexts[i] !== instanceTexts[i]) {
      replacements.push([repTexts[i], instanceTexts[i]]);
    }
  }

  if (replacements.length === 0) return html;

  // Sort longest-first to avoid replacing substrings of longer values
  replacements.sort((a, b) => b[0].length - a[0].length);

  let result = html;
  for (const [from, to] of replacements) {
    result = result.split(from).join(to);
  }

  return result;
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
    'use its `generatedHTML` exactly as-is — the text content has already been ' +
    'customized for each specific instance (labels, values, placeholders are correct). ' +
    'Do NOT change the text, class names, or HTML structure. ' +
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

// ── Class Name Collision Fix ─────────────────────────────────────────────────

/**
 * Escapes special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Detects and fixes class name collisions between component root classes
 * and the section slug.
 *
 * When a component's root CSS class exactly matches the section name
 * (e.g., both using "frame-2147225790"), the section layout CSS and
 * component CSS end up with identical selectors after scoping, causing
 * cross-contamination: section styles apply to the component and vice-versa.
 *
 * Fix: rename the component's root class to use BEM child naming
 * (e.g., "frame-2147225790" → "frame-2147225790__button").
 *
 * Mutates the component entries in the cache.
 */
function fixComponentClassCollisions(
  cache: Map<string, GeneratedComponent>,
  sectionSlug: string,
  onStep?: (msg: string) => void,
): void {
  for (const [key, comp] of cache) {
    if (!comp.success || !comp.html || !comp.css) continue;

    const rootClass = extractComponentRootClass(comp.html);
    if (!rootClass || rootClass !== sectionSlug) continue;

    // Collision detected — rename using BEM child naming
    const roleSuffix = comp.formRole
      ? comp.formRole.replace(/([A-Z])/g, '-$1').toLowerCase()
      : 'component';
    const newRootClass = `${sectionSlug}__${roleSuffix}`;

    onStep?.(
      `  ⚠ Class collision: component "${comp.name}" root class "${rootClass}" ` +
      `matches section slug — renaming to "${newRootClass}"`,
    );

    // Rename in HTML: class="old" → class="new"
    // Only rename standalone root class, not BEM children (old__child stays)
    const rootClassPattern = new RegExp(
      `class="(${escapeRegex(rootClass)})"`,
      'g',
    );
    comp.html = comp.html.replace(rootClassPattern, `class="${newRootClass}"`);

    // Also fix multi-class attributes: class="old other-class"
    comp.html = comp.html.replace(
      new RegExp(`class="${escapeRegex(rootClass)}(\\s)`, 'g'),
      `class="${newRootClass}$1`,
    );

    // Rename in CSS: .old (standalone) → .new
    // Match .rootClass when NOT followed by __ or - (which would be BEM children)
    // Must be followed by whitespace, {, :, [, ., , or end
    comp.css = comp.css.replace(
      new RegExp(`\\.${escapeRegex(rootClass)}(?![_a-zA-Z0-9-])`, 'g'),
      `.${newRootClass}`,
    );

    cache.set(key, comp);
  }
}

// ── CSS Merging ─────────────────────────────────────────────────────────────

/**
 * Extracts the root CSS class from a component's generated HTML.
 * Returns the first class name from the first `class="..."` attribute.
 */
function extractComponentRootClass(html: string): string | null {
  if (!html) return null;
  const match = html.match(/class="([^"]+)"/);
  if (!match) return null;
  return match[1].split(/\s+/)[0] || null;
}

/**
 * Merges the section's CSS with CSS from all generated components.
 * Component CSS is included first so section CSS can override if needed.
 *
 * Each component's CSS is scoped under its root class to prevent
 * intra-section collisions (e.g. two components both defining `.label`
 * with different styles). Selectors that already reference the root class
 * are left unchanged via `skipSelfScoping`.
 */
function mergeSectionCSS(
  sectionCSS: string,
  components: GeneratedComponent[],
): string {
  const parts: string[] = [];

  for (const comp of components) {
    if (comp.success && comp.css) {
      // Scope component CSS under its root class to prevent intra-section
      // collisions between different components that share class names.
      const rootClass = extractComponentRootClass(comp.html);
      const scopedCSS = rootClass
        ? scopeSectionCSS(comp.css, rootClass, { skipSelfScoping: true })
        : comp.css;
      parts.push(`/* — Component: ${comp.name} — */\n${scopedCSS}`);
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
  assetHints?: string,
): Promise<CompoundSectionResult> {
  const serialized = serializeNode(sectionNode);
  fixStretchDimensions(serialized);
  const yaml = dump(serialized, { lineWidth: 120, noRefs: true });

  // When templateMode is on, use React direct generation (skip Mitosis parsing)
  const systemPrompt = templateMode
    ? assembleReactSectionSystemPrompt()
    : assemblePageSectionSystemPrompt(templateMode);
  let userPrompt = templateMode
    ? assembleReactSectionUserPrompt(yaml, sectionName, sectionIndex, totalSections, ctx)
    : assemblePageSectionUserPrompt(yaml, sectionName, sectionIndex, totalSections, ctx, templateMode);

  // Inject asset hints so the LLM knows about available SVG files
  if (assetHints) {
    const yamlIdx = userPrompt.indexOf('```yaml');
    if (yamlIdx !== -1) {
      userPrompt = userPrompt.slice(0, yamlIdx) + assetHints + '\n\n' + userPrompt.slice(yamlIdx);
    } else {
      userPrompt += '\n\n' + assetHints;
    }
  }

  try {
    if (templateMode) {
      const reactResult = await generateReactDirect(llm, systemPrompt, userPrompt);
      return {
        rawCode: reactResult.reactCode,
        css: reactResult.css,
        success: true,
        generatedComponents: [],
        discovery,
        chartComponents: [],
      };
    }

    const result = await generateWithRetry(
      llm, systemPrompt, userPrompt, onAttempt,
      undefined, undefined, undefined, undefined, undefined,
      yaml,  // source YAML for CSS fidelity validation
    );
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

// ── Stretch Dimension Fix ────────────────────────────────────────────────────

/**
 * Walks a serialized YAML tree and removes conflicting pixel dimensions
 * when a node has `alignSelf: stretch`.
 *
 * In Figma, `layoutAlign: STRETCH` means the element fills the parent's
 * cross-axis. The pixel dimension (from absoluteBoundingBox) is just the
 * rendered result, not a constraint. Emitting both causes the LLM to
 * output `width: 1080px; align-self: stretch;` — the pixel value defeats
 * the stretch and prevents responsive layout.
 *
 * - Column parent → cross-axis is horizontal → remove `width`
 * - Row parent → cross-axis is vertical → remove `height`
 *
 * Mutates the tree in place.
 */
function fixStretchDimensions(node: any, parentDirection?: 'row' | 'column'): void {
  if (!node) return;

  // Fix this node if it stretches and we know the parent direction
  if (node.alignSelf === 'stretch' && parentDirection) {
    if (parentDirection === 'column') {
      delete node.width;
      delete node.widthMode;
    } else {
      delete node.height;
      delete node.heightMode;
    }
  }

  // Determine this node's layout direction for its children
  const thisDirection: 'row' | 'column' | undefined =
    node.layout?.direction === 'row' ? 'row'
    : node.layout?.direction === 'column' ? 'column'
    : undefined;

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      fixStretchDimensions(child, thisDirection ?? parentDirection);
    }
  }
}

// ── Static Content Post-Processing ──────────────────────────────────────────

/**
 * Strips dynamic state usage from generated component code.
 *
 * PATH 1 components are part of static page sections — they should never
 * use `useStore`, `state.*`, or event handlers. Despite prompt instructions,
 * LLMs often generate dynamic state for form elements (selects, inputs,
 * checkboxes). This function cleans up the output:
 *
 * 1. Removes `useStore` import and `const state = useStore({...})` block
 * 2. Replaces `value={state.xxx}` with empty `value=""`
 * 3. Replaces `checked={state.xxx}` with nothing (removes the attr)
 * 4. Removes `onChange={(event) => ...}` handlers
 * 5. Replaces `{state.xxx}` text expressions with the nearest matching
 *    expected text from the node tree
 *
 * Mutates the rawCode string and returns the cleaned version.
 */
function stripDynamicState(rawCode: string, expectedTexts: string[]): string {
  let code = rawCode;

  // 1. Remove useStore import
  code = code.replace(/import\s*\{[^}]*useStore[^}]*\}\s*from\s*['"]@builder\.io\/mitosis['"];?\s*\n?/g, '');

  // 2. Remove const state = useStore({...}); block
  // Handle multi-line useStore declarations with nested braces
  code = code.replace(/const\s+state\s*=\s*useStore\(\{[\s\S]*?\}\);?\s*\n?/g, '');

  // 3. Replace value={state.xxx} with value="" (keeps select/input working)
  code = code.replace(/\bvalue=\{state\.\w+\}/g, 'value=""');

  // 4. Remove checked={state.xxx}
  code = code.replace(/\s*checked=\{state\.\w+\}/g, '');

  // 5. Remove onChange handlers
  code = code.replace(/\s*onChange=\{[^}]*\}/g, '');
  // Also handle multi-line onChange with arrow functions
  code = code.replace(/\s*onChange=\{\(event\)\s*=>\s*\([^)]*\)\}/g, '');
  code = code.replace(/\s*onChange=\{\(event\)\s*=>\s*\{[^}]*\}\}/g, '');

  // 6. Replace {state.xxx} text content with best matching expected text
  // Find all {state.xxx} patterns and try to match them to expected texts
  code = code.replace(/\{state\.(\w+)\}/g, (_match, propName: string) => {
    // Try to find a matching text from expected texts
    // Use heuristics: prop name might hint at the text
    // (e.g., "label" → button label, "value" → input value)
    // If no match, use empty string
    if (expectedTexts.length === 1) {
      return expectedTexts[0]; // Only one text — use it
    }

    // Try to match by position: {state.label} is usually the last text
    const lowerProp = propName.toLowerCase();
    if (lowerProp === 'label' || lowerProp === 'text' || lowerProp === 'title') {
      // Use the first expected text that hasn't been used as a structural text
      // (i.e., skip texts that appear as labels like "Label", "Field Name")
      const buttonText = expectedTexts.find(t =>
        !t.match(/^(Label|Field|Type|Select|Choose|Enter)/) && t.length > 0
      );
      if (buttonText) return buttonText;
    }

    return '';
  });

  return code;
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
