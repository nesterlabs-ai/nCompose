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
  innerWidth?: number;
  innerHeight?: number;
  innerPaddingH?: number;
  innerPaddingV?: number;
  innerShadow?: string;
  /** How the inner element sizes itself: 'FILL' (stretch to parent), 'FIXED', or 'HUG' */
  innerWidthSizing?: string;
  /** Label text color (separate from input text) */
  labelColor?: string;
  /** Placeholder / helper text color */
  placeholderColor?: string;
  /** Error text color */
  errorColor?: string;
  /** Icon stroke/fill color */
  iconColor?: string;
  /** Component structure tree extracted from Figma (e.g. "Input[border,bg,rounded] > {MagnifyingGlass(icon), Value(text)}") */
  structure?: string;
  /** Per-text-node typography info (name, fontSize, fontWeight, color) */
  textStyles?: Array<{ name: string; fontSize?: number; fontWeight?: number; color?: string }>;
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

/** Format a single shadow effect object into a CSS-like string */
function formatShadowEffect(shadow: any): string | undefined {
  if (!shadow) return undefined;
  const color = shadow.color ? rgbaToHex(shadow.color) : '#000000';
  const x = shadow.offset?.x ?? 0;
  const y = shadow.offset?.y ?? 0;
  const blur = shadow.radius ?? 0;
  const spread = shadow.spread ?? 0;
  const inset = shadow.type === 'INNER_SHADOW' ? 'inset ' : '';
  return `${inset}${x}px ${y}px ${blur}px ${spread}px ${color}`;
}

function extractShadow(node: any): string | undefined {
  const effects = node?.effects;
  if (!Array.isArray(effects)) return undefined;
  const shadow = effects.find((e: any) =>
    (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') && e.visible !== false
  );
  return formatShadowEffect(shadow);
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

// ── Icon color extraction ─────────────────────────────────────────────

/**
 * Find the first icon-like node (INSTANCE with VECTOR children, or small FRAME)
 * and extract its stroke/fill color. This gives us the actual Figma icon color.
 */
function extractIconColor(node: any): string | undefined {
  if (!node || !Array.isArray(node.children)) return undefined;

  for (const child of node.children) {
    // Check ELLIPSE nodes (colored dots, status indicators)
    if (child.type === 'ELLIPSE') {
      const fillColor = extractSolidColor(child.fills);
      if (fillColor) return fillColor;
    }
    // Check INSTANCE nodes (icon components)
    if (child.type === 'INSTANCE') {
      const color = getDeepVectorColor(child);
      if (color) return color;
    }
    // Check small FRAMEs that might be icons
    const dim = getNodeDimensions(child);
    if (child.type === 'FRAME' && dim.width && dim.width <= 32 && dim.height && dim.height <= 32) {
      const color = getDeepVectorColor(child);
      if (color) return color;
    }
    // Recurse into container children (e.g. Input frame contains icon)
    if (child.type === 'FRAME' && Array.isArray(child.children)) {
      const nested = extractIconColor(child);
      if (nested) return nested;
    }
  }
  return undefined;
}

/** Walk into a node tree to find the first VECTOR with a stroke or fill color */
function getDeepVectorColor(node: any): string | undefined {
  if (!node) return undefined;
  if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION') {
    // Try stroke first (most icons use strokes)
    const strokeColor = extractSolidColor(node.strokes);
    if (strokeColor) return strokeColor;
    // Fall back to fill
    const fillColor = extractSolidColor(node.fills);
    if (fillColor) return fillColor;
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const color = getDeepVectorColor(child);
      if (color) return color;
    }
  }
  return undefined;
}

// ── Structure extraction ──────────────────────────────────────────────

/**
 * Extract a human-readable component structure tree from a Figma variant node.
 * Includes ACTUAL VALUES (colors, sizes, gaps, padding, radius) so the LLM
 * can replicate the design exactly without guessing.
 */
function extractStructureTree(node: any, depth: number = 0): string {
  if (!node || depth > 6) return '';

  const children = node.children;
  if (!Array.isArray(children) || children.length === 0) return '';

  const parts: string[] = [];
  for (const child of children) {
    if ((child.name ?? '').startsWith('_')) continue; // skip hidden by naming convention
    if (child.visible === false) continue; // skip invisible nodes entirely — prevents LLM hallucination
    const type = classifyChildType(child);
    const traits = getNodeTraits(child);

    // For INSTANCE nodes, include componentProperties (e.g. checked=true, value="Option")
    // This tells the LLM what kind of component this is and its current state
    if (child.type === 'INSTANCE') {
      const props = child.componentProperties ?? child.componentPropertyValues;
      if (props && typeof props === 'object') {
        for (const [k, v] of Object.entries(props as Record<string, any>)) {
          // Strip Figma ID suffix from key: "Error#280:88" → "Error"
          const cleanKey = k.replace(/#[\d:]+$/, '');
          const val = typeof v === 'object' && v !== null ? (v.value ?? v) : v;
          if (val !== undefined && val !== '') traits.push(`${cleanKey}=${val}`);
        }
      }
    }

    const traitsStr = traits.length > 0 ? `[${traits.join(', ')}]` : '';
    const childStructure = extractStructureTree(child, depth + 1);

    if (childStructure) {
      parts.push(`${child.name}(${type})${traitsStr} > {${childStructure}}`);
    } else {
      parts.push(`${child.name}(${type})${traitsStr}`);
    }
  }
  return parts.join(', ');
}

function classifyChildType(node: any): string {
  if (node.type === 'TEXT') return 'text';
  if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION') return 'vector';
  if (node.type === 'INSTANCE') {
    const dim = getNodeDimensions(node);
    if (dim.width && dim.width <= 32 && dim.height && dim.height <= 32) return 'icon';
    return 'instance';
  }
  if (node.type === 'COMPONENT') return 'component';
  if (node.type === 'FRAME') return 'frame';
  return node.type?.toLowerCase() ?? 'unknown';
}

/**
 * Extract actual Figma values for a node — not just trait labels but real numbers and colors.
 * This is what the LLM reads to build the exact Tailwind classes.
 */
function getNodeTraits(node: any): string[] {
  const traits: string[] = [];

  // Dimensions — emit for all non-text nodes directly from Figma data
  const dim = getNodeDimensions(node);
  if (dim.width && dim.height && node.type !== 'TEXT') {
    traits.push(`${Math.round(dim.width)}px×${Math.round(dim.height)}px`);
  }

  // Background fill with actual color + opacity
  const fills = node.fills ?? node.background;
  if (Array.isArray(fills)) {
    for (const f of fills) {
      if (f.visible !== false && f.type === 'SOLID' && f.color) {
        const hex = rgbaToHex(f.color);
        const opacity = f.opacity !== undefined && f.opacity < 1 ? `(${f.opacity})` : '';
        if (hex) traits.push(`bg:${hex}${opacity}`);
      }
    }
  }

  // Border stroke with actual color
  if (Array.isArray(node.strokes)) {
    for (const s of node.strokes) {
      if (s.visible !== false && s.type === 'SOLID' && s.color) {
        const hex = rgbaToHex(s.color);
        const w = node.strokeWeight ?? 1;
        if (hex) traits.push(`border:${w}px ${hex}`);
      }
    }
  }

  // Corner radius with actual value
  if (node.cornerRadius && node.cornerRadius > 0) traits.push(`radius:${node.cornerRadius}px`);

  // Padding with actual values
  const pad = getPadding(node);
  if (pad.top || pad.left || pad.right || pad.bottom) {
    traits.push(`pad:${pad.top ?? 0}px/${pad.right ?? 0}px/${pad.bottom ?? 0}px/${pad.left ?? 0}px`);
  }

  // Gap with actual value
  if (node.itemSpacing !== undefined && node.itemSpacing > 0) traits.push(`gap:${node.itemSpacing}px`);

  // Layout direction + alignment (from Figma auto-layout)
  if (node.layoutMode === 'HORIZONTAL') traits.push('flex-row');
  else if (node.layoutMode === 'VERTICAL') traits.push('flex-col');

  // Cross-axis alignment: counterAxisAlignItems
  if (node.counterAxisAlignItems === 'CENTER') traits.push('items-center');
  else if (node.counterAxisAlignItems === 'MAX') traits.push('items-end');
  else if (node.counterAxisAlignItems === 'MIN') traits.push('items-start');

  // Main-axis alignment: primaryAxisAlignItems
  if (node.primaryAxisAlignItems === 'CENTER') traits.push('justify-center');
  else if (node.primaryAxisAlignItems === 'MAX') traits.push('justify-end');
  else if (node.primaryAxisAlignItems === 'MIN') traits.push('justify-start');
  else if (node.primaryAxisAlignItems === 'SPACE_BETWEEN') traits.push('justify-between');

  // Self alignment within parent
  if (node.layoutAlign === 'STRETCH') traits.push('self-stretch');
  else if (node.layoutAlign === 'CENTER') traits.push('self-center');
  else if (node.layoutAlign === 'MIN') traits.push('self-start');
  else if (node.layoutAlign === 'MAX') traits.push('self-end');

  // Layout sizing mode (how this node sizes within its parent's auto-layout)
  const hSizing = node.layoutSizingHorizontal ?? (node.layoutGrow === 1 ? 'FILL' : undefined);
  const vSizing = node.layoutSizingVertical;
  if (hSizing === 'FILL') traits.push('w:fill-parent');
  else if (hSizing === 'HUG') traits.push('w:hug-contents');
  if (vSizing === 'FILL') traits.push('h:fill-parent');
  else if (vSizing === 'HUG') traits.push('h:hug-contents');

  // Text alignment from Figma
  if (node.type === 'TEXT') {
    const textAlign = node.style?.textAlignHorizontal ?? node.textAlignHorizontal;
    if (textAlign === 'CENTER') traits.push('text-center');
    else if (textAlign === 'RIGHT') traits.push('text-right');
  }

  // Shadow with actual values
  if (Array.isArray(node.effects)) {
    for (const e of node.effects) {
      if (e.visible !== false && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW')) {
        const shadowStr = formatShadowEffect(e);
        if (shadowStr) traits.push(`shadow:${shadowStr}`);
      }
    }
  }

  // Opacity
  if (node.opacity !== undefined && node.opacity < 1) traits.push(`opacity:${node.opacity}`);

  // TEXT node: include font details and color
  if (node.type === 'TEXT') {
    const style = node.style ?? {};
    const chars = (node.characters ?? '').slice(0, 40);
    if (chars) traits.push(`"${chars}"`);
    if (style.fontSize) traits.push(`${style.fontSize}px`);
    if (style.fontWeight) traits.push(`weight:${style.fontWeight}`);
    if (style.fontFamily) traits.push(`font:${style.fontFamily}`);
    const textColor = extractSolidColor(node.fills);
    if (textColor) traits.push(`color:${textColor}`);
  }

  // VECTOR node: include stroke color (icon color)
  if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION') {
    const strokeColor = extractSolidColor(node.strokes);
    if (strokeColor) traits.push(`stroke:${strokeColor}`);
    const fillColor = extractSolidColor(node.fills);
    if (fillColor) traits.push(`fill:${fillColor}`);
  }

  return traits;
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
    result.innerWidth = innerDim.width;
    result.innerHeight = innerDim.height;
    result.innerPaddingH = innerPad.left ?? innerPad.right;
    result.innerPaddingV = innerPad.top ?? innerPad.bottom;
    result.innerShadow = extractShadow(mainEl);

    // Capture how the inner element sizes itself (FILL = stretch to parent width)
    const hSizing = mainEl.layoutSizingHorizontal ?? (mainEl.layoutGrow === 1 ? 'FILL' : undefined);
    if (hSizing) result.innerWidthSizing = hSizing;

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

  // Extract icon color from INSTANCE/VECTOR children
  result.iconColor = extractIconColor(node);

  // Extract per-text-node typography (all TEXT nodes with name, fontSize, fontWeight, color)
  const textStyles: Array<{ name: string; fontSize?: number; fontWeight?: number; color?: string }> = [];
  (function walkTexts(n: any) {
    if (!n) return;
    if (n.type === 'TEXT' && n.characters?.trim()) {
      textStyles.push({
        name: n.name || n.characters.trim().slice(0, 20),
        fontSize: n.style?.fontSize ?? n.fontSize,
        fontWeight: n.style?.fontWeight ?? n.fontWeight,
        color: extractSolidColor(n.fills),
      });
    }
    if (Array.isArray(n.children)) for (const c of n.children) walkTexts(c);
  })(node);
  if (textStyles.length > 1) result.textStyles = textStyles;

  // Extract component structure tree
  const structure = extractStructureTree(node);
  if (structure) result.structure = structure;

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
    const normalizedSize = sizeValue ? normalizeVariantName(sizeValue) : '';

    if (isDefault && !byVariant[variantKey]) byVariant[variantKey] = style;
    if (isDefault && sizeValue && !bySize[sizeValue]) bySize[sizeValue] = style;
    if (!isDefault) {
      // Include size in the key when size axis exists, so all combos are preserved
      const normalizedState = normalizeStateName(rawStateValue);
      const stateKey = normalizedSize
        ? `${variantKey}|${normalizedSize}|${normalizedState}`
        : `${variantKey}|${normalizedState}`;
      byVariantState[stateKey] = style;
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
  if (s.innerWidth) p.push(`  inner-width: ${s.innerWidth}px`);
  if (s.innerHeight) p.push(`  inner-height: ${s.innerHeight}px`);
  if (s.innerWidthSizing) p.push(`  inner-width-sizing: ${s.innerWidthSizing.toLowerCase()}`);
  if (s.innerPaddingH !== undefined) p.push(`  inner-padding-horizontal: ${s.innerPaddingH}px`);
  if (s.innerPaddingV !== undefined) p.push(`  inner-padding-vertical: ${s.innerPaddingV}px`);
  if (s.innerShadow) p.push(`  inner-box-shadow: ${s.innerShadow}`);
  // Named text colors
  if (s.labelColor) p.push(`  label-color: ${s.labelColor}`);
  if (s.placeholderColor) p.push(`  placeholder-color: ${s.placeholderColor}`);
  if (s.errorColor) p.push(`  error-color: ${s.errorColor}`);
  if (s.iconColor) p.push(`  icon-color: ${s.iconColor}`);
  // Per-text-node typography
  if (s.textStyles && s.textStyles.length > 0) {
    p.push(`  text-elements:`);
    for (const ts of s.textStyles) {
      const parts = [`    - "${ts.name}"`];
      if (ts.fontSize) parts.push(`${ts.fontSize}px`);
      if (ts.fontWeight) parts.push(`weight ${ts.fontWeight}`);
      if (ts.color) parts.push(ts.color);
      p.push(parts.join(' '));
    }
  }
  // Full structure tree with actual values — this is the source of truth
  if (s.structure) {
    p.push('');
    p.push('  COMPONENT TREE (use these exact values):');
    // Format the structure tree with indentation for readability
    const formatted = s.structure
      .replace(/> \{/g, '>\n    ')
      .replace(/\}, /g, '\n    ')
      .replace(/\}$/g, '');
    p.push(`    ${formatted}`);
  }
  return p.join('\n');
}
