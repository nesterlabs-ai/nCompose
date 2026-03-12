/**
 * Builds dynamic prompts for the LLM to generate a Mitosis component
 * from a COMPONENT_SET. Works for any component type — buttons, inputs,
 * cards, badges, toggles, etc.
 *
 * The LLM receives:
 * 1. The actual child structure from data.childLayers (parser-resolved)
 * 2. Dynamic axes/props derived from the component set data
 * 3. A generic system prompt with no component-specific assumptions
 * 4. Design token and theming context from resolved variables
 * 5. Optionally, a YAML snippet of the default variant's tree
 */

import type {
  ComponentSetData,
  ClassifiedState,
  ChildLayerInfo,
  ComponentCategory,
} from './component-set-parser.js';
import type { AssetEntry } from './asset-export.js';
import { toKebabCase, toCamelCase, CATEGORY_HTML_TAGS } from './component-set-parser.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VariantPromptData {
  componentName: string;
  baseClass: string;
  /** Semantic HTML element from parser (e.g. "button", "div", "input") */
  elementType: string;
  /** ARIA role from parser (e.g. "button", "textbox", "combobox") */
  ariaRole: string;
  /** Component category detected by the parser */
  componentCategory: ComponentCategory;
  /** Variant axes (excluding state) with values and defaults */
  axes: { name: string; values: string[]; default: string }[];
  /** Props the component should accept */
  props: { name: string; type: string; default: string }[];
  /** Human-readable description of the component's child layers */
  structure: string;
  /** CSS class naming convention description */
  classNaming: string;
  /** State info derived from the state axis */
  stateInfo: {
    stateValues: string[];
    booleanProps: string[];
    classifiedStates: ClassifiedState[];
  } | null;
  /** CSS custom property tokens referenced in the default variant */
  cssTokens: string[];
  /** Names of available theme modes (e.g. ["Light", "Dark"]) */
  themeModes: string[];
  /** Filled-in HTML skeleton for this component category */
  semanticBlueprint: string | null;
  /** Category-specific rules that forbid the div-for-everything anti-pattern */
  categorySemanticRules: string[];
  /** Asset entries with variant tracking */
  assets?: AssetEntry[];
  /** Blueprints for nested component instances (chip, checkbox, radio, etc.) */
  nestedInstanceBlueprints?: { category: string; htmlTag: string; key: string; blueprint: string }[];
}

// ---------------------------------------------------------------------------
// SVG helpers
// ---------------------------------------------------------------------------

/** Collapses newlines and redundant whitespace in SVG markup for compact prompt embedding. */
function compactSvg(svgContent: string): string {
  return svgContent
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Structure description — uses parser's childLayers, not raw node walk
// ---------------------------------------------------------------------------

/**
 * Builds a human-readable description of the component structure
 * from parser-resolved ChildLayerInfo[]. This replaces the old manual
 * tree walk that re-implemented parser logic.
 *
 * @param assetMap      - Optional map from nodeId → "./assets/filename.svg" (for detection)
 * @param svgContentMap - Optional map from nodeId → inline SVG content (for embedding)
 */
function describeVariantStructure(
  data: ComponentSetData,
  assetMap?: Map<string, string>,
  svgContentMap?: Map<string, string>,
): string {
  const lines: string[] = [];

  lines.push(`Component: ${data.name}`);
  lines.push(`Semantic element: <${data.suggestedHtmlTag}>`);
  if (data.suggestedAriaRole) {
    lines.push(`ARIA role: ${data.suggestedAriaRole}`);
  }
  lines.push(`Category: ${data.componentCategory}`);
  lines.push('');

  // Build text-prop map: maps each TEXT layer → its prop name
  // Step 1: Map explicit textContentProperties to layers by matching defaultValue
  const textPropMap = new Map<string, string>();
  const availableProps = [...data.textContentProperties];
  for (const layer of data.childLayers) {
    if (!layer.isText || !layer.characters) continue;
    const matchIdx = availableProps.findIndex(p => p.defaultValue === layer.characters);
    if (matchIdx >= 0) {
      textPropMap.set(layer.key, toCamelCase(availableProps[matchIdx].name));
      availableProps.splice(matchIdx, 1); // consume so it's not matched again
    }
  }
  // Step 2: Auto-derive props for remaining TEXT layers (no matching textContentProperty)
  const seenPropNames = new Set<string>(textPropMap.values());
  for (const layer of data.childLayers) {
    if (!layer.isText || !layer.characters || !layer.characters.trim()) continue;
    if (textPropMap.has(layer.key)) continue;
    const segments = layer.key.split('__');
    let propName: string;
    if (segments.length >= 2) {
      propName = toCamelCase(segments[segments.length - 2]) + 'Label';
    } else {
      propName = toCamelCase(layer.key) + 'Text';
    }
    if (seenPropNames.has(propName)) {
      propName = propName + (seenPropNames.size + 1);
    }
    seenPropNames.add(propName);
    textPropMap.set(layer.key, propName);
  }

  // Use the parser's already-resolved childLayers — depth 0 are direct children
  const topLevel = data.childLayers.filter((l) => l.depth === 0);

  if (topLevel.length === 0) {
    lines.push('Children: (none)');
    return lines.join('\n');
  }

  lines.push('Children:');
  for (const layer of data.childLayers) {
    describeLayer(layer, lines, assetMap, data.childLayers, textPropMap, svgContentMap);
  }

  return lines.join('\n');
}

/**
 * Renders a single ChildLayerInfo entry as an indented description line.
 * Children at deeper depths are indented accordingly.
 */
function describeLayer(
  layer: ChildLayerInfo,
  lines: string[],
  assetMap?: Map<string, string>,
  allLayers?: ChildLayerInfo[],
  textPropMap?: Map<string, string>,
  svgContentMap?: Map<string, string>,
): void {
  const indent = '  '.repeat(layer.depth + 1);
  const name   = layer.originalName;

  // Skip internal Figma layers (convention: _prefix)
  if (name.startsWith('_')) return;

  // Hidden layer
  if (layer.css['display'] === 'none') {
    lines.push(`${indent}- "${name}" (hidden by default)`);
    return;
  }

  if (layer.isText) {
    const textPreview = layer.characters
      ? ` content="${layer.characters.length > 60 ? layer.characters.substring(0, 60) + '...' : layer.characters}"`
      : '';
    const derivedProp = textPropMap?.get(layer.key);
    const propHint = derivedProp ? ` → use: {props.${derivedProp} || "${layer.characters}"}` : '';
    lines.push(`${indent}- "${name}" (TEXT${textPreview}) → class: "${layer.key}"${propHint}`);

    // Inline runs tell us about mixed-style content
    if (layer.inlineRuns && layer.inlineRuns.length > 1) {
      lines.push(`${indent}  ↳ mixed styles: ${layer.inlineRuns.length} runs (varied font/color)`);
    }
    return;
  }

  if (layer.isImage) {
    const scaleMode = layer.imageScaleMode ?? 'FILL';
    lines.push(`${indent}- "${name}" (IMAGE, scale: ${scaleMode}) → class: "${layer.key}"`);
    return;
  }

  // ── Semantic INSTANCE nodes: prioritize category hint over asset map ──
  // Nested component instances (checkbox, radio, chip, search, etc.) must be
  // described with their semantic HTML tag, NOT swallowed by the asset map.
  if (layer.instanceCategory && layer.instanceHtmlTag) {
    const childCount = allLayers?.filter(
      (l) => l.depth === layer.depth + 1 && l.key.startsWith(layer.key + '__'),
    ).length ?? 0;
    const hint = deriveNestedHint(layer.instanceCategory);
    lines.push(
      `${indent}- "${name}" (${layer.instanceCategory} component${childCount > 0 ? `, ${childCount} children` : ''}) → class: "${layer.key}"`,
    );
    lines.push(
      `${indent}  ↳ MUST render as ${hint}`,
    );
    return;
  }

  // ── Asset node detection: any node whose nodeId is in the assetMap ──
  // This generically catches ALL exported SVG assets (icons, vectors, etc.)
  // regardless of node type or naming convention.
  if (assetMap) {
    // Direct nodeId lookup
    let assetPath = layer.nodeId ? assetMap.get(layer.nodeId) : undefined;
    // Also check vectorInfo.nodeId (for raw VECTOR nodes)
    if (!assetPath && layer.vectorInfo) {
      assetPath = assetMap.get(layer.vectorInfo.nodeId);
    }
    // Container wrapping an exported child asset (e.g. 72px circle → 48px check)
    if (!assetPath && allLayers) {
      const childAsset = allLayers.find(
        (l) => l.key.startsWith(layer.key + '__') && l.nodeId && assetMap.has(l.nodeId),
      );
      if (childAsset?.nodeId) assetPath = assetMap.get(childAsset.nodeId);
    }
    if (assetPath) {
      // Prefer inline SVG content; fall back to a note about the asset file.
      const svgNodeId = layer.nodeId ?? layer.vectorInfo?.nodeId;
      const svgContent = svgNodeId ? svgContentMap?.get(svgNodeId) : undefined;
      if (svgContent) {
        lines.push(`${indent}- "${name}" → render INLINE SVG (class: "${layer.key}"), SVG uses currentColor:`);
        lines.push(`${indent}  ${compactSvg(svgContent)}`);
      } else {
        lines.push(`${indent}- "${name}" → render INLINE SVG (class: "${layer.key}") — file: ${assetPath}`);
      }
      return;
    }
  }

  if (layer.vectorInfo) {
    lines.push(`${indent}- "${name}" (VECTOR, strokeCap: ${layer.vectorInfo.strokeCap}) → class: "${layer.key}"`);
    return;
  }

  if (layer.isIcon) {
    lines.push(`${indent}- "${name}" (icon slot, optional) → class: "${layer.key}"`);
    return;
  }

  // Container node — describe it, children are handled by their own entries
  const childCount = allLayers?.filter(
    (l) => l.depth === layer.depth + 1 && l.key.startsWith(layer.key + '__'),
  ).length ?? 0;

  lines.push(
    `${indent}- "${name}" (${layer.nodeType}${childCount > 0 ? `, ${childCount} children` : ''}) → class: "${layer.key}"`,
  );
}

// ---------------------------------------------------------------------------
// Prop generation
// ---------------------------------------------------------------------------

/**
 * Maps a Figma axis name to a component prop name.
 * Falls back to toCamelCase from the parser for any unrecognised name.
 */
function axisToPropName(axisName: string): string {
  const lower = axisName.toLowerCase().trim();
  const MAP: Record<string, string> = {
    style:      'variant',
    variant:    'variant',
    appearance: 'variant',
    type:       'variant',
    size:       'size',
    color:      'color',
    theme:      'color',
    shape:      'shape',
    density:    'density',
    weight:     'weight',
  };
  return MAP[lower] ?? toCamelCase(axisName);
}

/**
 * Builds the full props list from:
 * - Variant prop axes
 * - Figma component properties (INSTANCE_SWAP, TEXT, BOOLEAN)
 * - State-derived boolean props
 */
function buildDynamicProps(
  data: ComponentSetData,
): { name: string; type: string; default: string }[] {
  const props: { name: string; type: string; default: string }[] = [];
  const seen = new Set<string>();

  const add = (name: string, type: string, def: string) => {
    if (!seen.has(name)) { seen.add(name); props.push({ name, type, default: def }); }
  };

  // One prop per non-state variant axis
  for (const axis of data.propAxes) {
    const propName = axisToPropName(axis.name);
    const defaultValue = data.defaultVariant.props[axis.name] ?? axis.values[0];
    add(propName, axis.values.map((v) => `'${toKebabCase(v)}'`).join(' | '), `'${toKebabCase(defaultValue)}'`);
  }

  // INSTANCE_SWAP → ReactNode icon slot
  for (const iconProp of data.iconSlotProperties) {
    add(toCamelCase(iconProp.name), 'React.ReactNode', 'undefined');
  }

  // TEXT → string prop (from Figma component properties)
  for (const textProp of data.textContentProperties) {
    add(toCamelCase(textProp.name), 'string', `'${textProp.defaultValue}'`);
  }

  // Auto-derive text props for TEXT layers without explicit textContentProperties
  // First, identify which layers are covered by matching defaultValue
  const coveredLayerKeys = new Set<string>();
  const remainingProps = [...data.textContentProperties];
  for (const layer of data.childLayers) {
    if (!layer.isText || !layer.characters) continue;
    const matchIdx = remainingProps.findIndex(p => p.defaultValue === layer.characters);
    if (matchIdx >= 0) {
      coveredLayerKeys.add(layer.key);
      remainingProps.splice(matchIdx, 1);
    }
  }
  // Then derive props for uncovered TEXT layers
  const isAutoGenSegment = (s: string) =>
    /^(frame|group|rectangle|ellipse|line|vector|star|polygon|instance|component|section)-\d{3,}$/.test(s)
    || /^\d+$/.test(s);
  for (const layer of data.childLayers) {
    if (!layer.isText || !layer.characters || !layer.characters.trim()) continue;
    if (coveredLayerKeys.has(layer.key)) continue;
    const segments = layer.key.split('__');
    let propName: string;
    if (segments.length >= 2) {
      const parentSegment = segments[segments.length - 2];
      if (isAutoGenSegment(parentSegment)) {
        // Parent has auto-generated name — use the leaf segment instead
        propName = toCamelCase(segments[segments.length - 1]) + 'Label';
      } else {
        propName = toCamelCase(parentSegment) + 'Label';
      }
    } else {
      propName = toCamelCase(layer.key) + 'Text';
    }
    const safeDefault = layer.characters.replace(/'/g, "\\'");
    add(propName, 'string', `'${safeDefault}'`);
  }

  // BOOLEAN → visibility toggle
  for (const boolProp of data.booleanVisibilityProperties) {
    add(toCamelCase(boolProp.name), 'boolean', String(boolProp.defaultValue));
  }

  // State-derived boolean props (error, loading, disabled, etc.)
  for (const bp of data.booleanProps) {
    add(bp, 'boolean', 'false');
  }

  return props;
}

// ---------------------------------------------------------------------------
// Class naming description
// ---------------------------------------------------------------------------

function buildClassNaming(data: ComponentSetData, baseClass: string): string {
  const lines: string[] = [`Base class: "${baseClass}"`];

  // Variant modifier classes
  for (const axis of data.propAxes) {
    const propName = axisToPropName(axis.name);
    const example  = toKebabCase(axis.values[0]);
    lines.push(`${axis.name} modifier: "${baseClass}--{${propName}}" (e.g. "${baseClass}--${example}")`);
  }

  // State selectors — pulled directly from classifiedStates for accuracy
  for (const cs of data.classifiedStates) {
    if (!cs.booleanCondition && !cs.cssSelector) continue; // skip default

    const parts: string[] = [];
    if (cs.booleanCondition) parts.push(`data-${toKebabCase(cs.booleanCondition)} attribute`);
    if (cs.cssSelector)      parts.push(`CSS: ${cs.cssSelector}`);
    lines.push(`State "${cs.originalValue}": ${parts.join(' + ')}`);
  }

  // Child element classes
  lines.push(`Child elements: "${baseClass}__<child-name>" (e.g. "${baseClass}__label")`);

  // CSS custom properties if any
  if (data.cssTokensReferenced.length > 0) {
    lines.push(`CSS tokens in use: ${data.cssTokensReferenced.slice(0, 5).join(', ')}${data.cssTokensReferenced.length > 5 ? '…' : ''}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Asset helpers (unchanged logic, updated typing)
// ---------------------------------------------------------------------------

/**
 * Propagates asset paths from deep child nodes up to their parent containers
 * so icon-slot FRAMEs that contain a vector show the asset hint.
 */
function propagateAssetPaths(
  node: any,
  assetMap?: Map<string, string>,
): Map<string, string> {
  if (!assetMap || assetMap.size === 0) return new Map();

  const propagated = new Map<string, string>();

  function traverse(n: any): string | null {
    if (!n?.id) return null;
    const direct = assetMap?.get(n.id);
    if (direct) { propagated.set(n.id, direct); return direct; }

    let found: string | null = null;
    for (const child of n.children ?? []) {
      const childAsset = traverse(child);
      if (childAsset && !found) { found = childAsset; propagated.set(n.id, childAsset); }
    }
    return found;
  }

  traverse(node);
  return propagated;
}

// ---------------------------------------------------------------------------
// Semantic HTML blueprint — the key fix for the "everything is a div" problem
// ---------------------------------------------------------------------------

/**
 * Per-category: the exact HTML skeleton the LLM must produce.
 * Keys match ComponentCategory from the parser.
 *
 * Each blueprint is a short JSX skeleton with placeholder comments that
 * show the LLM exactly which Figma layers map to which HTML elements,
 * and how to collapse the visual frame tree into semantic markup.
 */
const CATEGORY_BLUEPRINTS: Partial<Record<string, string>> = {
  checkbox: `
/* CHECKBOX — collapse all Figma frames into this structure */
<label class={state.classes}>           {/* ROOT: <label> wraps everything so clicking label toggles checkbox */}
  <input
    type="checkbox"
    class="BASE__input"                  {/* hidden native checkbox — styled via CSS */}
    checked={props.valueType === 'checked' || props.valueType === 'indeterminate'}
    indeterminate={props.valueType === 'indeterminate'}
    disabled={props.disabled}
    onChange={...}
  />
  <span class="BASE__box">              {/* visual checkbox square — DO NOT use a div */}
    {/* icon/checkmark img goes here if checked/indeterminate */}
  </span>
  {props.hasLabel !== false && (
    <span class="BASE__label">{props.children}</span>
  )}
  {props.hasDescription !== false && (
    <span class="BASE__description">{props.description}</span>
  )}
</label>`,

  radio: `
/* RADIO — same pattern as checkbox */
<label class={state.classes}>
  <input type="radio" class="BASE__input" checked={props.checked} disabled={props.disabled} />
  <span class="BASE__box" />             {/* visual radio circle */}
  <span class="BASE__label">{props.children}</span>
</label>`,

  toggle: `
/* TOGGLE / SWITCH */
<button class={state.classes} role="switch" aria-checked={props.checked} disabled={props.disabled}>
  <span class="BASE__track">            {/* the pill track */}
    <span class="BASE__thumb" />        {/* the sliding dot */}
  </span>
  {props.hasLabel !== false && <span class="BASE__label">{props.children}</span>}
</button>`,

  switch: `
/* SWITCH — same as toggle */
<button class={state.classes} role="switch" aria-checked={props.checked} disabled={props.disabled}>
  <span class="BASE__track"><span class="BASE__thumb" /></span>
  {props.hasLabel !== false && <span class="BASE__label">{props.children}</span>}
</button>`,

  input: `
/* INPUT FIELD — root is a <div> wrapper, but MUST contain a real <input> */
<div class={state.classes}>
  {props.label && <label class="BASE__label" for="BASE-input">{props.label}</label>}
  <div class="BASE__field">              {/* the visual input box */}
    {props.leadingIcon && <span class="BASE__leading-icon">{props.leadingIcon}</span>}
    <input
      id="BASE-input"
      class="BASE__input"               {/* REAL <input> — never a contenteditable div */}
      type={props.type || 'text'}
      placeholder={props.placeholder || ''}
      value={props.value}
      disabled={props.disabled}
    />
    {props.trailingIcon && <span class="BASE__trailing-icon">{props.trailingIcon}</span>}
  </div>
  {props.hasHelperText !== false && (
    <span class="BASE__helper">{props.helperText}</span>
  )}
</div>`,

  textarea: `
/* TEXTAREA FIELD — root wrapper with label, real <textarea>, and helper/error */
<div class={state.classes}>
  {props.showTitle !== false && <span class="BASE__title">{props.title}</span>}
  {props.showLabel !== false && <label class="BASE__label" for="BASE-input">{props.label}</label>}
  {props.showDescription !== false && <span class="BASE__description">{props.description}</span>}
  <div class="BASE__field">               {/* visual textarea box — border, background */}
    <textarea
      id="BASE-input"
      class="BASE__input"                 {/* REAL <textarea> — NEVER a contenteditable div */}
      placeholder={props.placeholder}
      value={props.body || props.value}
      disabled={props.disabled}
      rows={props.rows || 3}
    />
  </div>
  {props.showError !== false && <span class="BASE__error">{props.error}</span>}
</div>`,

  select: `
/* SELECT / COMBOBOX — wrapper div with a real <select> or custom trigger */
<div class={state.classes}>
  {props.label && <label class="BASE__label">{props.label}</label>}
  <div class="BASE__trigger">           {/* visual select box */}
    <select class="BASE__select" disabled={props.disabled}>
      {/* options rendered by consumer */}
    </select>
    <span class="BASE__chevron" aria-hidden="true" />
  </div>
</div>`,

  button: `
/* BUTTON */
<button class={state.classes} disabled={props.disabled || props.loading}>
  {props.leadingIcon && <span class="BASE__leading-icon">{props.leadingIcon}</span>}
  <span class="BASE__label">{props.children}</span>
  {props.trailingIcon && <span class="BASE__trailing-icon">{props.trailingIcon}</span>}
  {props.loading && <span class="BASE__spinner" aria-hidden="true" />}
</button>`,

  'icon-button': `
/* ICON BUTTON */
<button class={state.classes} aria-label={props.label} disabled={props.disabled}>
  <span class="BASE__icon">{props.icon || <img src="./assets/icon.svg" alt="" />}</span>
</button>`,

  link: `
/* LINK */
<a class={state.classes} href={props.href || '#'} target={props.target}>
  {props.leadingIcon && <span class="BASE__leading-icon">{props.leadingIcon}</span>}
  <span class="BASE__label">{props.children}</span>
</a>`,

  tab: `
/* TAB */
<button class={state.classes} role="tab" aria-selected={props.selected} disabled={props.disabled}>
  {props.icon && <span class="BASE__icon">{props.icon}</span>}
  <span class="BASE__label">{props.children}</span>
  {props.badge && <span class="BASE__badge">{props.badge}</span>}
</button>`,

  'menu-item': `
/* MENU ITEM */
<li class={state.classes} role="menuitem">
  {props.leadingIcon && <span class="BASE__leading-icon">{props.leadingIcon}</span>}
  <span class="BASE__label">{props.children}</span>
  {props.trailingIcon && <span class="BASE__trailing-icon">{props.trailingIcon}</span>}
</li>`,

  badge: `
/* BADGE */
<span class={state.classes}>{props.children || props.count || '1'}</span>`,

  chip: `
/* CHIP — use <button>, not <div> */
<button class={state.classes} role="option" aria-selected={props.selected}>
  {props.leadingIcon && <span class="BASE__leading-icon">{props.leadingIcon}</span>}
  <span class="BASE__label">{props.children}</span>
  {props.onRemove && <span class="BASE__remove" aria-label="remove">×</span>}
</button>`,

  slider: `
/* SLIDER */
<div class={state.classes}>
  {props.label && <label class="BASE__label">{props.label}</label>}
  <div class="BASE__track">
    <input type="range" class="BASE__input" min={props.min || 0} max={props.max || 100} value={props.value || 0} disabled={props.disabled} />
    <span class="BASE__fill" />
    <span class="BASE__thumb" />
  </div>
  {props.showValue && <span class="BASE__value">{props.value}</span>}
</div>`,
};

/**
 * Returns a filled-in blueprint for the given category,
 * replacing "BASE" with the actual kebab-case component name.
 */
function getSemanticBlueprint(
  category: string,
  baseClass: string,
): string | null {
  const tpl = CATEGORY_BLUEPRINTS[category];
  if (!tpl) return null;
  return tpl.replace(/BASE/g, baseClass);
}

/**
 * Derives a compact, LLM-friendly rendering hint from the category blueprint.
 *
 * Generic: reads the blueprint to determine the root tag and any key inner
 * interactive elements (input, textarea, select, button).  No per-component
 * special-casing — works for every category that has a blueprint.
 *
 *  Examples:
 *    'checkbox' → '<label> wrapping <input type="checkbox">'
 *    'input'    → '<div> with real <input> inside — NOT just a <div>'
 *    'chip'     → '<button>'
 *    'button'   → '<button>'
 */
function deriveNestedHint(category: string): string {
  const bp = CATEGORY_BLUEPRINTS[category];
  if (!bp) {
    // Fall back to CATEGORY_HTML_TAGS
    const tag = CATEGORY_HTML_TAGS[category as ComponentCategory];
    return tag ? `<${tag}>` : '<div>';
  }

  // Extract root tag (first real HTML element, skip comments)
  const rootMatch = bp.match(/<(\w+)\b[^>]*>/);
  const rootTag = rootMatch ? rootMatch[1] : 'div';

  // Find key interactive elements inside the blueprint
  const innerInteractive = bp.match(/<(input|textarea|select)\b[^>]*type="([^"]+)"[^>]*/);
  const innerPlain = !innerInteractive ? bp.match(/<(input|textarea|select)\b/) : null;

  if (rootTag === 'div' || rootTag === 'span') {
    // Wrapper category — the important part is the inner element
    if (innerInteractive) {
      return `<${rootTag}> with real <${innerInteractive[1]} type="${innerInteractive[2]}"> inside — NOT just a <${rootTag}>`;
    }
    if (innerPlain) {
      return `<${rootTag}> with real <${innerPlain[1]}> inside — NOT just a <${rootTag}>`;
    }
    return `<${rootTag}>`;
  }

  // Non-wrapper root (label, button, a, dialog, etc.)
  if (innerInteractive) {
    return `<${rootTag}> wrapping <${innerInteractive[1]} type="${innerInteractive[2]}">`;
  }
  return `<${rootTag}>`;
}

/**
 * Returns strong natural-language rules specific to the component category
 * that tell the LLM exactly how to collapse the Figma frame tree.
 */
function getCategorySemanticRules(
  category: string,
  baseClass: string,
  elementType: string,
): string[] {
  const rules: string[] = [];

  // Universal rule — applies to every category
  rules.push(
    `CRITICAL — DO NOT render every Figma frame as a <div>. ` +
    `This is a **${category}** component. Map the Figma visual structure to proper semantic HTML as shown in the blueprint above.`,
  );

  switch (category) {
    case 'checkbox':
      rules.push(`Root element MUST be <label> — this allows clicking the label text to toggle the checkbox.`);
      rules.push(`The visual checkbox box (the square) MUST be a <span class="${baseClass}__box"> — NOT a <div>.`);
      rules.push(`There MUST be a real <input type="checkbox"> inside the label — even if it is visually hidden via CSS. The checked/indeterminate/disabled state is driven by props on this input.`);
      rules.push(`The checkmark icon (if any) goes INSIDE <span class="${baseClass}__box">, not in a separate div tree.`);
      rules.push(`Do NOT reproduce Figma's nested frame hierarchy (frame > checkboxAndLabel > checkbox > check > vector). Flatten it into: label > input[type=checkbox] + span.box + span.label.`);
      break;

    case 'radio':
      rules.push(`Root element MUST be <label>.`);
      rules.push(`MUST contain <input type="radio"> — visually hidden but present in DOM.`);
      rules.push(`Visual circle is <span class="${baseClass}__box">.`);
      break;

    case 'toggle':
    case 'switch':
      rules.push(`Root MUST be <button role="switch" aria-checked={...}> — not a div.`);
      rules.push(`The pill track is <span class="${baseClass}__track">, the thumb is <span class="${baseClass}__thumb"> inside it.`);
      rules.push(`Do NOT reproduce Figma's pill/circle frame nesting as divs.`);
      break;

    case 'input':
      rules.push(`The root is a <div class="${baseClass}"> wrapper — but it MUST contain a real <input> element, not a contenteditable div.`);
      rules.push(`<input> goes inside the visual field box: <div class="${baseClass}__field"><input class="${baseClass}__input" /></div>.`);
      rules.push(`Label text → <label> element with htmlFor pointing to the input id.`);
      rules.push(`Helper/error text → <span class="${baseClass}__helper">.`);
      rules.push(`Do NOT use a plain <div> where an <input> is needed.`);
      break;

    case 'textarea':
      rules.push(`The root is a <div class="${baseClass}"> wrapper — but it MUST contain a real <textarea> element, never a div with contenteditable.`);
      rules.push(`<textarea> goes inside the visual field box: <div class="${baseClass}__field"><textarea class="${baseClass}__input" /></div>.`);
      rules.push(`Label text → <label> element with htmlFor pointing to the textarea id.`);
      rules.push(`Helper/error text → <span class="${baseClass}__helper"> or <span class="${baseClass}__error">.`);
      rules.push(`The resize handle (drag icon / notches) is purely decorative CSS — do NOT render it as a separate div tree. Use CSS \`resize: vertical\` on the <textarea> instead.`);
      rules.push(`Do NOT reproduce Figma's nested frame hierarchy for the input area. Flatten it into: wrapper > textarea.`);
      break;

    case 'select':
      rules.push(`MUST contain a real <select class="${baseClass}__select"> inside the trigger wrapper.`);
      rules.push(`The chevron/arrow icon is presentational — render as <span class="${baseClass}__chevron" aria-hidden="true">.`);
      break;

    case 'button':
    case 'icon-button':
      rules.push(`Root MUST be <button> — never a <div> or <span>.`);
      rules.push(`disabled={props.disabled || props.loading || false} on the <button> element directly.`);
      break;

    case 'link':
      rules.push(`Root MUST be <a href={props.href || '#'}> — not a button or div.`);
      break;

    case 'tab':
      rules.push(`Root MUST be <button role="tab" aria-selected={...}>.`);
      break;

    case 'slider':
      rules.push(`MUST contain <input type="range"> for the actual slider control.`);
      rules.push(`The visual track and thumb are decorative spans layered on top.`);
      break;

    case 'menu':
      rules.push(`Root MUST be <ul role="menu"> — children are <li role="menuitem">.`);
      break;

    default:
      // For layout components (card, dialog, etc.) at least enforce root tag
      if (elementType !== 'div') {
        rules.push(`Root element MUST be <${elementType}> — not a <div>.`);
      }
      break;
  }

  return rules;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds the data object injected into the LLM prompt.
 *
 * @param data      - Parsed component set (from parseComponentSet)
 * @param assetMap  - Optional map nodeId → "./assets/filename.svg"
 * @param assets    - Optional full asset entries for conditional rendering hints
 */
export function buildVariantPromptData(
  data: ComponentSetData,
  assetMap?: Map<string, string>,
  assets?: AssetEntry[],
): VariantPromptData {
  const componentName = data.name.replace(/\s+/g, '');
  const baseClass     = toKebabCase(data.name);

  // Use parser's resolved values — no re-derivation needed
  const elementType        = data.suggestedHtmlTag;
  const ariaRole           = data.suggestedAriaRole;
  const componentCategory  = data.componentCategory;

  const axes = data.propAxes.map((axis) => ({
    name:    axis.name,
    values:  axis.values,
    default: data.defaultVariant.props[axis.name] ?? axis.values[0],
  }));

  const props      = buildDynamicProps(data);
  // Build nodeId → SVG content map so describeLayer can embed inline SVGs in the prompt.
  const svgContentMap = assets
    ? new Map(assets.filter(a => a.content).map(a => [a.nodeId, a.content!]))
    : undefined;
  const structure  = describeVariantStructure(data, assetMap, svgContentMap);
  const classNaming = buildClassNaming(data, baseClass);

  const stateInfo = data.stateAxis
    ? {
        stateValues:      data.stateAxis.values,
        booleanProps:     data.booleanProps,
        classifiedStates: data.classifiedStates,
      }
    : null;

  const cssTokens  = data.cssTokensReferenced;
  const themeModes = Object.keys(data.variableModesCSS);

  const semanticBlueprint    = getSemanticBlueprint(data.componentCategory, baseClass);
  const categorySemanticRules = getCategorySemanticRules(data.componentCategory, baseClass, elementType);

  // Collect blueprints for nested component instances (chip, checkbox, radio, etc.)
  const seenCategories = new Set<string>();
  const nestedInstanceBlueprints: { category: string; htmlTag: string; key: string; blueprint: string }[] = [];
  for (const layer of data.childLayers) {
    if (!layer.instanceCategory || !layer.instanceHtmlTag) continue;
    // Skip the root component's own category
    if (layer.instanceCategory === data.componentCategory) continue;
    if (seenCategories.has(layer.instanceCategory)) continue;
    seenCategories.add(layer.instanceCategory);
    const bp = getSemanticBlueprint(layer.instanceCategory, layer.key);
    if (bp) {
      nestedInstanceBlueprints.push({
        category: layer.instanceCategory,
        htmlTag: layer.instanceHtmlTag,
        key: layer.key,
        blueprint: bp,
      });
    }
  }

  return {
    componentName, baseClass, elementType, ariaRole, componentCategory,
    axes, props, structure, classNaming, stateInfo,
    cssTokens, themeModes,
    semanticBlueprint, categorySemanticRules,
    assets,
    nestedInstanceBlueprints: nestedInstanceBlueprints.length > 0 ? nestedInstanceBlueprints : undefined,
  };
}

/**
 * Builds the full user prompt sent to the LLM.
 */
/**
 * Extracts the unique BEM element class names (base__element) from a CSS string.
 * Used to build the explicit class inventory shown to the LLM.
 */
function extractCSSElementClasses(css: string, base: string): string[] {
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match .base__element (not modifiers --foo, not pseudo-selectors :hover)
  const pattern = new RegExp(`\\.${escaped}__([a-zA-Z0-9_-]+)(?=[^a-zA-Z0-9_-]|$)`, 'g');
  const seen    = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null) {
    // Exclude modifier classes (--) appearing as nested selectors in context
    if (!match[1].includes('--')) {
      seen.add(`${base}__${match[1]}`);
    }
  }
  return [...seen].sort();
}

export function buildComponentSetUserPrompt(
  promptData: VariantPromptData,
  defaultVariantYaml?: string,
  componentSetData?: ComponentSetData,
  variantCSS?: string,
  templateMode?: boolean,
): string {
  const lines: string[] = [];

  // ── Header ──────────────────────────────────────────────────────────────
  lines.push(`## Component Set: ${promptData.componentName}`);
  lines.push(`> Category: **${promptData.componentCategory}** | Element: \`<${promptData.elementType}>\` | ARIA: \`${promptData.ariaRole || 'none'}\``);
  lines.push('');

  // ── Structure ────────────────────────────────────────────────────────────
  lines.push('### Figma Structure (for reference only)');
  lines.push('> ⚠️  This is the raw Figma frame tree. Do NOT copy it as nested divs.');
  lines.push('> Map it to semantic HTML using the blueprint below.');
  lines.push(promptData.structure);
  lines.push('');

  // ── Semantic HTML blueprint ───────────────────────────────────────────────
  // This is the most important section — tells the LLM exactly what HTML to emit
  lines.push('### ✅ Required HTML Structure (FOLLOW THIS, not the Figma frames above)');
  lines.push(`This is a **${promptData.componentCategory}** component. You MUST use this HTML skeleton:`);
  lines.push('');
  if (promptData.semanticBlueprint) {
    lines.push('```tsx');
    lines.push(promptData.semanticBlueprint.trim());
    lines.push('```');
  } else {
    lines.push(`Root element: \`<${promptData.elementType}>\``);
    if (promptData.ariaRole) lines.push(`ARIA role: \`${promptData.ariaRole}\``);
  }
  lines.push('');

  // ── Category-specific semantic rules ─────────────────────────────────────
  lines.push('### ⛔ Semantic Rules (violations = wrong output)');
  for (const rule of promptData.categorySemanticRules) {
    lines.push(`- ${rule}`);
  }
  lines.push('');

  // ── Nested component instance blueprints ──────────────────────────────────
  if (promptData.nestedInstanceBlueprints && promptData.nestedInstanceBlueprints.length > 0) {
    lines.push('### Nested Component HTML (MANDATORY for nested instances)');
    lines.push('The Figma structure contains these nested component instances.');
    lines.push('You MUST use the HTML patterns below — do NOT wrap them in extra `<div>`s.');
    lines.push('');
    for (const nb of promptData.nestedInstanceBlueprints) {
      lines.push(`#### ${nb.category} (class: "${nb.key}")`);
      lines.push('```tsx');
      lines.push(nb.blueprint.trim());
      lines.push('```');
      lines.push('');
    }
  }

  // ── Conditional assets ───────────────────────────────────────────────────
  if (promptData.assets && promptData.assets.length > 0) {
    const totalVariants = componentSetData?.variants.length ?? 0;
    const conditionalAssets = promptData.assets.filter(
      (a) => a.variants && a.variants.length > 0,
    );

    // Determine default variant prop values for default-variant detection
    const defaultVariantProps = componentSetData?.defaultVariant?.props ?? {};

    if (conditionalAssets.length > 0) {
      lines.push('### Icon / Asset Conditional Rendering');
      lines.push('');
      lines.push('**IMPORTANT:** When checking for the default variant value, ALWAYS include a fallback for undefined:');
      lines.push('  WRONG:  `props.variant === \'success\'`');
      lines.push('  RIGHT:  `props.variant === \'success\' || !props.variant`');
      lines.push('');

      // Group assets by shapeGroupId to identify color variants of the same icon
      const shapeGroups = new Map<string, typeof conditionalAssets>();
      for (const asset of conditionalAssets) {
        const gid = asset.shapeGroupId || asset.filename;
        if (!shapeGroups.has(gid)) shapeGroups.set(gid, []);
        shapeGroups.get(gid)!.push(asset);
      }

      for (const [, groupAssets] of shapeGroups) {
        // All same-shape icons now share one SVG (colours normalised to currentColor).
        // Only show as conditional if the icon does NOT appear in every variant.
        const asset = groupAssets[0];
        const names = asset.variants ?? [];
        const appearsIn = names.length;
        if (appearsIn >= totalVariants) continue; // appears in all variants — not conditional

        const posLabel = asset.parentName || 'icon';
        const iconLabel = asset.nodeName || 'icon';
        const svgSnippet = asset.content ? compactSvg(asset.content) : `(file: ./assets/${asset.filename})`;

        const onlyLoading  = names.every((v) => v.toLowerCase().includes('loading'));
        const onlyDisabled = names.every((v) => v.toLowerCase().includes('disabled'));

        // Check if this icon appears in the default variant
        const defaultPropValues = Object.values(defaultVariantProps).map(v => v.toLowerCase());
        const isInDefaultVariant = names.some((v) =>
          defaultPropValues.some(dv => v.toLowerCase().includes(dv))
        );

        lines.push(`**${posLabel} / ${iconLabel}** — conditional inline SVG:`);
        lines.push(`  SVG: ${svgSnippet}`);
        if (onlyLoading) {
          lines.push(`  Only in LOADING state → render: \`{props.loading && <svg ...>...</svg>}\``);
        } else if (onlyDisabled) {
          lines.push(`  Only in DISABLED state → render: \`{props.disabled && <svg ...>...</svg>}\``);
        } else if (names.length <= 6) {
          lines.push(`  Only in: ${names.join(', ')}`);
          if (isInDefaultVariant) {
            // Identify which variant value is the default
            const defaultVal = names.find((v) =>
              defaultPropValues.some(dv => v.toLowerCase().includes(dv))
            );
            if (defaultVal) {
              const kebab = toKebabCase(defaultVal);
              lines.push(`  ⚠️ "${defaultVal}" is the DEFAULT variant — also render when prop is undefined:`);
              lines.push(`    \`{(props.variant === '${kebab}' || !props.variant) && <svg ...>}</svg>}\``);
            }
          }
        } else {
          lines.push(`  Appears in ${appearsIn}/${totalVariants} variants`);
        }
        lines.push('');
      }
    }
  }

  // ── Variant axes ─────────────────────────────────────────────────────────
  if (promptData.axes.length > 0) {
    lines.push('### Variant Axes');
    for (const axis of promptData.axes) {
      lines.push(`- **${axis.name}**: [${axis.values.join(', ')}] (default: \`${axis.default}\`)`);
    }
    lines.push('');
  }

  // ── Multiple state axes ──────────────────────────────────────────────────
  if (componentSetData?.stateAxes && componentSetData.stateAxes.length > 1) {
    lines.push('### Additional State Axes');
    for (const sa of componentSetData.stateAxes.slice(1)) {
      lines.push(`- **${sa.name}**: [${sa.values.join(', ')}]`);
    }
    lines.push('');
  }

  // ── State info ───────────────────────────────────────────────────────────
  if (promptData.stateInfo) {
    lines.push('### States');
    lines.push(`- All values: [${promptData.stateInfo.stateValues.join(', ')}]`);
    lines.push('- Handled via CSS pseudo-classes and data-attribute modifiers (see Class Convention)');
    if (promptData.stateInfo.booleanProps.length > 0) {
      lines.push(`- Boolean conditions: \`${promptData.stateInfo.booleanProps.join('`, `')}\``);
    }

    // Emit the full classified state → selector table so LLM uses exact selectors
    lines.push('- Selector map:');
    for (const cs of promptData.stateInfo.classifiedStates) {
      if (!cs.booleanCondition && !cs.cssSelector) {
        lines.push(`  - \`${cs.originalValue}\` → base state (no modifier)`);
      } else {
        const parts: string[] = [];
        if (cs.booleanCondition) parts.push(`data-${toKebabCase(cs.booleanCondition)}`);
        if (cs.cssSelector)      parts.push(cs.cssSelector);
        lines.push(`  - \`${cs.originalValue}\` → ${parts.join(' + ')}`);
      }
    }
    lines.push('');
  }

  // ── Figma component properties ───────────────────────────────────────────
  if (componentSetData) {
    const hasIconSlots   = componentSetData.iconSlotProperties.length > 0;
    const hasTextProps   = componentSetData.textContentProperties.length > 0;
    const hasBoolProps   = componentSetData.booleanVisibilityProperties.length > 0;

    if (hasIconSlots || hasTextProps || hasBoolProps) {
      lines.push('### Figma Component Properties');

      if (hasIconSlots) {
        lines.push('**Icon Slots (INSTANCE_SWAP)** — expose as `React.ReactNode` props:');
        for (const p of componentSetData.iconSlotProperties) {
          lines.push(`- \`${toCamelCase(p.name)}\`: swappable icon/component`);
        }
        lines.push('  → Use: `{props.iconName || <svg ...>...</svg>}` (inline SVG fallback)');
        lines.push('');
      }

      if (hasTextProps) {
        lines.push('**Text Content (TEXT)** — expose as `string` props and use as text content:');
        for (const p of componentSetData.textContentProperties) {
          const propName = toCamelCase(p.name);
          // Find the TEXT layer this property maps to
          const matchingLayer = componentSetData.childLayers.find(
            l => l.isText && l.characters === p.defaultValue
          );
          const classHint = matchingLayer ? ` (maps to class: "${matchingLayer.key}")` : '';
          lines.push(`- \`${propName}\`: default \`"${p.defaultValue}"\`${classHint}`);
          lines.push(`  → Use: \`{props.${propName} || "${p.defaultValue}"}\` as the text content`);
        }
        lines.push('');
      }

      if (hasBoolProps) {
        lines.push('**Visibility Toggles (BOOLEAN)** — expose as `boolean` props:');
        for (const p of componentSetData.booleanVisibilityProperties) {
          const propName = toCamelCase(p.name);
          const pattern  = p.defaultValue
            ? `{props.${propName} !== false ? <element /> : null}  // defaults TRUE`
            : `{props.${propName} ? <element /> : null}            // defaults FALSE`;
          lines.push(`- \`${propName}\`: default \`${p.defaultValue}\` → \`${pattern}\``);
        }
        lines.push('');
      }
    }
  }

  // ── Variant-specific text content ───────────────────────────────────────
  if (componentSetData?.variantTextDiffs && componentSetData.variantTextDiffs.length > 0) {
    lines.push('### Variant-Specific Text Content');
    lines.push('These TEXT layers have DIFFERENT content depending on the variant.');
    lines.push('You MUST generate conditional text rendering based on the variant prop.');
    lines.push('');
    for (const diff of componentSetData.variantTextDiffs) {
      const axisName = diff.axisName;
      const propName = axisName.toLowerCase() === 'style' || axisName.toLowerCase() === 'type'
        ? 'variant'
        : toCamelCase(axisName);
      lines.push(`- Layer class \`${diff.layerKey}\`:`);
      lines.push(`  - Default (${axisName}): "${diff.defaultText}"`);
      for (const [variantLabel, text] of Object.entries(diff.variantTexts)) {
        lines.push(`  - ${variantLabel}: "${text}"`);
      }
      // Build a concrete code hint
      const entries = Object.entries(diff.variantTexts);
      if (entries.length <= 4) {
        const conditions = entries
          .map(([label, text]) => `props.${propName} === '${label.toLowerCase()}' ? '${text.replace(/'/g, "\\'")}'`)
          .join(' : ');
        lines.push(`  → Use: \`{${conditions} : '${diff.defaultText.replace(/'/g, "\\'")}'}\``);
      } else {
        lines.push(`  → Derive text from the \`props.${propName}\` prop value`);
      }
      lines.push('');
    }
  }

  // ── CSS tokens / design variables ────────────────────────────────────────
  if (promptData.cssTokens.length > 0) {
    lines.push('### CSS Design Tokens');
    lines.push('The following CSS custom properties are used in the default variant:');
    for (const token of promptData.cssTokens) {
      lines.push(`- \`${token}\``);
    }
    lines.push('Do NOT hardcode these colors/values — reference the tokens in your CSS.');
    lines.push('');
  }

  // ── Theme / variable modes ───────────────────────────────────────────────
  if (promptData.themeModes.length > 0) {
    lines.push('### Theme Modes');
    lines.push(`Available modes: **${promptData.themeModes.join(', ')}**`);
    lines.push('Styles are applied automatically via CSS variable overrides — no JS switching needed.');
    lines.push('');
  }

  // ── Child layer details (image scale modes, inline runs) ─────────────────
  if (componentSetData) {
    const imageLayers  = componentSetData.childLayers.filter((l) => l.isImage && l.imageScaleMode);
    const inlineLayers = componentSetData.childLayers.filter((l) => (l.inlineRuns?.length ?? 0) > 1);

    if (imageLayers.length > 0) {
      lines.push('### Image Layers');
      for (const l of imageLayers) {
        lines.push(`- \`${l.key}\` — scale mode: \`${l.imageScaleMode}\``);
      }
      lines.push('');
    }

    if (inlineLayers.length > 0) {
      lines.push('### Mixed-Style Text');
      lines.push('These text layers have inline style runs (mixed fonts/colors):');
      for (const l of inlineLayers) {
        const runCount = l.inlineRuns?.length ?? 0;
        lines.push(`- \`${l.key}\` — ${runCount} style runs`);
        lines.push('  → Render as `<span>` elements inside the text container, each with its own class');
      }
      lines.push('');
    }
  }

  // ── CSS class convention ─────────────────────────────────────────────────
  lines.push('### CSS Class Convention');
  lines.push(promptData.classNaming);
  lines.push('');

  // ── CSS class inventory ───────────────────────────────────────────────────
  // Include the EXACT class names from the generated CSS so the LLM can't
  // invent different names. This is the single source of truth for child element
  // class names — the JSX must use these exactly.
  if (variantCSS) {
    const base           
    = toKebabCase(promptData.componentName);
    const elementClasses = extractCSSElementClasses(variantCSS, base);
    if (elementClasses.length > 0) {
      lines.push('### ⚠️ Exact Child CSS Classes — Use ONLY These');
      lines.push(
        'The CSS has already been generated with these child element class names. ' +
        'Your JSX `class=""` attributes **must** use exactly these names — do NOT invent alternatives:',
      );
      lines.push('');
      lines.push('```');
      for (const cls of elementClasses) {
        lines.push(`.${cls}`);
      }
      lines.push('```');
      lines.push('');
      lines.push(
        '> If the HTML skeleton above uses different names, rename those attributes to match this list. ' +
        'Every `class="…"` on a child element must reference a class from this inventory.',
      );
      lines.push('');
    }
  }

  // ── Props table ──────────────────────────────────────────────────────────
  lines.push('### Props');
  for (const prop of promptData.props) {
    lines.push(`- \`${prop.name}\`: \`${prop.type}\` (default: \`${prop.default}\`)`);
  }
  lines.push('- `children`: content for text slots');
  lines.push('');

  // ── Requirements ─────────────────────────────────────────────────────────
  lines.push('### Requirements');
  const reqs: string[] = [];

  reqs.push('Generate a Mitosis (.lite.tsx) component');
  reqs.push('Use `useStore` with a getter `get classes()` that builds the CSS class string from props');
  reqs.push('Bind via `class={state.classes}` — do NOT use `css={{}}`');
  reqs.push(`Accept props: ${promptData.props.map((p) => `\`${p.name}\``).join(', ')}, and \`children\``);
  reqs.push('Preserve exact Figma text content from the structure/YAML; do NOT replace it with placeholders like "Label" or "Item"');
  reqs.push('Preserve exact dimensions and spacing from the provided Figma data/CSS; do NOT invent responsive substitutions');

  // Element-specific requirements
  const el = promptData.elementType;
  if (el === 'button') {
    const hasDisabled = promptData.props.some((p) => p.name === 'disabled');
    const hasLoading  = promptData.props.some((p) => p.name === 'loading');
    if (hasDisabled || hasLoading) {
      const cond = [hasDisabled && 'props.disabled', hasLoading && 'props.loading'].filter(Boolean).join(' || ');
      reqs.push(`Set \`disabled={${cond}}\` on the \`<button>\``);
    }
  } else if (['input', 'textarea'].includes(el)) {
    reqs.push(`Render a \`<${el}>\` for the text entry area`);
    if (promptData.props.some((p) => p.name === 'disabled')) {
      reqs.push(`Pass \`disabled\` prop to the \`<${el}>\` element`);
    }
  }

  // ARIA role
  if (promptData.ariaRole) {
    reqs.push(`Add \`role="${promptData.ariaRole}"\` to the root element`);
  }

  // Boolean props → data attributes
  const dataAttrProps = promptData.props.filter(
    (p) => p.type === 'boolean' && !['disabled', 'loading'].includes(p.name),
  );
  if (dataAttrProps.length > 0) {
    reqs.push(
      `For boolean props [${dataAttrProps.map((p) => `\`${p.name}\``).join(', ')}], ` +
      `add kebab-case data attributes from the Selector map (e.g. \`props.filledIn\` → \`data-filled-in\`)`,
    );
  }

  // CSS tokens
  if (promptData.cssTokens.length > 0) {
    reqs.push('Do NOT hardcode colors or spacing — reference the CSS custom properties listed in tokens');
  }

  // Inline text runs
  const hasInlineRuns = componentSetData?.childLayers.some((l) => (l.inlineRuns?.length ?? 0) > 1);
  if (hasInlineRuns) {
    reqs.push('For mixed-style text layers, wrap each style run in its own `<span>` with a BEM modifier class');
  }

  // Icon slots
  if (componentSetData && componentSetData.iconSlotProperties.length > 0) {
    reqs.push('For icon slot props, use: `{props.iconName || <svg ...>...</svg>}` (inline SVG fallback)');
  }

  reqs.push('Use string concatenation (not template literals) for building the class string');

  // Default variant fallback — ensure icons/content render when prop is undefined
  if (promptData.axes.length > 0) {
    const defaultAxis = promptData.axes[0];
    reqs.push(
      `When conditionally rendering content for the default variant value ('${toKebabCase(defaultAxis.default)}'), ` +
      `ALWAYS include a fallback: \`props.${axisToPropName(defaultAxis.name)} === '${toKebabCase(defaultAxis.default)}' || !props.${axisToPropName(defaultAxis.name)}\``
    );
  }

  reqs.forEach((req, i) => lines.push(`${i + 1}. ${req}`));
  lines.push('');

  // ── Default variant YAML ─────────────────────────────────────────────────
  if (defaultVariantYaml) {
    lines.push('### Default Variant Tree (YAML)');
    lines.push('Use this to understand the exact component structure:');
    lines.push('```yaml');
    lines.push(defaultVariantYaml);
    lines.push('```');
  }

  return lines.join('\n');
}

/**
 * Builds the system prompt for the LLM.
 * Contains the full semantic HTML mapping table and hard rules against div-spam.
 * templateMode is ignored for styling; component uses same BEM/CSS class strategy as before.
 */
export function buildComponentSetSystemPrompt(templateMode?: boolean): string {
  const base = `You are a Mitosis component generator. You receive a Figma component set description. Your job is to generate correct, semantic, accessible HTML — NOT a div-for-every-frame recreation of the Figma layer tree.

## The #1 Rule
**Figma frames are NOT HTML elements.** A Figma design has nested frames (Frame > Group > Frame > Rectangle) purely for visual layout. Your job is to IGNORE that nesting and output the correct semantic HTML element for the component TYPE.

## Semantic HTML Mapping Table
When you see these component categories, you MUST use these elements — no exceptions:

| Category   | Root element          | Key inner elements                                      |
|------------|-----------------------|---------------------------------------------------------|
| checkbox   | \`<label>\`           | \`<input type="checkbox">\` + \`<span>\` for visual box |
| radio      | \`<label>\`           | \`<input type="radio">\` + \`<span>\` for visual circle  |
| toggle     | \`<button role="switch">\` | \`<span>\` track + \`<span>\` thumb                |
| switch     | \`<button role="switch">\` | \`<span>\` track + \`<span>\` thumb                |
| input      | \`<div>\` wrapper     | MUST contain real \`<input>\` — NEVER contenteditable   |
| textarea   | \`<div>\` wrapper     | MUST contain real \`<textarea>\`                        |
| select     | \`<div>\` wrapper     | MUST contain real \`<select>\`                          |
| button     | \`<button>\`          | \`<span>\` for label, \`<span>\` for icons              |
| icon-button| \`<button>\`          | \`<span>\` for icon                                     |
| link       | \`<a href="...">\`    | \`<span>\` for label                                    |
| tab        | \`<button role="tab">\` | \`<span>\` for label/icon                            |
| menu       | \`<ul role="menu">\`  | \`<li role="menuitem">\` children                       |
| menu-item  | \`<li role="menuitem">\` | \`<span>\` for label/icon                           |
| badge      | \`<span>\`            | text content directly                                   |
| chip       | \`<button role="option">\` | \`<span>\` for label, \`<span>\` for remove           |
| slider     | \`<div>\` wrapper     | MUST contain \`<input type="range">\`                   |
| dialog     | \`<dialog>\`          | standard dialog children                                |
| card       | \`<article>\`         | standard card children                                  |
| nav        | \`<nav>\`             | \`<ul>\` + \`<li>\` + \`<a>\` children                 |

## Hard Rules — These are NEVER acceptable

1. **NEVER** render a checkbox as \`<div><div><div>...</div></div></div>\`. It MUST have \`<input type="checkbox">\`.
2. **NEVER** render a button as a \`<div>\`. It MUST be \`<button>\`.
3. **NEVER** render an input field as a \`<div>\` without a real \`<input>\` inside.
4. **NEVER** render a link as a \`<div>\` or \`<button>\`. It MUST be \`<a href="...">\`.
5. **NEVER** use \`disabled\` attribute on a \`<div>\` — it does nothing. Use CSS class \`--disabled\` instead or put \`disabled\` on the inner \`<input>\`/\`<button>\`.
6. **NEVER** reproduce Figma's frame nesting depth in HTML. Figma has 5 levels of nesting for a checkbox — HTML needs 3.
7. **ALWAYS** use the HTML skeleton from the "Required HTML Structure" section in the user prompt.
8. Child element class names MUST always use the full BEM path from root: \`base__child__grandchild\`, NEVER just \`child__grandchild\`.

## Output Rules
1.  Export exactly ONE default function component
2.  Use \`class\` NOT \`className\` for CSS classes
3.  Do NOT use \`css={{}}\` — all styling is via CSS classes
4.  Use \`useStore\` with a getter \`get classes()\` to compute the class string
5.  Import what you need from '@builder.io/mitosis': \`useStore\`, and \`For\`/\`Show\` if used
6.  Use string concatenation with \`+\` — no template literals
7.  Access props directly (e.g. \`props.variant\`) — do NOT destructure
8.  For text content: \`{props.children || 'Fallback'}\`
9.  For boolean state props (loading, error, checked, etc.): add EXACTLY the \`data-*\` attribute listed in the "Selector map" (e.g. if CSS uses \`[data-loading]\`, add \`data-loading={props.loading || undefined}\` to root). Hover and Focus are handled by native CSS pseudo-classes (\`:hover\`, \`:focus-visible\`) — do NOT add data-hover or data-focus attributes.
10. CRITICAL: SVG icons MUST be rendered INLINE — paste the SVG XML directly into JSX. NEVER use \`<img src="...">\` for SVG icons. The SVG already uses \`currentColor\` so the parent's CSS \`color\` property controls the icon colour automatically.
11. CRITICAL: BOOLEAN default TRUE  → \`{props.name !== false ? <el /> : null}\`
12. CRITICAL: BOOLEAN default FALSE → \`{props.name ? <el /> : null}\`
13. Do NOT hardcode colors listed as CSS tokens
14. Use \`<For each={expression}>{(item, index) => (...)}</For>\` for lists — NEVER use .map()
15. Use \`<Show when={condition}>...</Show>\` for conditional JSX elements — NEVER use ternaries to render/hide elements
16. Event handler parameter MUST be named \`event\` (e.g. \`onChange={(event) => ...}\`)
17. State variable MUST be named \`state\`: \`const state = useStore({...})\`
18. All numeric CSS values MUST include units: \`'16px'\`, \`'1.5em'\` — NEVER bare numbers

## Class-Building Pattern
\`\`\`tsx
import { useStore, Show } from '@builder.io/mitosis';

export default function CheckboxField(props) {
  const state = useStore({
    get classes() {
      let cls = 'checkbox-field';
      cls = cls + ' checkbox-field--' + (props.valueType || 'checked');
      if (props.disabled) cls = cls + ' checkbox-field--disabled';
      return cls;
    }
  });

  return (
    <label class={state.classes}>
      <input
        type="checkbox"
        class="checkbox-field__input"
        checked={props.valueType === 'checked' || props.valueType === 'indeterminate'}
        disabled={props.disabled}
      />
      <span class="checkbox-field__box">
        {(props.valueType === 'checked') && <img src="./assets/check.svg" alt="" />}
        {(props.valueType === 'indeterminate') && <img src="./assets/minus.svg" alt="" />}
      </span>
      <Show when={props.hasLabel !== false}>
        <span class="checkbox-field__label">{props.children}</span>
      </Show>
      <Show when={props.hasDescription !== false}>
        <span class="checkbox-field__description">{props.description}</span>
      </Show>
    </label>
  );
}
\`\`\`

Respond with ONLY the .lite.tsx code. No markdown fences, no explanation.
Start directly with the import statement.`;
  return base;
}
