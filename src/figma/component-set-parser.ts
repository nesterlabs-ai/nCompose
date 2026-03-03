/**
 * ============================================================================
 * UNIVERSAL FIGMA COMPONENT PARSER
 * ============================================================================
 *
 * A complete, production-grade parser for ANY Figma component type.
 * Handles the full Figma REST API surface area:
 *
 * NODE TYPES:  FRAME, GROUP, COMPONENT, COMPONENT_SET, INSTANCE,
 *              VECTOR, BOOLEAN_OPERATION, STAR, LINE, ELLIPSE,
 *              REGULAR_POLYGON, RECTANGLE, TEXT, SLICE, TABLE, TABLE_CELL
 *
 * FILLS:       SOLID, GRADIENT_LINEAR, GRADIENT_RADIAL,
 *              GRADIENT_ANGULAR, GRADIENT_DIAMOND, IMAGE, VIDEO
 *
 * LAYOUT:      Auto-layout (H/V), CSS Grid, Absolute positioning,
 *              Constraints, HUG/FILL/FIXED sizing, Wrap layouts,
 *              min/max width & height, aspect-ratio locks,
 *              fixed-on-scroll / sticky positioning, layout grids
 *
 * TYPOGRAPHY:  fontFamily, fontWeight, fontSize, lineHeight,
 *              letterSpacing, textDecoration, textTransform (textCase),
 *              textAlign (H+V), paragraphSpacing, paragraphIndent,
 *              textTruncation, maxLines, textAutoResize,
 *              inline style ranges (mixed fonts/colors per character),
 *              OpenType feature flags, list styles, small-caps
 *
 * VARIABLES:   Figma design tokens via boundVariables,
 *              resolvedVariableValues, variable collections → CSS vars,
 *              variable modes (themes / dark-mode), alias resolution,
 *              variable scopes (color, spacing, opacity, etc.)
 *
 * VECTOR:      Raw SVG path data reference, stroke caps/joins,
 *              miter limits, vector network metadata
 *
 * IMAGES:      Image scale mode (FILL/FIT/TILE/STRETCH),
 *              transform matrices, visibility flags
 *
 * EFFECTS:     DROP_SHADOW, INNER_SHADOW, LAYER_BLUR, BACKGROUND_BLUR,
 *              shadow spread radius
 *
 * STROKES:     Per-side weights, strokeAlign (center/inside/outside),
 *              dashed/dotted dash patterns, multiple strokes
 *
 * BORDERS:     cornerRadius uniform + per-corner, cornerSmoothing (squircle)
 *
 * INSTANCES:   componentProperties, overrides, mainComponent resolution
 *
 * STATES:      Simple, compound (e.g. "Error-Hover"), triple-compound,
 *              multiple state axes, all common Figma naming patterns
 *
 * CSS OUTPUT:  diff-based rules, deduplication, @layer, focus-visible,
 *              CSS custom properties passthrough, source comments,
 *              transition hints, cursor heuristics, blend modes,
 *              inside-stroke box-shadow trick, flex/grid child properties
 * ============================================================================
 */

import { config } from '../config.js';

// ============================================================================
// SECTION 1: TYPES & INTERFACES
// ============================================================================

export interface VariantAxis {
  name: string;
  values: string[];
}

export interface VariantStyles {
  container: Record<string, string>;
  text: Record<string, string>;
  children: Record<string, Record<string, string>>;
}

export interface VariantEntry {
  props: Record<string, string>;
  styles: VariantStyles;
}

export interface ClassifiedState {
  booleanCondition: string | null;
  cssSelector: string;
  originalValue: string;
}

export interface ResolvedVariable {
  id: string;
  name: string;
  resolvedType: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
  value: string | number | boolean;
  cssVarName: string;
  /** Variable collection name (e.g. "Primitives", "Semantics") */
  collectionName?: string;
  /** Available mode names for this variable (e.g. ["Light", "Dark"]) */
  modes?: string[];
  /** Scopes this variable is valid for (e.g. ["ALL_FILLS", "STROKE_COLOR"]) */
  scopes?: string[];
}

/** Per-mode resolved value for a single variable */
export interface VariableMode {
  modeId: string;
  modeName: string;
  value: string;
}

/** Inline text style run — one segment of a mixed-style text node */
export interface InlineTextRun {
  characters: string;
  css: Record<string, string>;
}

/** Vector rendering metadata */
export interface VectorInfo {
  nodeId: string;
  /** SVG path data string(s), if provided by the API */
  svgPaths?: string[];
  strokeCap: string;
  strokeJoin: string;
  miterAngle?: number;
  fillRule?: string;
}

export interface ChildLayerInfo {
  key: string;
  originalName: string;
  nodeType: string;
  /** Figma node ID (e.g. "3958:25101") — used for asset map lookups */
  nodeId?: string;
  css: Record<string, string>;
  isIcon: boolean;
  isText: boolean;
  isImage: boolean;
  depth: number;
  /** Inline mixed-style text runs (only for TEXT nodes with styleOverrides) */
  inlineRuns?: InlineTextRun[];
  /** Vector metadata (only for VECTOR-family nodes) */
  vectorInfo?: VectorInfo;
  /** Image scale mode for RECTANGLE with IMAGE fill */
  imageScaleMode?: 'FILL' | 'FIT' | 'TILE' | 'STRETCH' | 'CROP';
  /** Text content (only for TEXT nodes) */
  characters?: string;
}

export interface IconSlotProperty {
  name: string;
  type: 'INSTANCE_SWAP';
  defaultValue: string;
  preferredValues?: any[];
}

export interface TextContentProperty {
  name: string;
  type: 'TEXT';
  defaultValue: string;
}

export interface BooleanVisibilityProperty {
  name: string;
  type: 'BOOLEAN';
  defaultValue: boolean;
}

export type ComponentCategory =
  | 'button' | 'icon-button' | 'input' | 'textarea' | 'select'
  | 'checkbox' | 'radio' | 'toggle' | 'switch'
  | 'badge' | 'chip' | 'tag' | 'label'
  | 'avatar' | 'card' | 'dialog' | 'modal' | 'drawer'
  | 'tooltip' | 'popover' | 'toast' | 'alert' | 'banner'
  | 'tab' | 'tab-panel' | 'menu' | 'menu-item' | 'dropdown'
  | 'icon' | 'spinner' | 'progress' | 'skeleton'
  | 'slider' | 'stepper' | 'pagination'
  | 'table' | 'list' | 'list-item'
  | 'accordion' | 'breadcrumb' | 'divider' | 'link'
  | 'navigation' | 'sidebar' | 'header' | 'footer'
  | 'unknown';

export interface ComponentSetData {
  name: string;
  nodeId: string;
  axes: VariantAxis[];
  propAxes: VariantAxis[];
  stateAxis: VariantAxis | null;
  stateAxes: VariantAxis[];
  classifiedStates: ClassifiedState[];
  booleanProps: string[];
  variants: VariantEntry[];
  defaultVariant: VariantEntry;
  defaultVariantNode: any;
  componentPropertyDefinitions: Record<string, any>;
  iconSlotProperties: IconSlotProperty[];
  textContentProperties: TextContentProperty[];
  booleanVisibilityProperties: BooleanVisibilityProperty[];
  resolvedVariables: Record<string, ResolvedVariable>;
  /** Per-mode CSS variable blocks for theming (e.g. dark mode) */
  variableModesCSS: Record<string, string>;
  cssTokensReferenced: string[];
  childLayers: ChildLayerInfo[];
  isInteractive: boolean;
  componentCategory: ComponentCategory;
  suggestedHtmlTag: string;
  suggestedAriaRole: string;
}

export interface BuildVariantCSSOptions {
  sourceComments?: boolean;
  deduplicateRules?: boolean;
  emitFocusReset?: boolean;
  cssLayer?: string;
  emitTokens?: boolean;
  maxDepth?: number;
  preserveExactDimensions?: boolean;
  injectBehavioralStyles?: boolean;
}

// ============================================================================
// SECTION 2: STATE CLASSIFICATION TABLES
// ============================================================================

const KNOWN_STATE_SELECTORS: Record<string, string> = {
  'default':     '',
  'rest':        '',
  'resting':     '',
  'normal':      '',
  'idle':        '',
  'base':        '',
  'enabled':     '',
  'hover':       ':hover:not([disabled])',
  'hovered':     ':hover:not([disabled])',
  'focus':       ':focus-visible',
  'focused':     ':focus-visible',
  'active':      ':active:not([disabled])',
  'pressed':     ':active:not([disabled])',
  'disabled':    '[disabled]',
  'visited':     ':visited',
  'placeholder': '::placeholder',
};

// NOTE: data-attribute names MUST match the booleanCondition key exactly,
// because the LLM prompt tells the LLM to use `data-{booleanCondition}`.
// If the CSS selector doesn't match → state styles never apply.
const KNOWN_BOOLEAN_STATES: Record<string, string> = {
  'loading':        '[data-loading]',
  'focus-within':   ':focus-within',
  'checked':        '[data-checked]',
  'unchecked':      '[data-unchecked]',
  'selected':       '[data-selected]',
  'unselected':     '[data-unselected]',
  'filled':         '[data-filled]',
  'filled-in':      '[data-filled-in]',
  'filledin':       '[data-filled-in]',
  'typing':         '[data-typing]',
  'error':          '[data-error]',
  'invalid':        '[data-invalid]',
  'valid':          '[data-valid]',
  'success':        '[data-success]',
  'warning':        '[data-warning]',
  'info':           '[data-info]',
  'readonly':       '[readonly]',
  'read-only':      '[readonly]',
  'required':       '[data-required]',
  'optional':       '[data-optional]',
  'open':           '[data-open]',
  'closed':         '[data-closed]',
  'expanded':       '[data-expanded]',
  'collapsed':      '[data-collapsed]',
  'on':             '[data-on]',
  'off':            '[data-off]',
  'indeterminate':  '[data-indeterminate]',
  'current':        '[aria-current="page"]',
  'empty':          '[data-empty]',
  'dragging':       '[data-dragging]',
  'dropping':       '[data-dropping]',
  'resizing':       '[data-resizing]',
  'highlighted':    '[data-highlighted]',
  'active-bool':    '[data-active]',
};

const STATE_KEYWORDS = [
  'default', 'hover', 'hovered', 'focus', 'focused', 'disabled',
  'loading', 'active', 'pressed', 'rest', 'resting', 'normal',
  'idle', 'selected', 'checked', 'enabled', 'base',
];

// ============================================================================
// SECTION 3: STATE CLASSIFICATION
// ============================================================================

export function classifyStateValue(value: string): ClassifiedState {
  const normalized = value.toLowerCase().trim();

  const compound = splitCompoundState(normalized);
  if (compound) {
    const [pfx, sfx] = compound;
    const sfxTrimmed = sfx.trim();
    const pfxTrimmed = pfx.trim();

    if (sfxTrimmed in KNOWN_STATE_SELECTORS) {
      return {
        booleanCondition: toBooleanPropName(pfxTrimmed),
        cssSelector: KNOWN_STATE_SELECTORS[sfxTrimmed],
        originalValue: value,
      };
    }

    const sfxKebab = sfxTrimmed.replace(/\s+/g, '-');
    if (sfxTrimmed in KNOWN_BOOLEAN_STATES || sfxKebab in KNOWN_BOOLEAN_STATES) {
      return {
        booleanCondition: toBooleanPropName(pfxTrimmed),
        cssSelector: KNOWN_BOOLEAN_STATES[sfxTrimmed] ?? KNOWN_BOOLEAN_STATES[sfxKebab] ?? '',
        originalValue: value,
      };
    }
  }

  if (normalized in KNOWN_STATE_SELECTORS) {
    return { booleanCondition: null, cssSelector: KNOWN_STATE_SELECTORS[normalized], originalValue: value };
  }

  if (normalized in KNOWN_BOOLEAN_STATES) {
    return { booleanCondition: toBooleanPropName(normalized), cssSelector: '', originalValue: value };
  }

  const asKebab = normalized.replace(/\s+/g, '-');
  if (asKebab in KNOWN_BOOLEAN_STATES) {
    return { booleanCondition: toBooleanPropName(normalized), cssSelector: '', originalValue: value };
  }

  return { booleanCondition: toBooleanPropName(normalized), cssSelector: '', originalValue: value };
}

function splitCompoundState(normalized: string): [string, string] | null {
  const sdIdx = normalized.indexOf(' - ');
  if (sdIdx > 0) return [normalized.slice(0, sdIdx), normalized.slice(sdIdx + 3)];

  const dIdx = normalized.indexOf('-');
  if (dIdx > 0) {
    const prefix = normalized.slice(0, dIdx);
    const suffix = normalized.slice(dIdx + 1);
    if (suffix.trim() in KNOWN_STATE_SELECTORS) return [prefix, suffix];
  }
  return null;
}

function toBooleanPropName(stateValue: string): string {
  const parts = stateValue.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return parts[0] + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

// ============================================================================
// SECTION 4: AXIS IDENTIFICATION
// ============================================================================

function identifyStateAxes(axes: VariantAxis[]): VariantAxis[] {
  const result: VariantAxis[] = [];
  const exact = axes.find((a) => a.name.toLowerCase() === 'state');
  if (exact) result.push(exact);

  for (const axis of axes) {
    if (result.includes(axis)) continue;
    const lowered = axis.values.map((v) => v.toLowerCase());
    const hits = STATE_KEYWORDS.filter((kw) => lowered.some((v) => v === kw || v.includes(kw)));
    if (hits.length >= 2) result.push(axis);
  }
  return result;
}

// ============================================================================
// SECTION 5: COMPONENT CATEGORY DETECTION
// ============================================================================

const CATEGORY_PATTERNS: Array<[RegExp, ComponentCategory]> = [
  [/\bicon[-\s]?button\b/, 'icon-button'],
  [/\bbutton\b|\bbtn\b|\bcta\b/, 'button'],
  [/\btextarea\b|\btext[-\s]?area\b/, 'textarea'],
  [/\binput\b|\btext[-\s]?field\b|\btext[-\s]?box\b/, 'input'],
  [/\bcombobox\b|\bautocomplete\b/, 'select'],
  [/\bselect\b|\bdropdown\b/, 'select'],
  [/\bcheckbox\b/, 'checkbox'],
  [/\bradio\b/, 'radio'],
  [/\btoggle\b|\bswitch\b/, 'toggle'],
  [/\bbadge\b/, 'badge'],
  [/\bchip\b/, 'chip'],
  [/\btag\b/, 'tag'],
  [/\blabel\b/, 'label'],
  [/\bavatar\b/, 'avatar'],
  [/\bdrawer\b|\bsheet\b/, 'drawer'],
  [/\bdialog\b|\bmodal\b/, 'dialog'],
  [/\bcard\b/, 'card'],
  [/\btoast\b|\bsnackbar\b/, 'toast'],
  [/\balert\b|\bbanner\b/, 'alert'],
  [/\btooltip\b/, 'tooltip'],
  [/\bpopover\b|\bdropdown[-\s]?menu\b/, 'popover'],
  [/\btab[-\s]?panel\b/, 'tab-panel'],
  [/\btab\b/, 'tab'],
  [/\bmenu[-\s]?item\b/, 'menu-item'],
  [/\bmenu\b/, 'menu'],
  [/\baccordion\b/, 'accordion'],
  [/\bbreadcrumb\b/, 'breadcrumb'],
  [/\bdivider\b|\bseparator\b/, 'divider'],
  [/\blink\b|\banchor\b/, 'link'],
  [/\bpagination\b/, 'pagination'],
  [/\bstepper\b/, 'stepper'],
  [/\bslider\b|\brange\b/, 'slider'],
  [/\bprogress\b/, 'progress'],
  [/\bskeleton\b/, 'skeleton'],
  [/\bspinner\b|\bloading[-\s]?indicator\b/, 'spinner'],
  [/\bicon\b/, 'icon'],
  [/\btable[-\s]?cell\b|\btd\b/, 'table'],
  [/\btable\b|\bdata[-\s]?grid\b/, 'table'],
  [/\blist[-\s]?item\b/, 'list-item'],
  [/\blist\b/, 'list'],
  [/\bnavigation\b|\bnav\b/, 'navigation'],
  [/\bsidebar\b/, 'sidebar'],
  [/\bheader\b/, 'header'],
  [/\bfooter\b/, 'footer'],
];

export const CATEGORY_HTML_TAGS: Record<ComponentCategory, string> = {
  'button': 'button', 'icon-button': 'button', 'input': 'div', 'textarea': 'div',
  'select': 'div', 'checkbox': 'label', 'radio': 'label', 'toggle': 'button', 'switch': 'button',
  'badge': 'span', 'chip': 'div', 'tag': 'span', 'label': 'label', 'avatar': 'div',
  'card': 'article', 'dialog': 'dialog', 'modal': 'dialog', 'drawer': 'aside',
  'tooltip': 'div', 'popover': 'div', 'toast': 'div', 'alert': 'div', 'banner': 'div',
  'tab': 'button', 'tab-panel': 'div', 'menu': 'ul', 'menu-item': 'li', 'dropdown': 'div',
  'icon': 'span', 'spinner': 'div', 'progress': 'div', 'skeleton': 'div',
  'slider': 'div', 'stepper': 'div', 'pagination': 'nav',
  'table': 'table', 'list': 'ul', 'list-item': 'li',
  'accordion': 'div', 'breadcrumb': 'nav', 'divider': 'hr', 'link': 'a',
  'navigation': 'nav', 'sidebar': 'aside', 'header': 'header', 'footer': 'footer',
  'unknown': 'div',
};

export const CATEGORY_ARIA_ROLES: Record<ComponentCategory, string> = {
  'button': 'button', 'icon-button': 'button', 'input': '', 'textarea': '',
  'select': '', 'checkbox': 'checkbox', 'radio': 'radio', 'toggle': 'switch', 'switch': 'switch',
  'badge': 'status', 'chip': 'option', 'tag': 'listitem', 'label': '', 'avatar': 'img',
  'card': 'article', 'dialog': 'dialog', 'modal': 'dialog', 'drawer': 'dialog',
  'tooltip': 'tooltip', 'popover': 'dialog', 'toast': 'alert', 'alert': 'alert', 'banner': 'banner',
  'tab': 'tab', 'tab-panel': 'tabpanel', 'menu': 'menu', 'menu-item': 'menuitem', 'dropdown': 'listbox',
  'icon': 'img', 'spinner': 'progressbar', 'progress': 'progressbar', 'skeleton': 'progressbar',
  'slider': 'slider', 'stepper': 'group', 'pagination': 'navigation',
  'table': 'table', 'list': 'list', 'list-item': 'listitem',
  'accordion': 'region', 'breadcrumb': 'navigation', 'divider': 'separator', 'link': 'link',
  'navigation': 'navigation', 'sidebar': 'complementary', 'header': 'banner', 'footer': 'contentinfo',
  'unknown': '',
};

const INTERACTIVE_CATEGORIES = new Set<ComponentCategory>([
  'button', 'icon-button', 'input', 'textarea', 'select', 'checkbox', 'radio',
  'toggle', 'switch', 'chip', 'tab', 'menu-item', 'slider', 'link', 'accordion',
]);

export function detectComponentCategory(name: string): ComponentCategory {
  const n = name.toLowerCase();
  for (const [pattern, cat] of CATEGORY_PATTERNS) {
    if (pattern.test(n)) return cat;
  }
  return 'unknown';
}

/**
 * Enhanced category detection that also analyzes variant axes and child structure.
 * Falls back to detectComponentCategory(name) if no signals are found.
 *
 * This allows components named "FormControl" or "SelectionField" to still be
 * correctly categorised as checkbox/radio/toggle based on their Figma properties.
 */
function detectComponentCategoryEnhanced(
  name: string,
  axes: VariantAxis[],
  childNames: string[],
): ComponentCategory {
  // First try name-based detection
  const fromName = detectComponentCategory(name);
  if (fromName !== 'unknown') return fromName;

  // Analyze variant axis values for component type signals
  const allAxisValues = axes.flatMap((a) =>
    a.values.map((v) => v.toLowerCase()),
  );
  const allAxisNames = axes.map((a) => a.name.toLowerCase());

  // Checkbox signals: axis values like "checked", "unchecked", "indeterminate"
  const checkboxSignals = ['checked', 'unchecked', 'indeterminate'];
  const hasCheckboxValues = checkboxSignals.filter((s) => allAxisValues.includes(s)).length >= 2;
  if (hasCheckboxValues) {
    // Distinguish radio from checkbox: radio has no indeterminate
    if (allAxisValues.includes('indeterminate')) return 'checkbox';
    // If axis is named "value type" or "checked", likely checkbox
    if (allAxisNames.some((n) => /value\s*type|check/.test(n))) return 'checkbox';
    return 'checkbox';
  }

  // Radio signals: "selected"/"unselected" without "indeterminate"
  if (allAxisValues.includes('selected') && allAxisValues.includes('unselected') &&
      !allAxisValues.includes('indeterminate')) {
    return 'radio';
  }

  // Toggle/switch signals: "on"/"off" axis values
  if (allAxisValues.includes('on') && allAxisValues.includes('off')) return 'toggle';

  // Button signals: axis named "style"/"type" with values like "primary", "secondary"
  const styleAxis = axes.find((a) => /^(style|type|variant)$/i.test(a.name));
  const buttonStyleValues = ['primary', 'secondary', 'tertiary', 'outlined', 'ghost', 'destructive', 'danger'];
  if (styleAxis) {
    const lowerVals = styleAxis.values.map((v) => v.toLowerCase());
    const matchCount = lowerVals.filter((v) => buttonStyleValues.includes(v)).length;
    if (matchCount >= 2) return 'button';
  }

  // Input signals: axis values like "filled", "typing", "placeholder"
  const inputSignals = ['filled', 'typing', 'placeholder', 'empty'];
  if (inputSignals.filter((s) => allAxisValues.includes(s)).length >= 2) return 'input';

  // Analyze child node names for semantic hints
  const childNamesLower = childNames.map((c) => c.toLowerCase());
  const childHints: Array<[RegExp, ComponentCategory]> = [
    [/checkbox|check[-\s]?box|check[-\s]?mark/, 'checkbox'],
    [/radio|radio[-\s]?button/, 'radio'],
    [/toggle|switch|thumb|track/, 'toggle'],
    [/\binput\b|text[-\s]?field/, 'input'],
    [/\bslider\b|range|track.*thumb/, 'slider'],
  ];
  for (const [pattern, cat] of childHints) {
    if (childNamesLower.some((c) => pattern.test(c))) return cat;
  }

  return 'unknown';
}

// ============================================================================
// SECTION 6: FIGMA DESIGN VARIABLES (TOKENS)
// ============================================================================

function resolveDesignVariables(completeDesign: any): Record<string, ResolvedVariable> {
  const variables: Record<string, ResolvedVariable> = {};

  const varDefs     = completeDesign?.variables ?? completeDesign?.localVariables ?? {};
  const collections = completeDesign?.variableCollections ?? completeDesign?.localVariableCollections ?? {};

  for (const [id, varDef] of Object.entries(varDefs) as [string, any][]) {
    if (!varDef) continue;

    const name         = varDef.name ?? id;
    const resolvedType = varDef.resolvedType ?? varDef.type ?? 'STRING';
    const collection   = collections[varDef.variableCollectionId];
    const defaultMode  = collection?.defaultModeId ?? collection?.modes?.[0]?.modeId;
    const modes        = collection?.modes?.map((m: any) => m.name) ?? [];

    // Resolve value — walk alias chain
    let rawValue: any = varDef.value;
    if (defaultMode && varDef.valuesByMode?.[defaultMode] !== undefined) {
      rawValue = varDef.valuesByMode[defaultMode];
    }

    // Dereference VARIABLE_ALIAS
    let cssValue = '';
    if (rawValue && typeof rawValue === 'object' && rawValue.type === 'VARIABLE_ALIAS') {
      const aliasId  = rawValue.id;
      const aliasVar = varDefs[aliasId];
      if (aliasVar) {
        const aliasMode = aliasVar.valuesByMode?.[defaultMode] ?? aliasVar.value;
        rawValue = aliasMode;
      }
    }

    if (resolvedType === 'COLOR' && rawValue && typeof rawValue === 'object' && 'r' in rawValue) {
      cssValue = figmaColorToCSS(rawValue);
    } else if (resolvedType === 'FLOAT') {
      cssValue = String(rawValue ?? 0);
    } else {
      cssValue = String(rawValue ?? '');
    }

    const cssVarName = '--' + name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/\//g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    variables[id] = {
      id, name, resolvedType, value: cssValue, cssVarName,
      collectionName: collection?.name,
      modes,
      scopes: varDef.scopes ?? [],
    };
  }

  return variables;
}

/**
 * Builds per-mode CSS variable override blocks for theming.
 * Returns a map of modeName → CSS string (e.g. "Dark" → "[data-theme='dark'] { --color: #000; }")
 */
function buildVariableModesCSS(
  completeDesign: any,
  variables: Record<string, ResolvedVariable>,
): Record<string, string> {
  const modeBlocks: Record<string, string> = {};

  const varDefs     = completeDesign?.variables ?? completeDesign?.localVariables ?? {};
  const collections = completeDesign?.variableCollections ?? completeDesign?.localVariableCollections ?? {};

  // Gather all modes across all collections
  const allModes = new Map<string, string>(); // modeId → modeName
  for (const col of Object.values(collections) as any[]) {
    for (const mode of col.modes ?? []) {
      if (!allModes.has(mode.modeId)) allModes.set(mode.modeId, mode.name);
    }
  }

  for (const [modeId, modeName] of allModes) {
    const props: string[] = [];

    for (const [id, varDef] of Object.entries(varDefs) as [string, any][]) {
      const v = variables[id];
      if (!v) continue;

      let rawValue = varDef.valuesByMode?.[modeId];
      if (rawValue === undefined) continue;

      // Dereference alias
      if (rawValue && typeof rawValue === 'object' && rawValue.type === 'VARIABLE_ALIAS') {
        const alias = varDefs[rawValue.id];
        if (alias) rawValue = alias.valuesByMode?.[modeId] ?? alias.value;
      }

      let cssVal: string;
      if (v.resolvedType === 'COLOR' && rawValue && typeof rawValue === 'object' && 'r' in rawValue) {
        cssVal = figmaColorToCSS(rawValue);
      } else if (v.resolvedType === 'FLOAT') {
        cssVal = String(rawValue ?? 0);
      } else {
        cssVal = String(rawValue ?? '');
      }

      props.push(`  ${v.cssVarName}: ${cssVal}; /* ${v.name} */`);
    }

    if (props.length > 0) {
      const selector = modeName.toLowerCase() === 'dark'
        ? `[data-theme="dark"], @media (prefers-color-scheme: dark) { :root`
        : `[data-theme="${modeName.toLowerCase()}"]`;
      modeBlocks[modeName] = `${selector} {\n${props.join('\n')}\n}`;
    }
  }

  return modeBlocks;
}

function resolveBoundVariable(ref: any, variables: Record<string, ResolvedVariable>): string | null {
  if (!ref) return null;
  const id = ref.id ?? ref;
  if (!id) return null;
  const v = variables[String(id)];
  return v ? `var(${v.cssVarName})` : null;
}

function tryBoundVariable(
  node: any,
  prop: string,
  variables: Record<string, ResolvedVariable>,
): string | null {
  if (!node?.boundVariables) return null;
  const binding = node.boundVariables[prop];
  if (!binding) return null;
  if (Array.isArray(binding)) return binding.length > 0 ? resolveBoundVariable(binding[0], variables) : null;
  return resolveBoundVariable(binding, variables);
}

function figmaColorToCSS(c: { r: number; g: number; b: number; a?: number }): string {
  const { r, g, b, a = 1 } = c;
  const alpha = parseFloat(a.toFixed(3));
  return alpha >= 0.999 ? rgbToHex(r, g, b)
    : `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
}

// ============================================================================
// SECTION 7: DEFAULT VARIANT SELECTION
// ============================================================================

const DEFAULT_STATE_NAMES = ['default', 'rest', 'resting', 'normal', 'idle', 'enabled', 'base'];

function findDefaultVariant(
  variants: VariantEntry[],
  axes: VariantAxis[],
  stateAxis: VariantAxis | null,
): VariantEntry {
  const defaultStateName = stateAxis
    ? (stateAxis.values.find((v) => DEFAULT_STATE_NAMES.includes(v.toLowerCase())) ?? stateAxis.values[0])
    : undefined;

  const preferred: Record<string, string> = {};
  for (const axis of axes) {
    if (stateAxis && axis.name === stateAxis.name) {
      if (defaultStateName) preferred[axis.name] = defaultStateName;
    } else {
      preferred[axis.name] = axis.values[0];
    }
  }

  const exact = variants.find((v) =>
    Object.entries(preferred).every(([k, val]) => v.props[k] === val),
  );
  if (exact) return exact;

  if (stateAxis && defaultStateName) {
    const fallback = variants.find((v) => v.props[stateAxis.name] === defaultStateName);
    if (fallback) return fallback;
  }
  return variants[0];
}

// ============================================================================
// SECTION 8: MAIN PARSER
// ============================================================================

export function parseComponentSet(completeDesign: any): ComponentSetData | null {
  if (!completeDesign) return null;

  const nodes: any[] = completeDesign.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) return null;

  const rootNode = nodes[0];
  if (!rootNode || rootNode.type !== 'COMPONENT_SET') return null;

  const children: any[] = rootNode.children ?? [];
  if (children.length === 0) return null;

  // Resolve design variables
  const resolvedVariables = resolveDesignVariables(completeDesign);
  const variableModesCSS  = buildVariableModesCSS(completeDesign, resolvedVariables);

  // Merge globalVars (Framelink format)
  const globalStyles: Record<string, any> = {
    ...(completeDesign?.globalVars?.layouts ?? {}),
    ...(completeDesign?.globalVars?.textStyles ?? {}),
    ...(completeDesign?.globalVars?.fills ?? {}),
    ...(completeDesign?.globalVars?.strokes ?? {}),
    ...(completeDesign?.globalVars?.effects ?? {}),
  };

  // Parse variants
  const axisMap = new Map<string, Set<string>>();
  const variants: VariantEntry[] = [];

  for (const child of children) {
    const props = parseVariantName(child.name) ?? parseVariantProperties(child);
    if (!props) continue;

    for (const [key, value] of Object.entries(props)) {
      if (!axisMap.has(key)) axisMap.set(key, new Set());
      axisMap.get(key)!.add(value);
    }

    variants.push({ props, styles: resolveVariantStyles(child, globalStyles, resolvedVariables) });
  }

  if (variants.length === 0) return null;

  const axes: VariantAxis[] = [...axisMap.entries()].map(([name, values]) => ({ name, values: [...values] }));
  const stateAxes  = identifyStateAxes(axes);
  const stateAxis  = stateAxes[0] ?? null;
  const propAxes   = axes.filter((a) => !stateAxes.includes(a));

  const classifiedStates = stateAxis ? stateAxis.values.map(classifyStateValue) : [];

  const booleanPropsSet = new Set<string>();
  for (const cs of classifiedStates) {
    if (cs.booleanCondition) booleanPropsSet.add(cs.booleanCondition);
    const ov = cs.originalValue.toLowerCase();
    if (!cs.booleanCondition && ['disabled', 'loading'].includes(ov)) booleanPropsSet.add(ov);
  }

  const defaultVariant = findDefaultVariant(variants, axes, stateAxis);
  const defaultVariantNode = children.find((c: any) => {
    const p = parseVariantName(c.name) ?? parseVariantProperties(c);
    return p && Object.entries(defaultVariant.props).every(([k, v]) => p[k] === v);
  }) ?? children[0];

  const componentPropertyDefinitions = extractComponentPropertyDefinitions(
    rootNode.componentSetId ?? rootNode.id,
    completeDesign,
  );
  const { iconSlotProperties, textContentProperties, booleanVisibilityProperties } =
    classifyComponentPropertyDefinitions(componentPropertyDefinitions);

  const childLayers = extractChildLayers(defaultVariantNode, globalStyles, resolvedVariables);

  // Enhanced detection: analyze name, variant axes, AND child node names
  const childNames = (defaultVariantNode?.children ?? []).map((c: any) => c.name ?? '');
  const componentCategory = detectComponentCategoryEnhanced(rootNode.name, axes, childNames);
  const suggestedHtmlTag  = CATEGORY_HTML_TAGS[componentCategory] ?? 'div';
  const suggestedAriaRole = CATEGORY_ARIA_ROLES[componentCategory] ?? '';
  const isInteractive     = INTERACTIVE_CATEGORIES.has(componentCategory) || stateAxis !== null;

  return {
    name:    rootNode.name,
    nodeId:  rootNode.id ?? rootNode.componentSetId ?? '',
    axes, propAxes, stateAxis, stateAxes,
    classifiedStates,
    booleanProps: [...booleanPropsSet],
    variants, defaultVariant, defaultVariantNode,
    componentPropertyDefinitions,
    iconSlotProperties, textContentProperties, booleanVisibilityProperties,
    resolvedVariables,
    variableModesCSS,
    cssTokensReferenced: collectCSSTokens(defaultVariant.styles),
    childLayers,
    isInteractive, componentCategory, suggestedHtmlTag, suggestedAriaRole,
  };
}

// ============================================================================
// SECTION 9: VARIANT NAME PARSING
// ============================================================================

function parseVariantName(name: string): Record<string, string> | null {
  if (!name?.includes('=')) return null;
  const props: Record<string, string> = {};
  for (const part of name.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k && v) props[k] = v;
  }
  return Object.keys(props).length > 0 ? props : null;
}

function parseVariantProperties(node: any): Record<string, string> | null {
  if (!node?.variantProperties || typeof node.variantProperties !== 'object') return null;
  const props: Record<string, string> = {};
  for (const [k, v] of Object.entries(node.variantProperties)) {
    props[k] = v != null ? String(v) : '';
  }
  return Object.keys(props).length > 0 ? props : null;
}

// ============================================================================
// SECTION 10: COMPONENT PROPERTY EXTRACTION
// ============================================================================

function extractComponentPropertyDefinitions(id: string, completeDesign: any): Record<string, any> {
  return completeDesign?.componentSets?.[id]?.componentPropertyDefinitions ?? {};
}

function cleanPropertyName(name: string): string {
  return name.replace(/#[\w:]+$/, '').trim();
}

function classifyComponentPropertyDefinitions(defs: Record<string, any>) {
  const iconSlotProperties:          IconSlotProperty[]          = [];
  const textContentProperties:       TextContentProperty[]       = [];
  const booleanVisibilityProperties: BooleanVisibilityProperty[] = [];

  for (const [name, def] of Object.entries(defs)) {
    const clean = cleanPropertyName(name);
    if (def.type === 'INSTANCE_SWAP') {
      iconSlotProperties.push({ name: clean, type: 'INSTANCE_SWAP', defaultValue: def.defaultValue, preferredValues: def.preferredValues });
    } else if (def.type === 'TEXT') {
      textContentProperties.push({ name: clean, type: 'TEXT', defaultValue: def.defaultValue });
    } else if (def.type === 'BOOLEAN') {
      booleanVisibilityProperties.push({ name: clean, type: 'BOOLEAN', defaultValue: def.defaultValue });
    }
  }
  return { iconSlotProperties, textContentProperties, booleanVisibilityProperties };
}

// ============================================================================
// SECTION 11: STYLE RESOLUTION
// ============================================================================

function resolveVariantStyles(
  node: any,
  globalStyles: Record<string, any>,
  variables: Record<string, ResolvedVariable>,
): VariantStyles {
  const container = resolveNodeCSS(node, globalStyles, variables, 0);
  const children: Record<string, Record<string, string>> = {};

  // Backward-compat first text child
  const text: Record<string, string> = {};
  const firstText = findFirstTextNode(node);
  if (firstText) Object.assign(text, resolveTextNodeCSS(firstText, globalStyles, variables));

  if (node.children) {
    collectNamedChildStyles(node.children, globalStyles, variables, children, '', 0, 4);
  }
  return { container, text, children };
}

function collectNamedChildStyles(
  childNodes: any[],
  globalStyles: Record<string, any>,
  variables: Record<string, ResolvedVariable>,
  out: Record<string, Record<string, string>>,
  prefix: string,
  depth: number,
  maxDepth: number,
): void {
  if (depth > maxDepth) return;

  for (const child of childNodes) {
    if (!child?.name || child.name.startsWith('_')) continue;
    if (child.visible === false) continue;

    const key      = buildBemKey(prefix, toKebabCase(child.name));
    const childCSS = resolveNodeCSS(child, globalStyles, variables, depth);

    if (child.type === 'TEXT') {
      delete childCSS['background-color'];
      delete childCSS['background'];
      Object.assign(childCSS, resolveTextNodeCSS(child, globalStyles, variables));
    }

    // Small FRAME/GROUP/INSTANCE — pull icon color from nested vectors
    if (['FRAME', 'GROUP', 'INSTANCE', 'COMPONENT'].includes(child.type) && child.absoluteBoundingBox) {
      const { width, height } = child.absoluteBoundingBox;
      if (width <= 48 && height <= 48) {
        const vColor = extractVectorColorRecursive(child, variables);
        if (vColor && !childCSS['color']) childCSS['color'] = vColor;
      }
    }

    // Table node typing
    if (child.type === 'TABLE')      { childCSS['display'] = 'table'; childCSS['border-collapse'] = 'collapse'; }
    if (child.type === 'TABLE_CELL') { childCSS['display'] = 'table-cell'; }

    if (Object.keys(childCSS).length > 0) out[key] = childCSS;

    // ICON GUARD: Do NOT recurse into icon containers — their internals
    // (VECTOR paths, nested INSTANCE frames) are SVG assets rendered via
    // <img> tags, not DOM elements that need CSS rules.
    const isIconContainer = isIconKey(key) || (
      ['FRAME', 'GROUP', 'INSTANCE', 'COMPONENT'].includes(child.type) &&
      child.absoluteBoundingBox &&
      child.absoluteBoundingBox.width <= 48 &&
      child.absoluteBoundingBox.height <= 48 &&
      child.children?.every((c: any) =>
        ['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'LINE', 'ELLIPSE', 'INSTANCE', 'COMPONENT', 'FRAME', 'GROUP'].includes(c.type)
      )
    );

    // Walk into children — but skip icon internals.
    // Text labels and layout children inside non-icon containers still need CSS.
    if (child.children && !isIconContainer) {
      collectNamedChildStyles(child.children, globalStyles, variables, out, key, depth + 1, maxDepth);
    }
  }
}

function extractChildLayers(
  node: any,
  globalStyles: Record<string, any>,
  variables: Record<string, ResolvedVariable>,
): ChildLayerInfo[] {
  const layers: ChildLayerInfo[] = [];
  if (!node?.children) return layers;

  function walk(children: any[], prefix: string, depth: number) {
    if (depth > 6) return;
    for (const child of children) {
      if (!child?.name || child.name.startsWith('_')) continue;
      const key = buildBemKey(prefix, toKebabCase(child.name));
      const css = resolveNodeCSS(child, globalStyles, variables, depth);

      // Inline text runs for mixed-style TEXT nodes
      let inlineRuns: InlineTextRun[] | undefined;
      if (child.type === 'TEXT' && child.characterStyleOverrides?.length > 0) {
        inlineRuns = extractInlineTextRuns(child, globalStyles, variables);
      }

      // Vector metadata
      let vectorInfo: VectorInfo | undefined;
      if (VECTOR_NODE_TYPES.has(child.type)) {
        vectorInfo = extractVectorInfo(child);
      }

      // Image scale mode
      let imageScaleMode: ChildLayerInfo['imageScaleMode'] | undefined;
      const imageFill = child.fills?.find((f: any) => f.type === 'IMAGE');
      if (imageFill) {
        imageScaleMode = (imageFill.scaleMode ?? 'FILL') as ChildLayerInfo['imageScaleMode'];
      }

      layers.push({
        key,
        originalName: child.name,
        nodeType: child.type ?? 'UNKNOWN',
        nodeId: child.id ?? undefined,
        css,
        isIcon:  isIconKey(key) || VECTOR_NODE_TYPES.has(child.type),
        isText:  child.type === 'TEXT',
        isImage: !!imageFill,
        depth,
        inlineRuns,
        vectorInfo,
        imageScaleMode,
        characters: child.type === 'TEXT' ? (child.characters ?? undefined) : undefined,
      });
      // ICON GUARD: Stop recursion at icon containers — their SVG internals
      // (VECTOR paths, nested INSTANCE/COMPONENT frames) are exported as assets,
      // not rendered as separate DOM elements.
      const childIsIcon = isIconKey(key) || (
        ['FRAME', 'GROUP', 'INSTANCE', 'COMPONENT'].includes(child.type) &&
        child.absoluteBoundingBox &&
        child.absoluteBoundingBox.width <= 48 &&
        child.absoluteBoundingBox.height <= 48 &&
        child.children?.every((c: any) =>
          ['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'LINE', 'ELLIPSE', 'INSTANCE', 'COMPONENT', 'FRAME', 'GROUP'].includes(c.type)
        )
      );

      // Walk into non-icon children (button text, layout wrappers) but
      // skip icon internals to reduce prompt noise.
      if (child.children && !childIsIcon) walk(child.children, key, depth + 1);
    }
  }

  walk(node.children, '', 0);
  return layers;
}

// ============================================================================
// SECTION 11b: INLINE TEXT RUNS (mixed-style text)
// ============================================================================

/**
 * Extracts per-character style segments from a TEXT node that has
 * characterStyleOverrides (mixed fonts, colors, weights inside one text node).
 * Returns an array of {characters, css} runs for rich text rendering.
 */
function extractInlineTextRuns(
  node: any,
  globalStyles: Record<string, any>,
  variables: Record<string, ResolvedVariable>,
): InlineTextRun[] {
  const chars: string[]  = (node.characters ?? '').split('');
  const overrides: number[] = node.characterStyleOverrides ?? [];
  const styleTable: Record<number, any> = node.styleOverrideTable ?? {};

  if (overrides.length === 0 || chars.length === 0) return [];

  const runs: InlineTextRun[] = [];
  let currentIdx    = overrides[0];
  let runStart      = 0;
  let runChars: string[] = [];

  for (let i = 0; i <= overrides.length; i++) {
    const idx = overrides[i] ?? -1;
    if (i === overrides.length || idx !== currentIdx) {
      // Flush current run
      if (runChars.length > 0) {
        const styleObj = styleTable[currentIdx] ?? {};
        const css = resolveInlineStyle(styleObj, globalStyles, variables);
        runs.push({ characters: runChars.join(''), css });
      }
      runChars   = [];
      currentIdx = idx;
      runStart   = i;
    }
    if (i < chars.length) runChars.push(chars[i]);
  }

  return runs;
}

function resolveInlineStyle(
  style: any,
  globalStyles: Record<string, any>,
  variables: Record<string, ResolvedVariable>,
): Record<string, string> {
  const css: Record<string, string> = {};
  if (!style) return css;

  if (style.fontFamily)  css['font-family']  = `"${style.fontFamily}", sans-serif`;
  if (style.fontWeight)  css['font-weight']  = String(style.fontWeight);
  if (style.fontSize)    css['font-size']    = addUnit(style.fontSize, 'px');
  if (style.italic)      css['font-style']   = 'italic';
  if (style.textDecoration && style.textDecoration !== 'NONE') {
    css['text-decoration'] = style.textDecoration === 'UNDERLINE' ? 'underline' : 'line-through';
  }
  if (style.fills && Array.isArray(style.fills) && style.fills.length > 0) {
    const fills = extractFillsFromNode({ fills: style.fills }, variables);
    if (fills?.[0]) css['color'] = fills[0];
  }
  if (style.openTypeFeatures) {
    css['font-feature-settings'] = resolveOpenTypeFeatures(style.openTypeFeatures);
  }
  return css;
}

/**
 * Converts Figma OpenType feature flags to CSS font-feature-settings.
 * e.g. { LIGA: true, TNUM: true } → '"liga" on, "tnum" on'
 */
function resolveOpenTypeFeatures(features: Record<string, boolean>): string {
  return Object.entries(features)
    .filter(([, enabled]) => enabled)
    .map(([tag]) => `"${tag.toLowerCase()}" on`)
    .join(', ');
}

// ============================================================================
// SECTION 11c: VECTOR METADATA
// ============================================================================

function extractVectorInfo(node: any): VectorInfo {
  const paths: string[] = [];

  // fillGeometry or strokeGeometry contain SVG path data
  if (Array.isArray(node.fillGeometry)) {
    for (const geom of node.fillGeometry) {
      if (geom.path) paths.push(geom.path);
    }
  }
  if (Array.isArray(node.strokeGeometry)) {
    for (const geom of node.strokeGeometry) {
      if (geom.path && !paths.includes(geom.path)) paths.push(geom.path);
    }
  }

  return {
    nodeId:     node.id ?? '',
    svgPaths:   paths.length > 0 ? paths : undefined,
    strokeCap:  node.strokeCap  ?? 'NONE',
    strokeJoin: node.strokeJoin ?? 'MITER',
    miterAngle: node.strokeMiterAngle,
    fillRule:   node.fillGeometry?.[0]?.windingRule ?? undefined,
  };
}

// ============================================================================
// SECTION 11d: IMAGE SCALE MODE → CSS
// ============================================================================

function applyImageScaleMode(fill: any, css: Record<string, string>): void {
  const scaleMode = fill.scaleMode ?? 'FILL';
  switch (scaleMode) {
    case 'FILL':
      css['background-size']     = 'cover';
      css['background-position'] = 'center';
      css['background-repeat']   = 'no-repeat';
      break;
    case 'FIT':
      css['background-size']     = 'contain';
      css['background-position'] = 'center';
      css['background-repeat']   = 'no-repeat';
      break;
    case 'TILE':
      css['background-size']   = `${fill.scalingFactor ? fill.scalingFactor * 100 : 100}%`;
      css['background-repeat'] = 'repeat';
      break;
    case 'STRETCH':
      css['background-size']   = '100% 100%';
      css['background-repeat'] = 'no-repeat';
      break;
    case 'CROP':
      if (fill.imageTransform) {
        // imageTransform is a 2×3 affine matrix [[a,b],[c,d],[tx,ty]]
        const [[a, c], [b, d], [tx, ty]] = fill.imageTransform;
        css['background-size']     = 'cover';
        css['background-position'] = `${Math.round(tx * 100)}% ${Math.round(ty * 100)}%`;
        css['background-repeat']   = 'no-repeat';
        // Represent scale via background-size approximation
        if (a !== 0) css['background-size'] = `${Math.abs(Math.round(1 / a * 100))}%`;
      } else {
        css['background-size']     = 'cover';
        css['background-position'] = 'center';
        css['background-repeat']   = 'no-repeat';
      }
      break;
  }
}

// ============================================================================
// SECTION 12: TYPOGRAPHY
// ============================================================================

function resolveTextNodeCSS(
  node: any,
  globalStyles: Record<string, any>,
  variables: Record<string, ResolvedVariable>,
): Record<string, string> {
  const css: Record<string, string> = {};

  // Detect CSS-format objects (kebab-case keys from buildSimplifiedTextStyle)
  const rawTs = globalStyles[node.textStyle];
  if (rawTs && ('font-family' in rawTs || 'font-size' in rawTs || 'font-weight' in rawTs)) {
    // Copy CSS-format values directly
    for (const [k, v] of Object.entries(rawTs)) {
      if (v == null || v === '') continue;
      let sv = String(v);
      // Ensure font-family is quoted with fallback
      if (k === 'font-family' && !sv.includes('"')) {
        sv = `"${sv}", sans-serif`;
      }
      css[k] = sv;
    }
    // Apply design token overrides
    const ffVar = tryBoundVariable(node, 'fontFamily', variables);
    if (ffVar) css['font-family'] = ffVar;
    const fsVar = tryBoundVariable(node, 'fontSize', variables);
    if (fsVar) css['font-size'] = fsVar;
    const fwVar = tryBoundVariable(node, 'fontWeight', variables);
    if (fwVar) css['font-weight'] = fwVar;
    const colorVar = tryBoundVariable(node, 'fills', variables);
    if (colorVar) {
      css['color'] = colorVar;
    } else if (!css['color']) {
      const fills = extractFillsFromNode(node, variables);
      if (Array.isArray(fills) && fills.length > 0) css['color'] = fills[0];
    }
    // Node-level text behavior
    if (node.textAutoResize) {
      switch (node.textAutoResize) {
        case 'HEIGHT':
          css['height'] = 'auto'; css['min-height'] = '1em'; break;
        case 'WIDTH_AND_HEIGHT':
          css['width'] = 'max-content'; css['height'] = 'auto'; break;
        case 'TRUNCATE':
          css['overflow'] = 'hidden'; css['text-overflow'] = 'ellipsis'; css['white-space'] = 'nowrap'; break;
      }
    }
    const truncation = node.textTruncation;
    if (truncation === 'ENDING') {
      css['overflow'] = 'hidden'; css['text-overflow'] = 'ellipsis'; css['white-space'] = 'nowrap';
    }
    return css;
  }

  const ts = rawTs ?? node.style ?? {};

  // font-family
  const ffVar = tryBoundVariable(node, 'fontFamily', variables);
  if (ffVar) { css['font-family'] = ffVar; }
  else if (ts.fontFamily) { css['font-family'] = `"${ts.fontFamily}", sans-serif`; }

  // font-size
  const fsVar = tryBoundVariable(node, 'fontSize', variables);
  if (fsVar) { css['font-size'] = fsVar; }
  else if (ts.fontSize) { css['font-size'] = addUnit(ts.fontSize, 'px'); }

  // font-weight
  const fwVar = tryBoundVariable(node, 'fontWeight', variables);
  if (fwVar) { css['font-weight'] = fwVar; }
  else if (ts.fontWeight) { css['font-weight'] = String(ts.fontWeight); }

  // line-height
  if (ts.lineHeight != null) {
    if (typeof ts.lineHeight === 'object') {
      if (ts.lineHeight.unit === 'PERCENT')     css['line-height'] = `${roundCss(ts.lineHeight.value)}%`;
      else if (ts.lineHeight.unit === 'AUTO')   css['line-height'] = 'normal';
      else                                       css['line-height'] = `${roundCss(ts.lineHeight.value)}px`;
    } else {
      const lh = ts.lineHeight;
      css['line-height'] = typeof lh === 'number' ? `${roundCss(lh)}px` : String(lh);
    }
  }

  // letter-spacing
  if (ts.letterSpacing != null && ts.letterSpacing !== 0) {
    if (typeof ts.letterSpacing === 'object') {
      css['letter-spacing'] = ts.letterSpacing.unit === 'PERCENT'
        ? `${roundCss(ts.letterSpacing.value / 100)}em`
        : `${roundCss(ts.letterSpacing.value)}px`;
    } else {
      css['letter-spacing'] = `${roundCss(ts.letterSpacing)}px`;
    }
  }

  // text-decoration
  if (ts.textDecoration && ts.textDecoration !== 'NONE') {
    const dm: Record<string, string> = { UNDERLINE: 'underline', STRIKETHROUGH: 'line-through' };
    css['text-decoration'] = dm[ts.textDecoration] ?? ts.textDecoration.toLowerCase();
  }

  // text-transform (textCase in Figma)
  if (ts.textCase && ts.textCase !== 'ORIGINAL') {
    const tm: Record<string, string> = {
      UPPER: 'uppercase', LOWER: 'lowercase', TITLE: 'capitalize',
      SMALL_CAPS: 'lowercase', SMALL_CAPS_FORCED: 'lowercase',
    };
    if (tm[ts.textCase]) css['text-transform'] = tm[ts.textCase];
    if (ts.textCase === 'SMALL_CAPS' || ts.textCase === 'SMALL_CAPS_FORCED') css['font-variant'] = 'small-caps';
  }

  // text-align horizontal
  if (ts.textAlignHorizontal) {
    const am: Record<string, string> = { LEFT: 'left', RIGHT: 'right', CENTER: 'center', JUSTIFIED: 'justify' };
    if (am[ts.textAlignHorizontal]) css['text-align'] = am[ts.textAlignHorizontal];
  }

  // text-align vertical
  if (ts.textAlignVertical) {
    const vam: Record<string, string> = { TOP: 'top', CENTER: 'middle', BOTTOM: 'bottom' };
    if (vam[ts.textAlignVertical]) css['vertical-align'] = vam[ts.textAlignVertical];
  }

  // paragraph-spacing
  if (ts.paragraphSpacing) css['margin-bottom'] = `${ts.paragraphSpacing}px`;

  // paragraph-indent
  if (ts.paragraphIndent) css['text-indent'] = `${ts.paragraphIndent}px`;

  // text auto-resize → controls whether container grows with text
  if (node.textAutoResize) {
    switch (node.textAutoResize) {
      case 'HEIGHT':
        css['height']     = 'auto';
        css['min-height'] = '1em';
        break;
      case 'WIDTH_AND_HEIGHT':
        css['width']  = 'max-content';
        css['height'] = 'auto';
        break;
      case 'TRUNCATE':
        css['overflow']      = 'hidden';
        css['text-overflow'] = 'ellipsis';
        css['white-space']   = 'nowrap';
        break;
      // 'NONE' = fixed size — already handled by dimensions
    }
  }

  // OpenType feature flags
  if (ts.openTypeFeatures && Object.keys(ts.openTypeFeatures).length > 0) {
    css['font-feature-settings'] = resolveOpenTypeFeatures(ts.openTypeFeatures);
  }

  // hyperlink underline hint
  if (ts.hyperlink) css['text-decoration'] = css['text-decoration'] ?? 'underline';

  // text truncation
  const truncation = ts.textTruncation ?? node.textTruncation;
  if (truncation === 'ENDING') {
    css['overflow']      = 'hidden';
    css['text-overflow'] = 'ellipsis';
    css['white-space']   = 'nowrap';
  } else if (ts.maxLines > 1) {
    css['display']             = '-webkit-box';
    css['-webkit-box-orient']  = 'vertical';
    css['-webkit-line-clamp']  = String(ts.maxLines);
    css['overflow']            = 'hidden';
  }

  // color
  const colorVar = tryBoundVariable(node, 'fills', variables);
  if (colorVar) {
    css['color'] = colorVar;
  } else {
    const fills = globalStyles[node.fills] ?? extractFillsFromNode(node, variables);
    if (Array.isArray(fills) && fills.length > 0) css['color'] = fills[0];
  }

  return css;
}

// ============================================================================
// SECTION 13: NODE CSS RESOLUTION
// ============================================================================

const BLEND_MODE_MAP: Record<string, string> = {
  MULTIPLY: 'multiply', SCREEN: 'screen', OVERLAY: 'overlay', DARKEN: 'darken',
  LIGHTEN: 'lighten', COLOR_DODGE: 'color-dodge', COLOR_BURN: 'color-burn',
  HARD_LIGHT: 'hard-light', SOFT_LIGHT: 'soft-light', DIFFERENCE: 'difference',
  EXCLUSION: 'exclusion', HUE: 'hue', SATURATION: 'saturation', COLOR: 'color', LUMINOSITY: 'luminosity',
};

const VECTOR_NODE_TYPES = new Set([
  'VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'LINE', 'ELLIPSE', 'REGULAR_POLYGON',
]);

function resolveNodeCSS(
  node: any,
  globalStyles: Record<string, any>,
  variables: Record<string, ResolvedVariable>,
  depth: number,
): Record<string, string> {
  const css: Record<string, string> = {};
  if (!node) return css;
  if (node.visible === false) return { display: 'none' };

  resolveLayout(node, globalStyles, css);
  resolvePadding(node, css);
  resolveDimensions(node, css);
  resolveGrid(node, css);
  resolvePositioning(node, css);
  resolveFlexChild(node, css);
  resolveOverflow(node, css);
  resolveFills(node, globalStyles, variables, css);
  resolveStrokes(node, globalStyles, variables, css);
  resolveBorderRadius(node, css);

  if (node.opacity !== undefined && node.opacity < 0.9999) {
    css['opacity'] = parseFloat(node.opacity.toFixed(3)).toString();
  }

  const effects = globalStyles[node.effects] ?? extractEffectsFromNode(node);
  if (effects) {
    if (effects.boxShadow)      css['box-shadow']      = effects.boxShadow;
    if (effects.backdropFilter) css['backdrop-filter'] = effects.backdropFilter;
    if (effects.filter)         css['filter']          = effects.filter;
  }

  if (node.blendMode && !['NORMAL', 'PASS_THROUGH'].includes(node.blendMode)) {
    css['mix-blend-mode'] = BLEND_MODE_MAP[node.blendMode] ?? node.blendMode.toLowerCase();
  }

  // Aspect ratio for image rectangles
  if (node.type === 'RECTANGLE' && node.absoluteBoundingBox) {
    const { width, height } = node.absoluteBoundingBox;
    if (width > 0 && height > 0 && node.fills?.some((f: any) => f.type === 'IMAGE')) {
      css['aspect-ratio'] = `${width} / ${height}`;
    }
  }

  const cursor = heuristicCursor(node);
  if (cursor) css['cursor'] = cursor;

  // NOTE: node.transitionNodeID and node.transitionEasing are Figma PROTOTYPE
  // properties (page-to-page navigation), NOT CSS transitions. Do not emit them.
  // CSS transitions for interactive states are added in buildVariantCSS() instead.

  if (node.rotation && Math.abs(node.rotation) > 0.1) {
    css['transform'] = `rotate(${parseFloat((-node.rotation).toFixed(2))}deg)`;
    css['transform-origin'] = 'center';
  }

  return css;
}

// ── Layout ──────────────────────────────────────────────────────────────────

function resolveLayout(node: any, globalStyles: Record<string, any>, css: Record<string, string>) {
  const layout = globalStyles[node.layout] ?? extractLayoutFromNode(node);
  if (!layout) return;

  if (layout.mode === 'row' || node.layoutMode === 'HORIZONTAL') {
    css['display'] = 'flex'; css['flex-direction'] = 'row';
  } else if (layout.mode === 'column' || node.layoutMode === 'VERTICAL') {
    css['display'] = 'flex'; css['flex-direction'] = 'column';
  }

  if (layout.justifyContent) css['justify-content'] = layout.justifyContent;
  if (layout.alignItems)     css['align-items']     = layout.alignItems;
  if (layout.gap)            css['gap']             = layout.gap;
  if (node.itemSpacing)      css['gap']             = `${node.itemSpacing}px`;

  // Flex wrap — must be checked here, not just in resolveGrid
  if (node.layoutWrap === 'WRAP' && css['display'] === 'flex') {
    css['flex-wrap'] = 'wrap';
    if (node.counterAxisSpacing) css['row-gap'] = `${node.counterAxisSpacing}px`;
  }
}

function extractLayoutFromNode(node: any): any | null {
  if (!node.layoutMode || node.layoutMode === 'NONE') return null;
  const layout: any = {};
  if (node.layoutMode === 'HORIZONTAL') layout.mode = 'row';
  if (node.layoutMode === 'VERTICAL')   layout.mode = 'column';
  if (node.primaryAxisAlignItems) layout.justifyContent = mapAlignItems(node.primaryAxisAlignItems);
  if (node.counterAxisAlignItems) layout.alignItems     = mapAlignItems(node.counterAxisAlignItems);
  if (node.itemSpacing)           layout.gap            = `${node.itemSpacing}px`;
  return layout;
}

function mapAlignItems(align: string): string {
  const map: Record<string, string> = {
    MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end',
    SPACE_BETWEEN: 'space-between', STRETCH: 'stretch', BASELINE: 'baseline',
  };
  return map[align] ?? align.toLowerCase().replace(/_/g, '-');
}

// ── Grid ────────────────────────────────────────────────────────────────────

function resolveGrid(node: any, css: Record<string, string>) {
  if (!Array.isArray(node.layoutGrids) || node.layoutGrids.length === 0) return;

  for (const grid of node.layoutGrids) {
    if (grid.pattern === 'COLUMNS') {
      css['display'] = 'grid';
      css['grid-template-columns'] = `repeat(${grid.count ?? 'auto-fill'}, 1fr)`;
      if (grid.gutterSize) css['column-gap'] = `${grid.gutterSize}px`;
      break;
    }
    if (grid.pattern === 'ROWS') {
      css['display'] = 'grid';
      css['grid-auto-rows'] = `${grid.sectionSize ?? 'auto'}px`;
      if (grid.gutterSize) css['row-gap'] = `${grid.gutterSize}px`;
      break;
    }
  }

  if (node.layoutWrap === 'WRAP' && css['display'] === 'flex') {
    css['flex-wrap'] = 'wrap';
    if (node.counterAxisSpacing) css['row-gap'] = `${node.counterAxisSpacing}px`;
  }
}

// ── Padding ─────────────────────────────────────────────────────────────────

function resolvePadding(node: any, css: Record<string, string>) {
  if (node.padding !== undefined) {
    const p = node.padding;
    if (typeof p === 'number') { css['padding'] = `${p}px`; return; }
    if (typeof p === 'string') { css['padding'] = p; return; }
    if (typeof p === 'object' && p.top !== undefined) {
      css['padding'] = `${p.top ?? 0}px ${p.right ?? 0}px ${p.bottom ?? 0}px ${p.left ?? 0}px`;
      return;
    }
  }

  const t = node.paddingTop ?? 0, r = node.paddingRight ?? 0;
  const b = node.paddingBottom ?? 0, l = node.paddingLeft ?? 0;
  if (t === 0 && r === 0 && b === 0 && l === 0) return;

  if (t === r && t === b && t === l)           css['padding'] = `${t}px`;
  else if (t === b && l === r)                 css['padding'] = `${t}px ${r}px`;
  else                                         css['padding'] = `${t}px ${r}px ${b}px ${l}px`;
}

// ── Dimensions ──────────────────────────────────────────────────────────────

function resolveDimensions(node: any, css: Record<string, string>) {
  if (!node.absoluteBoundingBox) return;
  const { width, height } = node.absoluteBoundingBox;

  const isH = node.layoutMode === 'HORIZONTAL';
  const isV = node.layoutMode === 'VERTICAL';

  // ── Min/Max constraints ──
  if (node.minWidth  != null && node.minWidth  > 0) css['min-width']  = `${node.minWidth}px`;
  if (node.maxWidth  != null && node.maxWidth  > 0) css['max-width']  = `${node.maxWidth}px`;
  if (node.minHeight != null && node.minHeight > 0) css['min-height'] = `${node.minHeight}px`;
  if (node.maxHeight != null && node.maxHeight > 0) css['max-height'] = `${node.maxHeight}px`;

  // ── Aspect ratio lock ──
  // When preserveRatio is true, emit only width and let aspect-ratio control height.
  if (node.preserveRatio === true && width > 0 && height > 0) {
    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
    const g = gcd(Math.round(width), Math.round(height));
    css['aspect-ratio'] = `${Math.round(width / g)} / ${Math.round(height / g)}`;
    // Set width only — let aspect-ratio derive height
    if (!css['width']) css['width'] = `${width}px`;
    // Skip fixed height to let aspect-ratio work
    css['height'] = 'auto';
  }

  // ── Height ──
  if (!css['height'] && !css['min-height']) {
    if ((isV && node.primaryAxisSizingMode === 'AUTO') || node.layoutSizingVertical === 'HUG') {
      css['min-height'] = `${height}px`;
    } else if (node.layoutSizingVertical === 'FILL') {
      css['height'] = '100%';
    } else {
      css['height'] = `${height}px`;
    }
  }

  // ── Width ──
  if (!css['width'] && !css['min-width']) {
    const hug  = (isH && node.primaryAxisSizingMode === 'AUTO') ||
                 (isV && node.counterAxisSizingMode  === 'AUTO') ||
                 node.layoutSizingHorizontal === 'HUG';
    const fill = node.layoutSizingHorizontal === 'FILL' || node.layoutGrow === 1;

    if (fill) {
      css['flex-grow'] = '1'; css['width'] = '100%';
    } else if (hug) {
      css['width'] = 'fit-content';
      css['min-width'] = `${width}px`;
    } else {
      css['width'] = `${width}px`;
    }
  }
}

// ── Absolute positioning + constraints ───────────────────────────────────────

function resolvePositioning(node: any, css: Record<string, string>) {
  // Fixed position on scroll (Figma "scrollingBehavior: FIXED")
  if (node.scrollBehavior === 'FIXED' || node.isFixed === true) {
    css['position'] = 'sticky';
    css['top'] = '0';
    css['z-index'] = '100';
    return;
  }

  if (node.layoutPositioning !== 'ABSOLUTE') return;
  css['position'] = 'absolute';

  if (!node.constraints) {
    // Use relative position within parent (node.x/y), NOT absoluteBoundingBox.
    // Fall back to relativeTransform matrix if x/y are unavailable.
    const posX = node.x ?? node.relativeTransform?.[0]?.[2];
    const posY = node.y ?? node.relativeTransform?.[1]?.[2];
    if (posX !== undefined) css['left'] = `${Math.round(posX)}px`;
    if (posY !== undefined) css['top']  = `${Math.round(posY)}px`;
    return;
  }

  const { horizontal: h, vertical: v } = node.constraints;

  // Use node.x/y (relative to parent) for positioning, NOT absoluteBoundingBox
  // absoluteBoundingBox gives canvas-root-relative coords that are wrong in COMPONENT_SETs
  if (h === 'LEFT' || h === 'MIN')            { if (node.x !== undefined) css['left'] = `${Math.round(node.x)}px`; }
  else if (h === 'RIGHT' || h === 'MAX')      { css['right'] = '0'; }
  else if (h === 'CENTER')                    { css['left'] = '50%'; css['transform'] = (css['transform'] ? css['transform'] + ' ' : '') + 'translateX(-50%)'; }
  else if (h === 'STRETCH' || h === 'SCALE')  { css['left'] = '0'; css['right'] = '0'; }

  if (v === 'TOP' || v === 'MIN')             { if (node.y !== undefined) css['top'] = `${Math.round(node.y)}px`; }
  else if (v === 'BOTTOM' || v === 'MAX')     { css['bottom'] = '0'; }
  else if (v === 'CENTER')                    { css['top'] = '50%'; css['transform'] = (css['transform'] ? css['transform'] + ' ' : '') + 'translateY(-50%)'; }
  else if (v === 'STRETCH' || v === 'SCALE')  { css['top'] = '0'; css['bottom'] = '0'; }
}

// ── Flex child ───────────────────────────────────────────────────────────────

function resolveFlexChild(node: any, css: Record<string, string>) {
  if (node.layoutAlign === 'STRETCH') css['align-self'] = 'stretch';
  if (node.layoutAlign === 'INHERIT') css['align-self'] = 'auto';
}

// ── Overflow ──────────────────────────────────────────────────────────────────

function resolveOverflow(node: any, css: Record<string, string>) {
  if (node.clipsContent === true) {
    css['overflow'] = 'hidden';
  } else if (node.overflowDirection) {
    const map: Record<string, [string, string]> = {
      VERTICAL:                 ['overflow-y', 'auto'],
      HORIZONTAL:               ['overflow-x', 'auto'],
      HORIZONTAL_AND_VERTICAL:  ['overflow',   'auto'],
    };
    const entry = map[node.overflowDirection];
    if (entry) css[entry[0]] = entry[1];
  }
}

// ── Fills ──────────────────────────────────────────────────────────────────────

function resolveFills(
  node: any,
  globalStyles: Record<string, any>,
  variables: Record<string, ResolvedVariable>,
  css: Record<string, string>,
) {
  const fillVar = tryBoundVariable(node, 'fills', variables);
  if (fillVar) { css['background-color'] = fillVar; return; }

  const fills = globalStyles[node.fills] ?? extractFillsFromNode(node, variables);
  if (!Array.isArray(fills) || fills.length === 0) return;

  const primary = fills[0];
  if (!primary) return;

  if (primary.startsWith('linear-gradient') || primary.startsWith('radial-gradient') || primary.startsWith('conic-gradient')) {
    css['background'] = primary;
  } else if (primary.startsWith('url(')) {
    css['background-image'] = primary;
    // Apply image scale mode from the raw fill data
    const rawImageFill = node.fills?.find((f: any) => f.type === 'IMAGE' && f.visible !== false);
    if (rawImageFill) {
      applyImageScaleMode(rawImageFill, css);
    } else {
      css['background-size'] = 'cover';
      css['background-position'] = 'center';
      css['background-repeat'] = 'no-repeat';
    }
  } else {
    css['background-color'] = primary;
  }

  if (fills.length > 1) css['background'] = [...fills.slice(1), primary].join(', ');
}

function extractFillsFromNode(node: any, variables: Record<string, ResolvedVariable> = {}): string[] | null {
  if (!Array.isArray(node.fills) || node.fills.length === 0) return null;

  const result: string[] = [];
  for (const fill of node.fills) {
    if (fill.visible === false) continue;

    const varRef = fill.boundVariables?.color;
    if (varRef) {
      const resolved = resolveBoundVariable(varRef, variables);
      if (resolved) { result.push(resolved); continue; }
    }

    switch (fill.type) {
      case 'SOLID':            if (fill.color) result.push(solidFillToCSS(fill, node)); break;
      case 'GRADIENT_LINEAR':  result.push(linearGradientToCSS(fill)); break;
      case 'GRADIENT_RADIAL':  result.push(radialGradientToCSS(fill)); break;
      case 'GRADIENT_ANGULAR': result.push(angularGradientToCSS(fill)); break;
      case 'GRADIENT_DIAMOND': result.push(radialGradientToCSS(fill)); break; // best approx
      case 'IMAGE':
        result.push(fill.imageRef ? `url(/* ${fill.imageRef} */)` : 'url()');
        break;
      case 'VIDEO':            result.push('transparent'); break;
    }
  }
  return result.length > 0 ? result : null;
}

function solidFillToCSS(fill: any, node: any): string {
  const { r, g, b, a = 1 } = fill.color;
  const fillOp = fill.opacity  !== undefined ? fill.opacity : 1;
  const nodeOp = node.opacity  !== undefined ? node.opacity : 1;
  const alpha  = parseFloat((a * fillOp * nodeOp).toFixed(3));
  return alpha >= 0.999 ? rgbToHex(r, g, b)
    : `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
}

function linearGradientToCSS(fill: any): string {
  if (!fill.gradientHandlePositions?.length || !fill.gradientStops?.length)
    return 'linear-gradient(to right, transparent, transparent)';
  const [start, end] = fill.gradientHandlePositions;
  const angle = Math.round(Math.atan2(end.x - start.x, -(end.y - start.y)) * (180 / Math.PI));
  return `linear-gradient(${angle}deg, ${gradientStopsToCSS(fill.gradientStops)})`;
}

function radialGradientToCSS(fill: any): string {
  if (!fill.gradientStops?.length) return 'radial-gradient(transparent, transparent)';
  if (fill.gradientHandlePositions?.length >= 1) {
    const cx = Math.round(fill.gradientHandlePositions[0].x * 100);
    const cy = Math.round(fill.gradientHandlePositions[0].y * 100);
    return `radial-gradient(circle at ${cx}% ${cy}%, ${gradientStopsToCSS(fill.gradientStops)})`;
  }
  return `radial-gradient(circle, ${gradientStopsToCSS(fill.gradientStops)})`;
}

function angularGradientToCSS(fill: any): string {
  if (!fill.gradientStops?.length) return 'conic-gradient(transparent, transparent)';
  let angle = 0;
  let cx = 50, cy = 50;
  if (fill.gradientHandlePositions?.length >= 2) {
    const [h0, h1] = fill.gradientHandlePositions;
    angle = Math.round(Math.atan2(h1.x - h0.x, -(h1.y - h0.y)) * (180 / Math.PI));
    cx = Math.round(h0.x * 100);
    cy = Math.round(h0.y * 100);
  }
  return `conic-gradient(from ${angle}deg at ${cx}% ${cy}%, ${gradientStopsToCSS(fill.gradientStops)})`;
}

function gradientStopsToCSS(stops: any[]): string {
  return stops.map((s) => {
    const { r, g, b, a = 1 } = s.color;
    const col = a >= 0.999 ? rgbToHex(r, g, b)
      : `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${parseFloat(a.toFixed(3))})`;
    return `${col} ${Math.round(s.position * 100)}%`;
  }).join(', ');
}

// ── Strokes ────────────────────────────────────────────────────────────────────

function resolveStrokes(
  node: any,
  globalStyles: Record<string, any>,
  variables: Record<string, ResolvedVariable>,
  css: Record<string, string>,
) {
  const strokeVar = tryBoundVariable(node, 'strokes', variables);
  const strokes   = globalStyles[node.strokes] ?? extractStrokesFromNode(node, variables);
  if (!strokes?.colors?.length) return;

  const weight = strokes.strokeWeight ?? '1px';
  const color  = strokeVar ?? strokes.colors[0];

  if (node.strokeAlign === 'INSIDE') {
    const existing = css['box-shadow'] ? css['box-shadow'] + ', ' : '';
    css['box-shadow'] = `${existing}inset 0 0 0 ${weight} ${color}`;
  } else if (node.strokeAlign === 'OUTSIDE') {
    const existing = css['box-shadow'] ? css['box-shadow'] + ', ' : '';
    css['box-shadow'] = `${existing}0 0 0 ${weight} ${color}`;
  } else {
    // CENTER (default CSS border)
    if (strokes.sides) {
      const val = `${weight} solid ${color}`;
      if (strokes.sides.top)    css['border-top']    = val;
      if (strokes.sides.right)  css['border-right']  = val;
      if (strokes.sides.bottom) css['border-bottom'] = val;
      if (strokes.sides.left)   css['border-left']   = val;
    } else {
      css['border'] = `${weight} solid ${color}`;
    }
  }

  // Dash pattern
  if (Array.isArray(node.dashPattern) && node.dashPattern.length >= 2) {
    const [dash, gap] = node.dashPattern;
    css['border-style'] = (css['border'] || css['border-top']) ? (dash === gap ? 'dashed' : 'dotted') : css['border-style'];
  }
}

function extractStrokesFromNode(node: any, variables: Record<string, ResolvedVariable> = {}): any | null {
  if (!Array.isArray(node.strokes) || node.strokes.length === 0) return null;

  const colors: string[] = [];
  for (const stroke of node.strokes) {
    if (stroke.visible === false) continue;
    const varRef = stroke.boundVariables?.color;
    if (varRef) {
      const resolved = resolveBoundVariable(varRef, variables);
      if (resolved) { colors.push(resolved); continue; }
    }
    if (stroke.type === 'SOLID' && stroke.color) {
      colors.push(solidFillToCSS({ ...stroke, color: stroke.color }, node));
    }
  }
  if (colors.length === 0) return null;

  const sides: Record<string, boolean> = {};
  if ((node.strokeTopWeight    ?? 0) > 0) sides.top    = true;
  if ((node.strokeRightWeight  ?? 0) > 0) sides.right  = true;
  if ((node.strokeBottomWeight ?? 0) > 0) sides.bottom = true;
  if ((node.strokeLeftWeight   ?? 0) > 0) sides.left   = true;

  return {
    colors,
    strokeWeight: node.strokeWeight ? `${node.strokeWeight}px` : '1px',
    sides: Object.keys(sides).length > 0 && Object.keys(sides).length < 4 ? sides : null,
    strokeAlign: node.strokeAlign,
  };
}

// ── Border radius ─────────────────────────────────────────────────────────────

function resolveBorderRadius(node: any, css: Record<string, string>) {
  if (node.cornerRadius !== undefined && node.cornerRadius !== null) {
    const r = node.cornerRadius;
    css['border-radius'] = node.cornerSmoothing && node.cornerSmoothing > 0
      ? `${Math.round(r * (1 + node.cornerSmoothing * 0.5))}px`
      : `${r}px`;
    return;
  }

  const tl = node.topLeftRadius     ?? node.rectangleCornerRadii?.[0];
  const tr = node.topRightRadius    ?? node.rectangleCornerRadii?.[1];
  const br = node.bottomRightRadius ?? node.rectangleCornerRadii?.[2];
  const bl = node.bottomLeftRadius  ?? node.rectangleCornerRadii?.[3];

  if (tl !== undefined || tr !== undefined || br !== undefined || bl !== undefined) {
    css['border-radius'] = `${tl ?? 0}px ${tr ?? 0}px ${br ?? 0}px ${bl ?? 0}px`;
    return;
  }
  if (node.borderRadius) css['border-radius'] = node.borderRadius;
}

// ── Effects ───────────────────────────────────────────────────────────────────

function extractEffectsFromNode(node: any): any | null {
  if (!Array.isArray(node.effects) || node.effects.length === 0) return null;

  const result: any = {};
  const shadows: string[] = [];

  for (const effect of node.effects) {
    if (effect.visible === false) continue;
    if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
      const { offset, radius, spread = 0, color } = effect;
      if (offset && color) {
        const { r, g, b, a = 1 } = color;
        const col = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${parseFloat(a.toFixed(3))})`;
        shadows.push(`${effect.type === 'INNER_SHADOW' ? 'inset ' : ''}${offset.x}px ${offset.y}px ${radius ?? 0}px ${spread}px ${col}`);
      }
    } else if (effect.type === 'BACKGROUND_BLUR' && effect.radius) {
      result.backdropFilter = `blur(${effect.radius}px)`;
    } else if (effect.type === 'LAYER_BLUR' && effect.radius) {
      result.filter = `blur(${effect.radius}px)`;
    }
  }

  if (shadows.length > 0) result.boxShadow = shadows.join(', ');
  return Object.keys(result).length > 0 ? result : null;
}

// ── Vector color ──────────────────────────────────────────────────────────────

function extractVectorColorRecursive(node: any, variables: Record<string, ResolvedVariable> = {}): string | null {
  if (!node) return null;

  if (VECTOR_NODE_TYPES.has(node.type)) {
    // Strokes first
    if (Array.isArray(node.strokes)) {
      for (const s of node.strokes) {
        if (s.visible === false) continue;
        const varRef = s.boundVariables?.color;
        if (varRef) { const r = resolveBoundVariable(varRef, variables); if (r) return r; }
        if (s.type === 'SOLID' && s.color) {
          const { r, g, b, a = 1 } = s.color;
          return a >= 0.999 ? rgbToHex(r, g, b)
            : `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${parseFloat(a.toFixed(3))})`;
        }
      }
    }
    // Then fills
    if (Array.isArray(node.fills)) {
      for (const f of node.fills) {
        if (f.visible === false) continue;
        const varRef = f.boundVariables?.color;
        if (varRef) { const r = resolveBoundVariable(varRef, variables); if (r) return r; }
        if (f.type === 'SOLID' && f.color) {
          const { r, g, b, a = 1 } = f.color;
          return a >= 0.999 ? rgbToHex(r, g, b)
            : `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${parseFloat(a.toFixed(3))})`;
        }
      }
    }
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const color = extractVectorColorRecursive(child, variables);
      if (color) return color;
    }
  }
  return null;
}

// ── Misc helpers ──────────────────────────────────────────────────────────────

function heuristicCursor(node: any): string | null {
  const n = (node.name ?? '').toLowerCase();
  if (/\b(button|btn|cta|link|clickable|anchor|tab|chip|tag|radio|checkbox|toggle|switch|selectable)\b/.test(n)) return 'pointer';
  if (/\b(input|textarea|field|text.?box|editable|search)\b/.test(n)) return 'text';
  if (/\b(slider|range|track|thumb)\b/.test(n)) return 'ew-resize';
  if (/\b(resize|handle)\b/.test(n)) return 'se-resize';
  if (/\b(drag|draggable)\b/.test(n)) return 'grab';
  if (/\bdisabled\b/.test(n)) return 'not-allowed';
  return null;
}

function findFirstTextNode(node: any): any | null {
  if (node.type === 'TEXT') return node;
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const found = findFirstTextNode(child);
      if (found) return found;
    }
  }
  return null;
}

function collectCSSTokens(styles: VariantStyles): string[] {
  const tokens = new Set<string>();
  const re = /var\(--[^)]+\)/g;
  const scan = (obj: Record<string, string>) =>
    Object.values(obj).forEach((v) => String(v).match(re)?.forEach((m) => tokens.add(m)));
  scan(styles.container);
  scan(styles.text);
  Object.values(styles.children).forEach(scan);
  return [...tokens];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/**
 * Build a flat BEM element key from parent prefix and child name.
 * Limits nesting to max 1 __ separator (e.g. "parent__child").
 * Deeper children use hyphenation: "parent__child-grandchild".
 * This keeps CSS selectors like `.base__parent__child-grandchild`
 * instead of deeply nested `.base__parent__child__grandchild__deep`.
 */
function buildBemKey(prefix: string, childKebab: string): string {
  if (!prefix) return childKebab;
  if (!prefix.includes('__')) return `${prefix}__${childKebab}`;
  // Already has __ — flatten deeper children with hyphen
  const [firstSegment, ...rest] = prefix.split('__');
  return `${firstSegment}__${[...rest, childKebab].join('-')}`;
}

function isIconKey(key: string): boolean {
  const leaf = key.includes('__') ? key.split('__').pop()! : key;
  const k = leaf.toLowerCase();
  // Compound names like "icon-and-text" are layout containers, not icons
  if (k.includes('-and-')) return false;
  return k.includes('icon') || k.includes('leading') || k.includes('trailing') ||
    k.includes('prefix') || k.includes('suffix') || k.includes('adornment');
}

/** Detects Figma auto-generated node names (e.g. "frame-2147225756", "group-42") */
function isAutoGeneratedKey(key: string): boolean {
  return /^(frame|group|rectangle|ellipse|line|vector|star|polygon|instance|component|section)-\d{3,}$/.test(key)
    || /^\d+$/.test(key);
}

/**
 * Infers a semantic BEM element name from a node's content and layout.
 * Used as a fallback when the Figma layer has an auto-generated name.
 */
function inferSemanticKey(node: any): string {
  const children: any[]  = node.children || [];
  const textCount        = children.filter((c: any) => c.type === 'TEXT').length;
  const vectorCount      = children.filter((c: any) => ['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'ELLIPSE', 'LINE'].includes(c.type)).length;
  const frameCount       = children.filter((c: any) => ['FRAME', 'GROUP'].includes(c.type)).length;
  const instanceCount    = children.filter((c: any) => c.type === 'INSTANCE').length;

  if (children.length === 0) {
    return node.fills?.some((f: any) => f.type === 'IMAGE') ? 'image' : 'slot';
  }
  if (children.length <= 2 && vectorCount > 0 && textCount === 0) return 'icon';
  if (instanceCount > 0 && textCount === 0 && frameCount === 0) return 'icon';
  if (textCount > 0 && vectorCount === 0 && frameCount === 0 && instanceCount === 0) {
    return textCount === 1 ? 'label' : 'text';
  }
  if (textCount > 0 && (vectorCount > 0 || instanceCount > 0)) return 'content';
  if (textCount > 0 && frameCount > 0) return 'body';
  if (frameCount >= 2 || (frameCount >= 1 && instanceCount >= 1)) {
    return node.layoutMode === 'HORIZONTAL' ? 'row' : 'stack';
  }
  return 'section';
}

/**
 * Applies a semantic rename map to a child key using prefix substitution.
 *
 * First tries an exact match, then replaces the longest known prefix segment.
 * Keys use flat BEM format (max 1 __ separator), e.g. if `frame-123` → `row`,
 * then `frame-123__icon-warning` stays `row__icon-warning`.
 */
function applyRenameMap(key: string, renameMap: Map<string, string>): string {
  const exact = renameMap.get(key);
  if (exact !== undefined) return exact;

  // Try prefix substitution: longest prefix first
  const segments = key.split('__');
  for (let len = segments.length - 1; len >= 1; len--) {
    const prefix  = segments.slice(0, len).join('__');
    const renamed = renameMap.get(prefix);
    if (renamed !== undefined) {
      const suffix = segments.slice(len).join('__');
      return `${renamed}__${suffix}`;
    }
  }

  return key;
}

/**
 * Walks the default variant node tree and builds a rename map for child keys
 * that have Figma auto-generated names (e.g. frame-2147225756 → content).
 *
 * Returns Map<originalBEMPath, semanticBEMPath>. Only renamed paths are stored;
 * callers use `applyRenameMap(key, renameMap)` to resolve with prefix fallback.
 */
function buildSemanticRenameMap(rootNode: any): Map<string, string> {
  const renameMap = new Map<string, string>();
  if (!rootNode?.children) return renameMap;

  function walk(node: any, origParentPath: string, semParentPath: string): void {
    const children: any[] = node.children || [];
    const usedSemKeys     = new Map<string, number>();

    for (let i = 0; i < children.length; i++) {
      const child   = children[i];
      const origKey = toKebabCase(child.name ?? '');

      let semKey = origKey;
      if (isAutoGeneratedKey(origKey)) {
        semKey = inferSemanticKey(child);
      }

      // Deduplicate semantic keys at this level
      const count = usedSemKeys.get(semKey) ?? 0;
      usedSemKeys.set(semKey, count + 1);
      const finalSemKey = count > 0 ? `${semKey}-${count + 1}` : semKey;

      const fullOrigPath = buildBemKey(origParentPath, origKey);
      const fullSemPath  = buildBemKey(semParentPath, finalSemKey);

      if (fullOrigPath !== fullSemPath) {
        renameMap.set(fullOrigPath, fullSemPath);
      }

      // Recurse: orig prefix uses original names; sem prefix uses semantic names
      walk(child, fullOrigPath, fullSemPath);
    }
  }

  walk(rootNode, '', '');
  return renameMap;
}

function findDimensionsInTree(
  node: any,
  dimensionMap: Map<string, { width: number; height: number }>,
): { width: number; height: number } | null {
  if (!node) return null;
  if (node.id && dimensionMap.has(node.id)) return dimensionMap.get(node.id)!;
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const d = findDimensionsInTree(child, dimensionMap);
      if (d) return d;
    }
  }
  return null;
}

function roundCss(n: number): number {
  return Math.round(n * 100) / 100;
}

function addUnit(value: number | string, unit: string): string {
  if (typeof value === 'number') return `${roundCss(value)}${unit}`;
  const s = String(value);
  return /px|em|rem|%|pt|vh|vw|ch|ex$/i.test(s) ? s : `${s}${unit}`;
}

// ============================================================================
// SECTION 14: CSS GENERATION
// ============================================================================

export function buildVariantCSS(
  data: ComponentSetData,
  dimensionMap?: Map<string, { width: number; height: number }>,
  options: BuildVariantCSSOptions = {},
): string {
  const {
    sourceComments   = false,
    deduplicateRules = true,
    emitFocusReset   = true,
    cssLayer,
    emitTokens       = false,
    preserveExactDimensions = config.css.preserveExactDimensions,
    injectBehavioralStyles = config.css.injectBehavioralStyles,
  } = options;

  const base  = toKebabCase(data.name);
  const lines: string[] = [];

  if (emitTokens && Object.keys(data.resolvedVariables).length > 0) {
    lines.push(':root {');
    for (const v of Object.values(data.resolvedVariables)) {
      lines.push(`  ${v.cssVarName}: ${v.value}; /* ${v.name} */`);
    }
    lines.push('}', '');

    // Emit per-mode theme overrides
    for (const [modeName, modeCSS] of Object.entries(data.variableModesCSS)) {
      lines.push(`/* Theme: ${modeName} */`);
      lines.push(modeCSS, '');
    }
  }

  if (cssLayer) lines.push(`@layer ${cssLayer} {`);

  const findVariant = (props: Record<string, string>) =>
    data.variants.find((v) => Object.entries(props).every(([k, val]) => v.props[k] === val));

  const defaultContainer = data.defaultVariant.styles.container;
  const defaultChildren  = data.defaultVariant.styles.children;

  // Dimension map
  const childDimensions = new Map<string, { width: number; height: number }>();
  for (const variant of data.variants) {
    for (const [key, css] of Object.entries(variant.styles.children)) {
      if (css['width'] && css['height'] && !childDimensions.has(key)) {
        const w = parseFloat(String(css['width']));
        const h = parseFloat(String(css['height']));
        if (!isNaN(w) && !isNaN(h)) childDimensions.set(key, { width: w, height: h });
      }
    }
  }
  if (dimensionMap?.size && data.defaultVariantNode?.children) {
    for (const child of data.defaultVariantNode.children) {
      const key = toKebabCase(child.name ?? '');
      if (!childDimensions.has(key)) {
        const dims = findDimensionsInTree(child, dimensionMap);
        if (dims) childDimensions.set(key, dims);
      }
    }
  }

  const emittedFPs = deduplicateRules ? new Set<string>() : undefined;

  // Build semantic rename map: replaces Figma auto-ID keys with inferred names
  const semanticRenameMap = buildSemanticRenameMap(data.defaultVariantNode);

  // 1. Base container
  // Keep exact Figma dimensions by default for visual fidelity.
  const rootContainer = { ...defaultContainer };
  if (!preserveExactDimensions) {
    if (rootContainer['width']?.endsWith('px') && rootContainer['width'] !== '100%') {
      if (!rootContainer['min-width']) rootContainer['min-width'] = rootContainer['width'];
      delete rootContainer['width'];
    }
    if (rootContainer['height']?.endsWith('px')) {
      if (!rootContainer['min-height']) rootContainer['min-height'] = rootContainer['height'];
      delete rootContainer['height'];
    }
  }

  if (sourceComments) lines.push(`/* ${data.name} | ${data.componentCategory} | <${data.suggestedHtmlTag}> */`);
  lines.push(`.${base} {`);
  for (const [p, v] of Object.entries(rootContainer)) lines.push(`  ${p}: ${v};`);
  if (!defaultContainer['border']) { lines.push(`  border: none;`); lines.push(`  outline: none;`); }
  // Behavioral CSS for interactive components (cursor, transition, user-select)
  if (injectBehavioralStyles && data.isInteractive) {
    if (!rootContainer['cursor']) lines.push(`  cursor: pointer;`);
    lines.push(`  user-select: none;`);
    lines.push(`  transition: background-color 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease, color 0.15s ease;`);
  }
  if (injectBehavioralStyles && emitFocusReset && data.isInteractive) lines.push(`  outline-offset: 2px;`);
  lines.push('}');

  if (injectBehavioralStyles && emitFocusReset && data.isInteractive) {
    lines.push('', `.${base}:focus-visible {`, `  outline: 2px solid currentColor;`, `  outline-offset: 2px;`, '}');
  }

  // 2. Child rules
  for (const [childKey, childCSS] of Object.entries(defaultChildren)) {
    const merged = { ...childCSS };
    const dims = childDimensions.get(childKey);
    if (dims) { merged['width'] = `${dims.width}px`; merged['height'] = `${dims.height}px`; }
    // Keep icon color — SVGs preserve original Figma colors (no currentColor)
    if (Object.keys(merged).length === 0) continue;

    const effectiveKey = applyRenameMap(childKey, semanticRenameMap);
    if (sourceComments) lines.push('', `/* child: ${effectiveKey} */`);
    lines.push('', `.${base}__${effectiveKey} {`);
    for (const [p, v] of Object.entries(merged)) lines.push(`  ${p}: ${v};`);
    lines.push('}');

    if (isIconKey(effectiveKey)) {
      lines.push('', `.${base}__${effectiveKey} img,`, `.${base}__${effectiveKey} svg {`,
        `  width: 100%;`, `  height: 100%;`, `  object-fit: contain;`, `  display: block;`, '}');
    }
  }

  // Build state lookup helpers
  const defaultLookup: Record<string, string> = {};
  for (const axis of data.propAxes) {
    defaultLookup[axis.name] = data.defaultVariant.props[axis.name] ?? axis.values[0];
  }
  const defaultStateName = data.stateAxis
    ? (data.defaultVariant.props[data.stateAxis.name]
        ?? data.stateAxis.values.find((v) => DEFAULT_STATE_NAMES.includes(v.toLowerCase()))
        ?? data.stateAxis.values[0])
    : undefined;

  // 3. Single-axis modifier rules + per-axis-value state overrides
  // Emit BEM modifier diffs for every non-default axis value, then immediately
  // emit state overrides scoped to that same modifier selector — so every axis
  // (Style, Size, Type, …) gets its own :hover/:focus/:disabled rules.
  for (const axis of data.propAxes) {
    for (const value of axis.values) {
      const isDefault = value === (data.defaultVariant.props[axis.name] ?? axis.values[0]);
      const lookup = { ...defaultLookup, [axis.name]: value };
      if (data.stateAxis && defaultStateName) lookup[data.stateAxis.name] = defaultStateName;

      const variant = findVariant(lookup);
      if (!variant) continue;

      const selector = `.${base}--${toKebabCase(value)}`;

      // Emit modifier diff for non-default values only (base class covers default)
      if (!isDefault) {
        if (sourceComments) lines.push('', `/* prop: ${axis.name}=${value} */`);
        emitDiffRules(lines, base, selector, data.defaultVariant.styles, variant.styles, emittedFPs, semanticRenameMap);
      }

      // State overrides for every axis value (including the default value so that
      // the explicitly-tagged default modifier class also gets :hover/:focus rules)
      if (data.stateAxis && data.classifiedStates.length > 0) {
        emitStateOverrides(data, lines, base, selector, lookup, variant, findVariant, sourceComments, emittedFPs, semanticRenameMap);
      }
    }
  }

  // 4. Base-class state overrides
  // When there are no prop axes, emit :hover etc. directly on .button.
  // When prop axes exist, also emit them on the base class as a safe fallback for
  // any variant that doesn't add an explicit modifier class.
  if (data.stateAxis && data.classifiedStates.length > 0) {
    if (data.propAxes.length === 0) {
      const stateLookup: Record<string, string> = {};
      if (defaultStateName) stateLookup[data.stateAxis.name] = defaultStateName;
      emitStateOverrides(data, lines, base, `.${base}`, stateLookup, findVariant(stateLookup) ?? data.defaultVariant, findVariant, sourceComments, emittedFPs, semanticRenameMap);
    } else {
      // Base fallback (default prop combination)
      const defaultPropLookup = { ...defaultLookup };
      if (defaultStateName) defaultPropLookup[data.stateAxis.name] = defaultStateName;
      const defaultPropVariant = findVariant(defaultPropLookup) ?? data.defaultVariant;
      emitStateOverrides(data, lines, base, `.${base}`, defaultPropLookup, defaultPropVariant, findVariant, sourceComments, emittedFPs, semanticRenameMap);
    }
  }

  // 5. Cross-axis combination rules
  // When a component has 2+ prop axes (e.g. Style × Size), diff-based single-axis
  // modifiers cannot capture variant-specific cross-axis styles.  For example,
  // "Secondary + Large + Hover" might have a unique background that neither
  // `.button--secondary:hover` nor `.button--large:hover` covers exactly.
  // Solution: generate selectors like `.button--secondary.button--large:hover`
  // with an explicit diff taken against the single-axis base.
  if (data.propAxes.length >= 2) {
    const crossCombos = generateCrossAxisCombos(data.propAxes, defaultLookup);
    for (const combo of crossCombos) {
      const lookup = { ...defaultLookup, ...combo };
      if (data.stateAxis && defaultStateName) lookup[data.stateAxis.name] = defaultStateName;

      const variant = findVariant(lookup);
      if (!variant) continue;

      // Compound selector: .button--secondary.button--large
      const selector = Object.values(combo)
        .map((val) => `.${base}--${toKebabCase(val)}`)
        .join('');

      // Diff against the "first-axis only" variant so we emit only the
      // additional properties that differ because of the second (or third) axis.
      const firstKey = Object.keys(combo)[0];
      const firstLookup = { ...defaultLookup, [firstKey]: combo[firstKey] };
      if (data.stateAxis && defaultStateName) firstLookup[data.stateAxis.name] = defaultStateName;
      const baseForCombo = findVariant(firstLookup) ?? data.defaultVariant;

      if (sourceComments) {
        lines.push('', `/* cross-axis: ${Object.entries(combo).map(([k, v]) => `${k}=${v}`).join(', ')} */`);
      }
      emitDiffRules(lines, base, selector, baseForCombo.styles, variant.styles, emittedFPs, semanticRenameMap);

      // State overrides for this exact cross-axis combination
      if (data.stateAxis && data.classifiedStates.length > 0) {
        emitStateOverrides(data, lines, base, selector, lookup, variant, findVariant, sourceComments, emittedFPs, semanticRenameMap);
      }
    }
  }

  if (cssLayer) lines.push('}');
  return lines.join('\n');
}

// ============================================================================
// SECTION 15: DIFF & EMISSION
// ============================================================================

/**
 * Generate all combinations of prop-axis values where at least 2 axes
 * have non-default values.  Used to emit explicit cross-axis CSS rules
 * (e.g. `.button--secondary.button--large`) so every variant combination
 * gets exact styles rather than relying on CSS cascade to merge diffs.
 */
function generateCrossAxisCombos(
  axes: VariantAxis[],
  defaultLookup: Record<string, string>,
): Record<string, string>[] {
  // Collect only axes that actually have non-default values
  const nonDefaultAxes = axes
    .map((a) => ({
      name: a.name,
      nonDefaults: a.values.filter((v) => v !== (defaultLookup[a.name] ?? a.values[0])),
    }))
    .filter((a) => a.nonDefaults.length > 0);

  if (nonDefaultAxes.length < 2) return [];

  const result: Record<string, string>[] = [];

  function recurse(index: number, current: Record<string, string>): void {
    // Only collect combinations involving at least 2 axes
    if (Object.keys(current).length >= 2) {
      result.push({ ...current });
    }
    if (index >= nonDefaultAxes.length) return;

    const axis = nonDefaultAxes[index];
    // Branch 1: skip this axis (leave it at default for this combo)
    recurse(index + 1, current);
    // Branch 2: include each non-default value of this axis
    for (const val of axis.nonDefaults) {
      recurse(index + 1, { ...current, [axis.name]: val });
    }
  }

  recurse(0, {});
  return result;
}

function emitDiffRules(
  lines: string[],
  base: string,
  selector: string,
  baseStyles: VariantStyles,
  variantStyles: VariantStyles,
  fps?: Set<string>,
  renameMap?: Map<string, string>,
): void {
  const cDiff = diffStyles(baseStyles.container, variantStyles.container);
  if (Object.keys(cDiff).length > 0) maybeEmit(lines, selector, cDiff, fps);

  const allKeys = new Set([...Object.keys(baseStyles.children), ...Object.keys(variantStyles.children)]);
  for (const key of allKeys) {
    const diff = diffStyles(baseStyles.children[key] ?? {}, variantStyles.children[key] ?? {});
    // Keep icon color diffs — SVGs preserve original Figma colors
    const effectiveKey = renameMap ? applyRenameMap(key, renameMap) : key;
    if (Object.keys(diff).length > 0) maybeEmit(lines, `${selector} .${base}__${effectiveKey}`, diff, fps);
  }
}

function maybeEmit(lines: string[], selector: string, props: Record<string, string>, fps?: Set<string>): void {
  const body = Object.entries(props).map(([p, v]) => `  ${p}: ${v};`).join('\n');
  const fp   = `${selector}||${body}`;
  if (fps) { if (fps.has(fp)) return; fps.add(fp); }
  lines.push('', `${selector} {`, body, '}');
}

function buildStateSelector(baseSelector: string, cs: ClassifiedState): string {
  const clean = baseSelector.replace(/[()[\]]/g, '');
  let sel = clean;
  if (cs.booleanCondition) {
    const lo = cs.booleanCondition.toLowerCase();
    const kb = toKebabCase(cs.booleanCondition);
    sel += KNOWN_BOOLEAN_STATES[lo] ?? KNOWN_BOOLEAN_STATES[kb] ?? `[data-${kb}]`;
  }
  if (cs.cssSelector) sel += cs.cssSelector;
  return sel;
}

function emitStateOverrides(
  data: ComponentSetData, lines: string[], base: string, baseSel: string,
  baseLookup: Record<string, string>, baseVariant: VariantEntry,
  findVariant: (p: Record<string, string>) => VariantEntry | undefined,
  sourceComments?: boolean, fps?: Set<string>,
  renameMap?: Map<string, string>,
): void {
  for (const cs of data.classifiedStates) {
    if (cs.cssSelector === '' && cs.booleanCondition === null) continue;
    const stateVariant = findVariant({ ...baseLookup, [data.stateAxis!.name]: cs.originalValue });
    if (!stateVariant) continue;
    if (sourceComments) lines.push('', `/* state: ${cs.originalValue} */`);
    emitDiffRules(lines, base, buildStateSelector(baseSel, cs), baseVariant.styles, stateVariant.styles, fps, renameMap);
  }
}

function diffStyles(base: Record<string, string>, variant: Record<string, string>): Record<string, string> {
  const diff: Record<string, string> = {};
  for (const [k, v] of Object.entries(variant)) { if (base[k] !== v) diff[k] = v; }
  for (const k of Object.keys(base)) {
    if (!(k in variant)) diff[k] = (k === 'background-color' || k === 'background') ? 'transparent' : 'unset';
  }
  return diff;
}

// ============================================================================
// SECTION 16: PUBLIC UTILITIES
// ============================================================================

export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/\s+/g, '-')
    // Strip characters invalid in CSS class names and JS identifiers
    .replace(/[()[\]/\\'",.:;!?@#$%^&*+=|~`<>{}]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

export function toCamelCase(str: string): string {
  return str
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^[A-Z]/, (c) => c.toLowerCase());
}

/** Generates a :root CSS tokens block + all theme-mode overrides */
export function buildTokensCSS(data: ComponentSetData): string {
  const vars = Object.values(data.resolvedVariables);
  if (vars.length === 0) return '';
  const lines = [':root {'];
  for (const v of vars) lines.push(`  ${v.cssVarName}: ${v.value}; /* ${v.name} */`);
  lines.push('}');

  for (const [modeName, modeCSS] of Object.entries(data.variableModesCSS)) {
    lines.push('', `/* Theme: ${modeName} */`, modeCSS);
  }
  return lines.join('\n');
}

/** Returns a JSON-serialisable summary for codegen / documentation */
export function summarizeComponent(data: ComponentSetData): object {
  return {
    name:            data.name,
    nodeId:          data.nodeId,
    category:        data.componentCategory,
    htmlTag:         data.suggestedHtmlTag,
    ariaRole:        data.suggestedAriaRole,
    isInteractive:   data.isInteractive,
    propAxes:        data.propAxes.map((a) => ({ name: a.name, values: a.values })),
    stateAxis:       data.stateAxis ? { name: data.stateAxis.name, states: data.classifiedStates } : null,
    booleanProps:    data.booleanProps,
    iconSlots:       data.iconSlotProperties.map((p) => p.name),
    textSlots:       data.textContentProperties.map((p) => p.name),
    booleanSlots:    data.booleanVisibilityProperties.map((p) => p.name),
    cssTokensUsed:   data.cssTokensReferenced,
    variableModes:   Object.keys(data.variableModesCSS),
    variantCount:    data.variants.length,
    childLayers:     data.childLayers.map((l) => ({
      key:            l.key,
      type:           l.nodeType,
      isIcon:         l.isIcon,
      isText:         l.isText,
      isImage:        l.isImage,
      imageScaleMode: l.imageScaleMode,
      hasInlineRuns:  (l.inlineRuns?.length ?? 0) > 0,
      hasVectorInfo:  !!l.vectorInfo,
    })),
  };
}
