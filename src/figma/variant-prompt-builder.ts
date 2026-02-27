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
import { toKebabCase, toCamelCase } from './component-set-parser.js';

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
}

// ---------------------------------------------------------------------------
// Structure description — uses parser's childLayers, not raw node walk
// ---------------------------------------------------------------------------

/**
 * Builds a human-readable description of the component structure
 * from parser-resolved ChildLayerInfo[]. This replaces the old manual
 * tree walk that re-implemented parser logic.
 *
 * @param assetMap - Optional map from nodeId → "./assets/filename.svg"
 */
function describeVariantStructure(
  data: ComponentSetData,
  assetMap?: Map<string, string>,
): string {
  const lines: string[] = [];

  lines.push(`Component: ${data.name}`);
  lines.push(`Semantic element: <${data.suggestedHtmlTag}>`);
  if (data.suggestedAriaRole) {
    lines.push(`ARIA role: ${data.suggestedAriaRole}`);
  }
  lines.push(`Category: ${data.componentCategory}`);
  lines.push('');

  // Use the parser's already-resolved childLayers — depth 0 are direct children
  const topLevel = data.childLayers.filter((l) => l.depth === 0);

  if (topLevel.length === 0) {
    lines.push('Children: (none)');
    return lines.join('\n');
  }

  lines.push('Children:');
  for (const layer of data.childLayers) {
    describeLayer(layer, lines, assetMap, data.childLayers);
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
    // Try to get text content from the raw node via the key matching
    lines.push(`${indent}- "${name}" (TEXT) → class: "${layer.key}"`);

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

  if (layer.vectorInfo) {
    // Raw vector / SVG node
    const assetPath = assetMap?.get(layer.vectorInfo.nodeId);    if (assetPath) {
      lines.push(`${indent}- "${name}" (VECTOR) → render as: <img src="${assetPath}" alt="" />`);
    } else {
      lines.push(`${indent}- "${name}" (VECTOR, strokeCap: ${layer.vectorInfo.strokeCap})`);
    }
    return;
  }

  if (layer.isIcon) {
    // Icon slot: FRAME/GROUP/INSTANCE wrapping a vector
    const assetPath = assetMap?.get(layer.key);
    if (assetPath) {
      lines.push(`${indent}- "${name}" (icon slot) → render as: <img src="${assetPath}" alt="" />`);
    } else {
      lines.push(`${indent}- "${name}" (icon slot, optional) → class: "${layer.key}"`);
    }
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

  // TEXT → string prop
  for (const textProp of data.textContentProperties) {
    add(toCamelCase(textProp.name), 'string', `'${textProp.defaultValue}'`);
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
    if (cs.booleanCondition) parts.push(`data-${cs.booleanCondition} attribute`);
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
    <span class="BASE__label">{props.children || 'Label'}</span>
  )}
  {props.hasDescription !== false && (
    <span class="BASE__description">{props.description || 'Description'}</span>
  )}
</label>`,

  radio: `
/* RADIO — same pattern as checkbox */
<label class={state.classes}>
  <input type="radio" class="BASE__input" checked={props.checked} disabled={props.disabled} />
  <span class="BASE__box" />             {/* visual radio circle */}
  <span class="BASE__label">{props.children || 'Label'}</span>
</label>`,

  toggle: `
/* TOGGLE / SWITCH */
<button class={state.classes} role="switch" aria-checked={props.checked} disabled={props.disabled}>
  <span class="BASE__track">            {/* the pill track */}
    <span class="BASE__thumb" />        {/* the sliding dot */}
  </span>
  {props.hasLabel !== false && <span class="BASE__label">{props.children || 'Label'}</span>}
</button>`,

  switch: `
/* SWITCH — same as toggle */
<button class={state.classes} role="switch" aria-checked={props.checked} disabled={props.disabled}>
  <span class="BASE__track"><span class="BASE__thumb" /></span>
  {props.hasLabel !== false && <span class="BASE__label">{props.children || 'Label'}</span>}
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
    <span class="BASE__helper">{props.helperText || 'Helper text'}</span>
  )}
</div>`,

  textarea: `
/* TEXTAREA */
<div class={state.classes}>
  {props.label && <label class="BASE__label">{props.label}</label>}
  <textarea class="BASE__input" placeholder={props.placeholder} disabled={props.disabled} rows={props.rows || 3}>
    {props.value}
  </textarea>
  {props.hasHelperText !== false && <span class="BASE__helper">{props.helperText}</span>}
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
  <span class="BASE__label">{props.children || 'Label'}</span>
  {props.trailingIcon && <span class="BASE__trailing-icon">{props.trailingIcon}</span>}
  {props.loading && <span class="BASE__spinner" aria-hidden="true" />}
</button>`,

  'icon-button': `
/* ICON BUTTON */
<button class={state.classes} aria-label={props.label || 'action'} disabled={props.disabled}>
  <span class="BASE__icon">{props.icon || <img src="./assets/icon.svg" alt="" />}</span>
</button>`,

  link: `
/* LINK */
<a class={state.classes} href={props.href || '#'} target={props.target}>
  {props.leadingIcon && <span class="BASE__leading-icon">{props.leadingIcon}</span>}
  <span class="BASE__label">{props.children || 'Link'}</span>
</a>`,

  tab: `
/* TAB */
<button class={state.classes} role="tab" aria-selected={props.selected} disabled={props.disabled}>
  {props.icon && <span class="BASE__icon">{props.icon}</span>}
  <span class="BASE__label">{props.children || 'Tab'}</span>
  {props.badge && <span class="BASE__badge">{props.badge}</span>}
</button>`,

  'menu-item': `
/* MENU ITEM */
<li class={state.classes} role="menuitem">
  {props.leadingIcon && <span class="BASE__leading-icon">{props.leadingIcon}</span>}
  <span class="BASE__label">{props.children || 'Item'}</span>
  {props.trailingIcon && <span class="BASE__trailing-icon">{props.trailingIcon}</span>}
</li>`,

  badge: `
/* BADGE */
<span class={state.classes}>{props.children || props.count || '1'}</span>`,

  chip: `
/* CHIP */
<div class={state.classes} role="option" aria-selected={props.selected}>
  {props.leadingIcon && <span class="BASE__leading-icon">{props.leadingIcon}</span>}
  <span class="BASE__label">{props.children || 'Chip'}</span>
  {props.onRemove && <button class="BASE__remove" aria-label="remove">×</button>}
</div>`,

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
      rules.push(`MUST contain a real <textarea class="${baseClass}__input"> — not a div with contenteditable.`);
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
  const structure  = describeVariantStructure(data, assetMap);
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

  return {
    componentName, baseClass, elementType, ariaRole, componentCategory,
    axes, props, structure, classNaming, stateInfo,
    cssTokens, themeModes,
    semanticBlueprint, categorySemanticRules,
    assets,
  };
}

/**
 * Builds the full user prompt sent to the LLM.
 */
export function buildComponentSetUserPrompt(
  promptData: VariantPromptData,
  defaultVariantYaml?: string,
  componentSetData?: ComponentSetData,
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

  // ── Conditional assets ───────────────────────────────────────────────────
  if (promptData.assets && promptData.assets.length > 0) {
    const conditionalAssets = promptData.assets.filter(
      (a) => a.variants && a.variants.length > 0,
    );

    if (conditionalAssets.length > 0) {
      const totalVariants = componentSetData?.variants.length ?? 0;
      const conditional   = conditionalAssets.filter(
        (a) => (a.variants?.length ?? 0) < totalVariants,
      );

      if (conditional.length > 0) {
        lines.push('### Icon / Asset Conditional Rendering');
        lines.push('Some icons only appear in specific variants or states:');
        lines.push('');

        for (const asset of conditional) {
          const appearsIn  = asset.variants?.length ?? 0;
          const assetLabel = asset.filename.replace('.svg', '').replace(/-/g, ' ');
          lines.push(`**${assetLabel}** (\`${asset.filename}\`):`);

          const names = asset.variants ?? [];
          const onlyLoading  = names.every((v) => v.toLowerCase().includes('loading'));
          if (onlyLoading) {
            lines.push(`  - Only appears in LOADING state`);
            lines.push(`  - Use: \`{props.loading && <img src="./assets/${asset.filename}" />}\``);
          } else if (names.length <= 6) {
            lines.push(`  - Only in: ${names.join(', ')}`);
          } else {
            lines.push(`  - Appears in ${appearsIn}/${totalVariants} variants`);
          }

          if (asset.isColorVariant) {
            lines.push(`  - ✓ Uses \`currentColor\` — recolorable via CSS`);
          }
          lines.push('');
        }
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
        if (cs.booleanCondition) parts.push(`data-${cs.booleanCondition}`);
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
        lines.push('  → Use: `{props.iconName || <img src="./assets/default.svg" />}`');
        lines.push('');
      }

      if (hasTextProps) {
        lines.push('**Text Content (TEXT)** — expose as `string` props:');
        for (const p of componentSetData.textContentProperties) {
          lines.push(`- \`${toCamelCase(p.name)}\`: default \`"${p.defaultValue}"\``);
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
      `add \`data-{name}={true|undefined}\` to root when true`,
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
    reqs.push('For icon slot props, use: `{props.iconName || <img src="./assets/default.svg" alt="" />}`');
  }

  reqs.push('Use string concatenation (not template literals) for building the class string');

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
 */
export function buildComponentSetSystemPrompt(): string {
  return `You are a Mitosis component generator. You receive a Figma component set description. Your job is to generate correct, semantic, accessible HTML — NOT a div-for-every-frame recreation of the Figma layer tree.

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
| chip       | \`<div role="option">\` | \`<span>\` for label, \`<button>\` for remove          |
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
5.  Import only \`useStore\` from '@builder.io/mitosis'
6.  Use string concatenation with \`+\` — no template literals
7.  Access props directly (e.g. \`props.variant\`) — do NOT destructure
8.  For text content: \`{props.children || 'Fallback'}\`
9.  For boolean props (error, filled, etc.): add \`data-{name}={true || undefined}\` to root
10. CRITICAL: When structure says "render as: <img src='…'>" — use EXACTLY that \`<img>\`, no div/svg
11. CRITICAL: BOOLEAN default TRUE  → \`{props.name !== false ? <el /> : null}\`
12. CRITICAL: BOOLEAN default FALSE → \`{props.name ? <el /> : null}\`
13. Do NOT hardcode colors listed as CSS tokens

## Class-Building Pattern
\`\`\`tsx
import { useStore } from '@builder.io/mitosis';

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
      {props.hasLabel !== false && (
        <span class="checkbox-field__label">{props.children || 'Label'}</span>
      )}
      {props.hasDescription !== false && (
        <span class="checkbox-field__description">{props.description || 'Description'}</span>
      )}
    </label>
  );
}
\`\`\`

Respond with ONLY the .lite.tsx code. No markdown fences, no explanation.
Start directly with the import statement.`;
}