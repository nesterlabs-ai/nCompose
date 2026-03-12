/**
 * Figma Style Extractor for shadcn/ui Codegen
 *
 * Extracts raw style data from ALL Figma variant nodes.
 * Drills into child nodes to find the actual styled element (e.g. input box inside a form field).
 * Handles enhanced nodes from extractCompleteDesign() (padding is node.padding.top, not node.paddingTop).
 */

export interface ExtractedStyle {
  /** Root wrapper styles */
  bg?: string;
  textColor?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  fontSize?: number;
  fontWeight?: number;
  gap?: number;
  width?: number;
  height?: number;
  opacity?: number;
  shadow?: string;
  /** Nested "main element" styles (e.g. the input box inside a form field wrapper) */
  innerBg?: string;
  innerBorderColor?: string;
  innerBorderWidth?: number;
  innerBorderRadius?: number;
  innerHeight?: number;
  innerPaddingH?: number;
  innerPaddingV?: number;
  innerShadow?: string;
  /** Label text color (separate from input text) */
  labelColor?: string;
  /** Placeholder / helper text color */
  placeholderColor?: string;
  /** Error text color */
  errorColor?: string;
}

export interface VariantStyles {
  byVariant: Record<string, ExtractedStyle>;
  bySize: Record<string, ExtractedStyle>;
  byVariantState: Record<string, ExtractedStyle>;
  defaultStyle: ExtractedStyle;
}

// ── Color helpers ──────────────────────────────────────────────────────

function rgbaToHex(color: any): string | undefined {
  if (!color || typeof color.r !== 'number') return undefined;
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  let hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
  if (typeof color.a === 'number' && color.a < 0.99) {
    hex += Math.round(color.a * 255).toString(16).padStart(2, '0').toUpperCase();
  }
  return hex;
}

function extractSolidColor(fills: any): string | undefined {
  if (!Array.isArray(fills)) return undefined;
  const solid = fills.find((f: any) => f.type === 'SOLID' && f.visible !== false);
  if (!solid?.color) return undefined;
  return rgbaToHex({ ...solid.color, a: solid.opacity ?? solid.color.a ?? 1 });
}

function extractBgColor(node: any): string | undefined {
  return extractSolidColor(node?.fills ?? node?.background);
}

function extractStroke(node: any): { color?: string; width?: number } {
  const strokes = node?.strokes;
  if (!Array.isArray(strokes) || strokes.length === 0) return {};
  const stroke = strokes.find((s: any) => s.type === 'SOLID' && s.visible !== false);
  if (!stroke?.color) return {};
  return {
    color: rgbaToHex({ ...stroke.color, a: stroke.opacity ?? stroke.color.a ?? 1 }),
    width: node.strokeWeight ?? node.individualStrokeWeights?.top ?? 1,
  };
}

function extractShadow(node: any): string | undefined {
  const effects = node?.effects;
  if (!Array.isArray(effects)) return undefined;
  const shadow = effects.find((e: any) =>
    (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') && e.visible !== false
  );
  if (!shadow) return undefined;
  const color = shadow.color ? rgbaToHex(shadow.color) : '#000000';
  const x = shadow.offset?.x ?? 0;
  const y = shadow.offset?.y ?? 0;
  const blur = shadow.radius ?? 0;
  const spread = shadow.spread ?? 0;
  const inset = shadow.type === 'INNER_SHADOW' ? 'inset ' : '';
  return `${inset}${x}px ${y}px ${blur}px ${spread}px ${color}`;
}

// ── Padding helpers (handles both raw and enhanced formats) ───────────

function getPadding(node: any): { top?: number; right?: number; bottom?: number; left?: number } {
  // Enhanced format: node.padding = { top, right, bottom, left }
  if (node?.padding && typeof node.padding === 'object' && !Array.isArray(node.padding)) {
    return {
      top: node.padding.top,
      right: node.padding.right,
      bottom: node.padding.bottom,
      left: node.padding.left,
    };
  }
  // Raw Figma format
  return {
    top: node?.paddingTop,
    right: node?.paddingRight,
    bottom: node?.paddingBottom,
    left: node?.paddingLeft,
  };
}

function getNodeDimensions(node: any): { width?: number; height?: number } {
  return {
    width: node?.absoluteBoundingBox?.width ?? node?.size?.x ?? node?.width,
    height: node?.absoluteBoundingBox?.height ?? node?.size?.y ?? node?.height,
  };
}

// ── Node tree helpers ─────────────────────────────────────────────────

function findFirstTextNode(node: any): any {
  if (!node) return null;
  if (node.type === 'TEXT') return node;
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const found = findFirstTextNode(child);
      if (found) return found;
    }
  }
  return null;
}

/** Find a TEXT node whose name (or parent name) matches a hint pattern */
function findTextByNameHint(node: any, hints: RegExp): any {
  if (!node) return null;
  if (node.type === 'TEXT' && hints.test((node.name ?? '').toLowerCase())) return node;
  if (Array.isArray(node.children)) {
    // Check if this container matches the hint
    if (hints.test((node.name ?? '').toLowerCase())) {
      const text = findFirstTextNode(node);
      if (text) return text;
    }
    for (const child of node.children) {
      const found = findTextByNameHint(child, hints);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Find the "main interactive element" inside a variant node.
 * For input fields: the actual input box (not the outer label+description wrapper).
 * For buttons: the button frame itself.
 *
 * Heuristics:
 * - Look for a child frame with strokes (border) — that's usually the input box
 * - Look for child named "input", "field", "text field", "container", "box"
 * - If none found, return the root node itself
 */
function findMainElement(node: any): any {
  if (!node || !Array.isArray(node.children)) return node;

  const nameHints = /\binput\b|\bfield\b|\btext.?field\b|\bcontainer\b|\bbox\b|\bbase\b|\bwrapper\b/i;

  // First pass: look for child whose name matches
  for (const child of node.children) {
    if (child.type === 'FRAME' || child.type === 'INSTANCE' || child.type === 'COMPONENT') {
      if (nameHints.test(child.name ?? '')) return child;
    }
  }

  // Second pass: look for a child with strokes (border = likely the input box)
  for (const child of node.children) {
    if (child.type === 'FRAME' || child.type === 'INSTANCE' || child.type === 'COMPONENT') {
      if (Array.isArray(child.strokes) && child.strokes.length > 0) {
        const hasVisibleStroke = child.strokes.some((s: any) => s.visible !== false && s.type === 'SOLID');
        if (hasVisibleStroke) return child;
      }
    }
  }

  // Third pass: look for a child with fills (background = likely a styled container)
  for (const child of node.children) {
    if (child.type === 'FRAME' || child.type === 'INSTANCE' || child.type === 'COMPONENT') {
      if (Array.isArray(child.fills) && child.fills.length > 0) {
        const hasVisibleFill = child.fills.some((f: any) => f.visible !== false && f.type === 'SOLID');
        if (hasVisibleFill && Array.isArray(child.children) && child.children.length > 0) return child;
      }
    }
  }

  // Recurse one level: check grandchildren
  for (const child of node.children) {
    if (Array.isArray(child.children)) {
      const found = findMainElement(child);
      if (found !== child) return found;
    }
  }

  return node;
}

// ── Main extraction ───────────────────────────────────────────────────

/**
 * Extract comprehensive styles from a single variant node.
 * Drills into children to find the actual styled element.
 */
export function extractNodeStyle(node: any): ExtractedStyle {
  if (!node) return {};

  const rootStroke = extractStroke(node);
  const rootPad = getPadding(node);
  const rootDim = getNodeDimensions(node);
  const textNode = findFirstTextNode(node);

  // Find the main interactive element (e.g. input box)
  const mainEl = findMainElement(node);
  const isNested = mainEl !== node;

  const result: ExtractedStyle = {
    bg: extractBgColor(node),
    textColor: textNode ? extractSolidColor(textNode.fills) : undefined,
    borderColor: rootStroke.color,
    borderWidth: rootStroke.width,
    borderRadius: node.cornerRadius ?? node.rectangleCornerRadii?.[0],
    paddingTop: rootPad.top,
    paddingRight: rootPad.right,
    paddingBottom: rootPad.bottom,
    paddingLeft: rootPad.left,
    fontSize: textNode?.style?.fontSize ?? textNode?.fontSize,
    fontWeight: textNode?.style?.fontWeight ?? textNode?.fontWeight,
    gap: node.itemSpacing,
    width: rootDim.width,
    height: rootDim.height,
    opacity: node.opacity !== undefined && node.opacity < 1 ? node.opacity : undefined,
    shadow: extractShadow(node),
  };

  // Extract inner element styles (the actual input box / button frame)
  if (isNested) {
    const innerStroke = extractStroke(mainEl);
    const innerPad = getPadding(mainEl);
    const innerDim = getNodeDimensions(mainEl);
    const innerText = findFirstTextNode(mainEl);

    result.innerBg = extractBgColor(mainEl);
    result.innerBorderColor = innerStroke.color;
    result.innerBorderWidth = innerStroke.width;
    result.innerBorderRadius = mainEl.cornerRadius ?? mainEl.rectangleCornerRadii?.[0];
    result.innerHeight = innerDim.height;
    result.innerPaddingH = innerPad.left ?? innerPad.right;
    result.innerPaddingV = innerPad.top ?? innerPad.bottom;
    result.innerShadow = extractShadow(mainEl);

    // Override text color from the inner element's text if different
    if (innerText) {
      const innerTextColor = extractSolidColor(innerText.fills);
      if (innerTextColor) result.textColor = innerTextColor;
    }
  }

  // Extract label/placeholder/error colors from named text nodes
  const labelNode = findTextByNameHint(node, /\blabel\b/);
  if (labelNode) result.labelColor = extractSolidColor(labelNode.fills);

  const placeholderNode = findTextByNameHint(node, /\bplaceholder\b|\bhint\b|\bdescription\b/);
  if (placeholderNode) result.placeholderColor = extractSolidColor(placeholderNode.fills);

  const errorNode = findTextByNameHint(node, /\berror\b/);
  if (errorNode) result.errorColor = extractSolidColor(errorNode.fills);

  // Remove undefined values
  return Object.fromEntries(Object.entries(result).filter(([_, v]) => v !== undefined)) as ExtractedStyle;
}

// ── Variant name parsing ──────────────────────────────────────────────

function parseVariantName(name: string): Record<string, string> {
  const props: Record<string, string> = {};
  for (const part of name.split(',').map(s => s.trim())) {
    const eq = part.indexOf('=');
    if (eq > 0) props[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return props;
}

/**
 * Normalize a Figma state name to a CSS-friendly kebab-case string.
 * "Filled in" → "filled-in", "Filled in - Hover" → "filled-in-hover"
 */
export function normalizeStateName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s*-\s*/g, '-')  // "Filled in - Hover" → "filled in-hover"
    .replace(/\s+/g, '-');      // "filled in-hover" → "filled-in-hover"
}

/**
 * Normalize a Figma variant/style name to a CSS-friendly kebab-case string.
 * Strips parenthetical suffixes: "Primary (Action Violet)" → "primary"
 * "Secondary (Brand Purple)" → "secondary"
 * "Subtle" → "subtle"
 */
export function normalizeVariantName(name: string): string {
  return name
    .trim()
    .replace(/\s*\([^)]*\)\s*/g, '')  // strip "(Action Violet)", "(Brand Purple)", etc.
    .toLowerCase()
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, '-');
}

const DEFAULT_STATE_VALUES = new Set([
  'default', 'rest', 'resting', 'normal', 'idle', 'enabled', 'base',
]);
const STATE_KEYWORDS = new Set([
  'default', 'rest', 'hover', 'focus', 'focused', 'active', 'pressed',
  'disabled', 'loading', 'error', 'selected', 'typing', 'filled',
]);
const SIZE_NAMES = new Set(['size']);

function classifyAxes(variantNodes: any[]) {
  const axisValues: Record<string, Set<string>> = {};
  for (const node of variantNodes) {
    for (const [k, v] of Object.entries(parseVariantName(node.name ?? ''))) {
      (axisValues[k] ??= new Set()).add(v);
    }
  }

  let stateAxis: string | null = null;
  let sizeAxis: string | null = null;
  const variantAxes: string[] = [];

  for (const [axis, values] of Object.entries(axisValues)) {
    const lower = axis.toLowerCase().trim();
    if (!stateAxis && lower === 'state') { stateAxis = axis; continue; }
    if (!stateAxis && [...values].filter(v => STATE_KEYWORDS.has(v.toLowerCase().split(/[\s-]+/)[0])).length >= 2) { stateAxis = axis; continue; }
    if (!sizeAxis && SIZE_NAMES.has(lower)) { sizeAxis = axis; continue; }
    variantAxes.push(axis);
  }
  return { stateAxis, sizeAxis, variantAxes };
}

// ── Main export ───────────────────────────────────────────────────────

export function extractVariantStyles(rootNode: any): VariantStyles {
  const variantNodes: any[] = rootNode?.children ?? [];
  if (variantNodes.length === 0) return { byVariant: {}, bySize: {}, byVariantState: {}, defaultStyle: {} };

  const { stateAxis, sizeAxis, variantAxes } = classifyAxes(variantNodes);
  const byVariant: Record<string, ExtractedStyle> = {};
  const bySize: Record<string, ExtractedStyle> = {};
  const byVariantState: Record<string, ExtractedStyle> = {};
  let defaultStyle: ExtractedStyle = {};

  for (const node of variantNodes) {
    const props = parseVariantName(node.name ?? '');
    const style = extractNodeStyle(node);

    const rawStateValue = stateAxis ? (props[stateAxis] ?? 'Default') : 'Default';
    const isDefault = DEFAULT_STATE_VALUES.has(rawStateValue.toLowerCase().split(/[\s-]+/)[0]);
    const variantKey = variantAxes.map(ax => normalizeVariantName(props[ax] ?? '')).filter(Boolean).join('|') || 'default';
    const sizeValue = sizeAxis ? (props[sizeAxis] ?? '') : '';

    if (isDefault && !byVariant[variantKey]) byVariant[variantKey] = style;
    if (isDefault && sizeValue && !bySize[sizeValue]) bySize[sizeValue] = style;
    if (!isDefault) {
      // Use normalized state name as key
      const normalizedState = normalizeStateName(rawStateValue);
      byVariantState[`${variantKey}|${normalizedState}`] = style;
    }
    if (isDefault && Object.keys(defaultStyle).length === 0) defaultStyle = style;
  }

  return { byVariant, bySize, byVariantState, defaultStyle };
}

// ── Prompt formatting ─────────────────────────────────────────────────

export function formatStylesForPrompt(styles: VariantStyles): string {
  const lines: string[] = ['## Figma Design Styles\n'];

  if (Object.keys(styles.defaultStyle).length > 0) {
    lines.push('### Default Style');
    lines.push(fmtStyle(styles.defaultStyle), '');
  }
  if (Object.keys(styles.byVariant).length > 0) {
    lines.push('### Styles by Variant (State=Default)');
    for (const [v, s] of Object.entries(styles.byVariant)) { lines.push(`\n**${v}:**`); lines.push(fmtStyle(s)); }
    lines.push('');
  }
  if (Object.keys(styles.bySize).length > 0) {
    lines.push('### Styles by Size (State=Default)');
    for (const [v, s] of Object.entries(styles.bySize)) { lines.push(`\n**${v}:**`); lines.push(fmtStyle(s)); }
    lines.push('');
  }
  if (Object.keys(styles.byVariantState).length > 0) {
    lines.push('### Styles by Variant × State');
    for (const [key, s] of Object.entries(styles.byVariantState)) {
      const parts = key.split('|');
      const state = parts.pop();
      const variant = parts.join('|') || 'Default';
      lines.push(`\n**${variant} / ${state}:**`);
      lines.push(fmtStyle(s));
    }
    lines.push('');
  }
  return lines.join('\n');
}

function fmtStyle(s: ExtractedStyle): string {
  const p: string[] = [];
  // Root styles
  if (s.bg) p.push(`  background: ${s.bg}`);
  if (s.textColor) p.push(`  text-color: ${s.textColor}`);
  if (s.borderColor) p.push(`  border: ${s.borderWidth ?? 1}px ${s.borderColor}`);
  if (s.borderRadius !== undefined) p.push(`  border-radius: ${s.borderRadius}px`);
  if (s.paddingTop !== undefined) p.push(`  padding: ${s.paddingTop ?? 0}px ${s.paddingRight ?? 0}px ${s.paddingBottom ?? 0}px ${s.paddingLeft ?? 0}px`);
  if (s.fontSize) p.push(`  font-size: ${s.fontSize}px`);
  if (s.fontWeight) p.push(`  font-weight: ${s.fontWeight}`);
  if (s.gap !== undefined) p.push(`  gap: ${s.gap}px`);
  if (s.width) p.push(`  width: ${s.width}px`);
  if (s.height) p.push(`  height: ${s.height}px`);
  if (s.opacity !== undefined) p.push(`  opacity: ${s.opacity}`);
  if (s.shadow) p.push(`  box-shadow: ${s.shadow}`);
  // Inner element styles (input box, etc.)
  if (s.innerBg) p.push(`  inner-background: ${s.innerBg}`);
  if (s.innerBorderColor) p.push(`  inner-border: ${s.innerBorderWidth ?? 1}px ${s.innerBorderColor}`);
  if (s.innerBorderRadius !== undefined) p.push(`  inner-border-radius: ${s.innerBorderRadius}px`);
  if (s.innerHeight) p.push(`  inner-height: ${s.innerHeight}px`);
  if (s.innerPaddingH !== undefined) p.push(`  inner-padding-horizontal: ${s.innerPaddingH}px`);
  if (s.innerPaddingV !== undefined) p.push(`  inner-padding-vertical: ${s.innerPaddingV}px`);
  if (s.innerShadow) p.push(`  inner-box-shadow: ${s.innerShadow}`);
  // Named text colors
  if (s.labelColor) p.push(`  label-color: ${s.labelColor}`);
  if (s.placeholderColor) p.push(`  placeholder-color: ${s.placeholderColor}`);
  if (s.errorColor) p.push(`  error-color: ${s.errorColor}`);
  return p.join('\n');
}
