/**
 * Parses Figma COMPONENT_SET nodes into a structured variant map.
 *
 * Works universally for any component type — buttons, inputs, cards,
 * badges, toggles, etc. Extracts variant axes dynamically, classifies
 * states (including compound states like "Error-Hover"), and generates
 * diff-based CSS without hardcoded property allowlists.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VariantAxis {
  name: string;             // e.g. "Style", "Size", "State"
  values: string[];         // e.g. ["Primary", "Neutral", "Subtle"]
}

export interface VariantStyles {
  /** CSS properties for the outer container */
  container: Record<string, string>;
  /** CSS properties for the first TEXT child (kept for backward compat) */
  text: Record<string, string>;
  /** CSS properties for each named child node (key = kebab-case name) */
  children: Record<string, Record<string, string>>;
}

export interface VariantEntry {
  /** Variant property values, e.g. { Style: "Primary", State: "Default", Size: "Medium" } */
  props: Record<string, string>;
  /** Resolved CSS styles for this variant */
  styles: VariantStyles;
}

export interface ClassifiedState {
  /** Boolean condition if compound state, e.g. "error" for "Error-Hover" */
  booleanCondition: string | null;
  /** CSS pseudo-class / attribute selector, e.g. ":hover", "[disabled]" */
  cssSelector: string;
  /** Original value from the axis, e.g. "Error-Hover" */
  originalValue: string;
}

export interface ComponentSetData {
  name: string;
  axes: VariantAxis[];
  /** Non-state axes that become component props */
  propAxes: VariantAxis[];
  /** Identified state axis (null if none detected) */
  stateAxis: VariantAxis | null;
  /** Classified states with CSS selector mappings */
  classifiedStates: ClassifiedState[];
  /** Boolean props extracted from state analysis (e.g. "error", "disabled", "loading") */
  booleanProps: string[];
  variants: VariantEntry[];
  /** The default variant (best match for "resting" state) */
  defaultVariant: VariantEntry;
  /** Raw Figma node for the default variant (for structure extraction) */
  defaultVariantNode: any;

  // NEW: Component property definitions from complete extraction
  /** Component property definitions from Figma API */
  componentPropertyDefinitions?: Record<string, any>;
  /** Icon slot properties (INSTANCE_SWAP type) */
  iconSlotProperties?: Array<{
    name: string;
    type: 'INSTANCE_SWAP';
    defaultValue: string;
    preferredValues?: any[];
  }>;
  /** Text content properties (TEXT type) */
  textContentProperties?: Array<{
    name: string;
    type: 'TEXT';
    defaultValue: string;
  }>;
  /** Boolean visibility properties (BOOLEAN type) */
  booleanVisibilityProperties?: Array<{
    name: string;
    type: 'BOOLEAN';
    defaultValue: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// State classification
// ---------------------------------------------------------------------------

/** Interactive states → CSS pseudo-classes */
const KNOWN_STATE_SELECTORS: Record<string, string> = {
  'default': '',
  // NOTE: hover and focus are now treated as renderable variants (removed from here)
  // They will become boolean props instead of CSS-only pseudo-classes
  'active': ':active',
  'pressed': ':active',
  'disabled': '[disabled]',
  'visited': ':visited',
};

/** Boolean modifiers → CSS selectors */
const KNOWN_BOOLEAN_STATES: Record<string, string> = {
  'loading': '.loading',
  'hover': '[data-hover]',  // Now a renderable boolean prop
  'focus': '[data-focus]',  // Now a renderable boolean prop
  'focused': '[data-focus]',
  'checked': '[data-checked]',
  'selected': '[data-selected]',
  'filled': '[data-filled]',
  'filled-in': '[data-filled]',
  'filledin': '[data-filled]',
  'typing': '[data-typing]',
  'error': '[data-error]',
  'success': '[data-success]',
  'warning': '[data-warning]',
  'readonly': '[readonly]',
  'required': '[data-required]',
  'open': '[data-open]',
  'closed': '[data-closed]',
  'on': '[data-on]',
  'off': '[data-off]',
  'active': ':active',
  'indeterminate': '[data-indeterminate]',
};

/** Keywords that indicate an axis represents interactive state */
const STATE_KEYWORDS = ['default', 'hover', 'focus', 'focused', 'disabled', 'loading', 'active', 'pressed'];

/**
 * Classifies a single state value into a boolean condition + CSS selector.
 *
 * Handles:
 * - Simple interactive states: "Hover", "Focused", "Disabled"
 * - Simple boolean states: "Loading", "Error", "Filled in"
 * - Compound states: "Error-Hover", "Filled in - Hover", "Error - Focused"
 *   (prefix = boolean condition, suffix = interactive state)
 */
export function classifyStateValue(value: string): ClassifiedState {
  const normalized = value.toLowerCase().trim();

  // Try to split compound states on " - " (space-dash-space) first, then "-"
  const compoundParts = splitCompoundState(normalized);
  if (compoundParts) {
    const [prefix, suffix] = compoundParts;
    const suffixNorm = suffix.trim();
    const prefixNorm = prefix.trim();

    // Check if suffix is an interactive state
    if (suffixNorm in KNOWN_STATE_SELECTORS) {
      const boolName = toBooleanPropName(prefixNorm);
      return {
        booleanCondition: boolName,
        cssSelector: KNOWN_STATE_SELECTORS[suffixNorm],
        originalValue: value,
      };
    }
  }

  // Simple interactive state
  if (normalized in KNOWN_STATE_SELECTORS) {
    return { booleanCondition: null, cssSelector: KNOWN_STATE_SELECTORS[normalized], originalValue: value };
  }

  // Simple boolean state (check against known list)
  if (normalized in KNOWN_BOOLEAN_STATES) {
    return { booleanCondition: toBooleanPropName(normalized), cssSelector: '', originalValue: value };
  }

  // Check if it's a multi-word match in known lists (e.g., "filled in")
  const asKebab = normalized.replace(/\s+/g, '-');
  if (asKebab in KNOWN_BOOLEAN_STATES) {
    return { booleanCondition: toBooleanPropName(normalized), cssSelector: '', originalValue: value };
  }

  // Unknown — treat as boolean modifier
  return { booleanCondition: toBooleanPropName(normalized), cssSelector: '', originalValue: value };
}

/**
 * Splits a compound state like "filled in - hover" or "error-default"
 * into [prefix, suffix]. Returns null if not compound.
 */
function splitCompoundState(normalized: string): [string, string] | null {
  // Try " - " first (space-dash-space, common in Figma)
  const spaceDashIdx = normalized.indexOf(' - ');
  if (spaceDashIdx > 0) {
    return [normalized.substring(0, spaceDashIdx), normalized.substring(spaceDashIdx + 3)];
  }

  // Try simple "-" but only if both parts are meaningful
  const dashIdx = normalized.indexOf('-');
  if (dashIdx > 0) {
    const prefix = normalized.substring(0, dashIdx);
    const suffix = normalized.substring(dashIdx + 1);
    // Only treat as compound if suffix is a known interactive state
    if (suffix.trim() in KNOWN_STATE_SELECTORS) {
      return [prefix, suffix];
    }
  }

  return null;
}

/**
 * Converts a state name to a valid JavaScript prop name.
 * "filled in" → "filled", "error" → "error", "loading" → "loading"
 */
function toBooleanPropName(stateValue: string): string {
  // Remove spaces and convert to camelCase
  const trimmed = stateValue.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0];
  // camelCase: "filled in" → "filledIn"
  return parts[0] + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

// ---------------------------------------------------------------------------
// Axis identification
// ---------------------------------------------------------------------------

/**
 * Heuristically identifies which axis represents interactive state.
 * 1. Exact name match: "State"
 * 2. Heuristic: axis with 2+ interactive keywords in its values
 */
function identifyStateAxis(axes: VariantAxis[]): VariantAxis | null {
  // Exact name match
  const exact = axes.find((a) => a.name.toLowerCase() === 'state');
  if (exact) return exact;

  // Heuristic: look for axes whose values contain interactive state keywords
  for (const axis of axes) {
    const lowered = axis.values.map((v) => v.toLowerCase());
    const matches = STATE_KEYWORDS.filter((kw) => lowered.some((v) => v === kw || v.includes(kw)));
    if (matches.length >= 2) return axis;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Default variant selection
// ---------------------------------------------------------------------------

/**
 * Finds the best "resting" default variant.
 * Uses the state axis's "Default" value (or first) and first values for all prop axes.
 */
function findDefaultVariant(
  variants: VariantEntry[],
  axes: VariantAxis[],
  stateAxis: VariantAxis | null,
): VariantEntry {
  const defaultStateName = stateAxis
    ? (stateAxis.values.find((v) => v.toLowerCase() === 'default') ?? stateAxis.values[0])
    : undefined;

  // Build preferred props: first value for each non-state axis, default state for state axis
  const preferred: Record<string, string> = {};
  for (const axis of axes) {
    if (stateAxis && axis.name === stateAxis.name) {
      if (defaultStateName) preferred[axis.name] = defaultStateName;
    } else {
      preferred[axis.name] = axis.values[0];
    }
  }

  // Try exact match on all preferred values
  const exact = variants.find((v) =>
    Object.entries(preferred).every(([k, val]) => v.props[k] === val),
  );
  if (exact) return exact;

  // Fallback: any variant with default state
  if (stateAxis && defaultStateName) {
    const withDefaultState = variants.find((v) => v.props[stateAxis.name] === defaultStateName);
    if (withDefaultState) return withDefaultState;
  }

  return variants[0];
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parses a COMPONENT_SET's complete design data into a structured variant map.
 * Now uses the complete extraction library which preserves ALL component properties.
 */
export function parseComponentSet(
  completeDesign: any,
): ComponentSetData | null {
  const nodes = completeDesign?.nodes;
  if (!nodes || !Array.isArray(nodes)) return null;

  const rootNode = nodes[0];
  if (!rootNode || rootNode.type !== 'COMPONENT_SET') return null;

  const children = rootNode.children;
  if (!children || !Array.isArray(children) || children.length === 0) return null;

  // Merge all globalVars into a single styles map for compatibility
  const globalStyles: Record<string, any> = {
    ...(completeDesign?.globalVars?.layouts ?? {}),
    ...(completeDesign?.globalVars?.textStyles ?? {}),
    ...(completeDesign?.globalVars?.fills ?? {}),
    ...(completeDesign?.globalVars?.strokes ?? {}),
    ...(completeDesign?.globalVars?.effects ?? {}),
  };

  // Parse variant axes from child names
  const axisMap = new Map<string, Set<string>>();
  const variants: VariantEntry[] = [];

  for (const child of children) {
    const props = parseVariantName(child.name);
    if (!props) continue;

    for (const [key, value] of Object.entries(props)) {
      if (!axisMap.has(key)) axisMap.set(key, new Set());
      axisMap.get(key)!.add(value);
    }

    const styles = resolveVariantStyles(child, globalStyles);
    variants.push({ props, styles });
  }

  // Build axes
  const axes: VariantAxis[] = [];
  for (const [name, values] of axisMap) {
    axes.push({ name, values: [...values] });
  }

  // Identify state axis using heuristics
  const stateAxis = identifyStateAxis(axes);
  const propAxes = axes.filter((a) => a !== stateAxis);

  // Classify states and extract boolean props
  const classifiedStates: ClassifiedState[] = stateAxis
    ? stateAxis.values.map(classifyStateValue)
    : [];

  const booleanPropsSet = new Set<string>();
  for (const cs of classifiedStates) {
    if (cs.booleanCondition) booleanPropsSet.add(cs.booleanCondition);
    // "disabled" in simple state form also becomes a boolean prop
    if (!cs.booleanCondition && cs.originalValue.toLowerCase() === 'disabled') {
      booleanPropsSet.add('disabled');
    }
    if (!cs.booleanCondition && cs.originalValue.toLowerCase() === 'loading') {
      booleanPropsSet.add('loading');
    }
  }
  const booleanProps = [...booleanPropsSet];

  // Find default variant
  const defaultVariant = findDefaultVariant(variants, axes, stateAxis);

  // Find the raw node for the default variant
  const defaultVariantNode = children.find((child: any) => {
    const parsed = parseVariantName(child.name);
    if (!parsed) return false;
    return Object.entries(defaultVariant.props).every(([k, v]) => parsed[k] === v);
  }) ?? children[0];

  // Extract component property definitions from complete design
  const componentPropertyDefinitions = extractComponentPropertyDefinitions(
    rootNode.componentSetId || rootNode.id,
    completeDesign
  );

  // Classify component properties by type
  const { iconSlotProperties, textContentProperties, booleanVisibilityProperties } =
    classifyComponentPropertyDefinitions(componentPropertyDefinitions);

  return {
    name: rootNode.name,
    axes,
    propAxes,
    stateAxis,
    classifiedStates,
    booleanProps,
    variants,
    defaultVariant,
    defaultVariantNode,
    componentPropertyDefinitions,
    iconSlotProperties,
    textContentProperties,
    booleanVisibilityProperties,
  };
}

/**
 * Extract component property definitions from complete design data
 */
function extractComponentPropertyDefinitions(
  componentSetId: string,
  completeDesign: any
): Record<string, any> {
  // Try to get from componentSets map
  const componentSet = completeDesign?.componentSets?.[componentSetId];
  if (componentSet?.componentPropertyDefinitions) {
    return componentSet.componentPropertyDefinitions;
  }

  // Fallback: empty object
  return {};
}

/**
 * Clean component property name by removing Figma's internal node ID suffix
 * "Show Left Icon#3371:152" -> "Show Left Icon"
 */
function cleanPropertyName(name: string): string {
  return name.replace(/#\d+:\d+$/, '');
}

/**
 * Classify component property definitions into categories
 */
function classifyComponentPropertyDefinitions(
  propertyDefinitions: Record<string, any>
): {
  iconSlotProperties: Array<any>;
  textContentProperties: Array<any>;
  booleanVisibilityProperties: Array<any>;
} {
  const iconSlotProperties: Array<any> = [];
  const textContentProperties: Array<any> = [];
  const booleanVisibilityProperties: Array<any> = [];

  for (const [name, def] of Object.entries(propertyDefinitions)) {
    const cleanName = cleanPropertyName(name);

    if (def.type === 'INSTANCE_SWAP') {
      iconSlotProperties.push({
        name: cleanName,
        type: 'INSTANCE_SWAP',
        defaultValue: def.defaultValue,
        preferredValues: def.preferredValues,
      });
    } else if (def.type === 'TEXT') {
      textContentProperties.push({
        name: cleanName,
        type: 'TEXT',
        defaultValue: def.defaultValue,
      });
    } else if (def.type === 'BOOLEAN') {
      booleanVisibilityProperties.push({
        name: cleanName,
        type: 'BOOLEAN',
        defaultValue: def.defaultValue,
      });
    }
  }

  return {
    iconSlotProperties,
    textContentProperties,
    booleanVisibilityProperties,
  };
}

// ---------------------------------------------------------------------------
// Variant name parsing
// ---------------------------------------------------------------------------

/**
 * Parses variant name like "Style=Primary, State=Default, Size=Medium"
 */
function parseVariantName(name: string): Record<string, string> | null {
  if (!name.includes('=')) return null;

  const props: Record<string, string> = {};
  const parts = name.split(',').map((s) => s.trim());

  for (const part of parts) {
    const [key, value] = part.split('=').map((s) => s.trim());
    if (key && value) {
      props[key] = value;
    }
  }

  return Object.keys(props).length > 0 ? props : null;
}

// ---------------------------------------------------------------------------
// Style resolution
// ---------------------------------------------------------------------------

/**
 * Resolves a variant's style tokens to actual CSS values.
 * Only includes properties that exist — no fallback defaults.
 */
function resolveVariantStyles(
  node: any,
  globalStyles: Record<string, any>,
): VariantStyles {
  const container = resolveNodeCSS(node, globalStyles);
  const children: Record<string, Record<string, string>> = {};

  // Resolve text styles from first TEXT child (backward compat)
  const text: Record<string, string> = {};
  const textChild = findFirstTextNode(node);
  if (textChild) {
    // Try globalStyles first, then direct node properties
    const textStyle = globalStyles[textChild.textStyle];
    if (textStyle) {
      if (textStyle.fontFamily) text['font-family'] = textStyle.fontFamily;
      if (textStyle.fontWeight) text['font-weight'] = String(textStyle.fontWeight);
      if (textStyle.fontSize) text['font-size'] = addUnit(textStyle.fontSize, 'px');
      if (textStyle.lineHeight) text['line-height'] = textStyle.lineHeight;
    } else if (textChild.style) {
      // Direct from node (complete extraction)
      if (textChild.style.fontFamily) text['font-family'] = textChild.style.fontFamily;
      if (textChild.style.fontWeight) text['font-weight'] = String(textChild.style.fontWeight);
      if (textChild.style.fontSize) text['font-size'] = addUnit(textChild.style.fontSize, 'px');
      if (textChild.style.lineHeight) {
        const lh = textChild.style.lineHeight;
        text['line-height'] = typeof lh === 'number' ? `${lh}px` : lh;
      }
    }

    const textFills = globalStyles[textChild.fills] || extractFillsFromNode(textChild);
    if (textFills && Array.isArray(textFills) && textFills.length > 0) {
      text['color'] = textFills[0];
    }
  }

  // Resolve styles for ALL named children (depth 1)
  if (node.children) {
    for (const child of node.children) {
      const childName = child.name;
      if (!childName || childName.startsWith('_')) continue;

      const key = toKebabCase(childName);
      const childCSS = resolveNodeCSS(child, globalStyles);

      // For icon containers (FRAME with vector content), extract color from deep VECTOR children
      if (child.type === 'FRAME' && child.absoluteBoundingBox) {
        const width = child.absoluteBoundingBox.width;
        const height = child.absoluteBoundingBox.height;
        const isSmall = width <= 32 && height <= 32;

        if (isSmall) {
          const vectorColor = extractVectorColorRecursive(child);
          if (vectorColor && !childCSS['color']) {
            childCSS['color'] = vectorColor;
          }
        }
      }

      // For TEXT nodes, fills represent text color, not background
      if (child.type === 'TEXT') {
        delete childCSS['background-color'];

        // Try globalStyles first, then direct node properties
        const ts = globalStyles[child.textStyle];
        if (ts) {
          if (ts.fontFamily) childCSS['font-family'] = ts.fontFamily;
          if (ts.fontWeight) childCSS['font-weight'] = String(ts.fontWeight);
          if (ts.fontSize) childCSS['font-size'] = addUnit(ts.fontSize, 'px');
          if (ts.lineHeight) childCSS['line-height'] = ts.lineHeight;
        } else if (child.style) {
          // Direct from node (complete extraction)
          if (child.style.fontFamily) childCSS['font-family'] = child.style.fontFamily;
          if (child.style.fontWeight) childCSS['font-weight'] = String(child.style.fontWeight);
          if (child.style.fontSize) childCSS['font-size'] = addUnit(child.style.fontSize, 'px');
          if (child.style.lineHeight) {
            const lh = child.style.lineHeight;
            childCSS['line-height'] = typeof lh === 'number' ? `${lh}px` : lh;
          }
        }

        const cf = globalStyles[child.fills] || extractFillsFromNode(child);
        if (cf && Array.isArray(cf) && cf.length > 0) {
          childCSS['color'] = cf[0];
        }
      }

      if (Object.keys(childCSS).length > 0) {
        children[key] = childCSS;
      }
    }
  }

  return { container, text, children };
}

/**
 * Convert RGB(0-1) to hex color string
 */
function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/**
 * Recursively searches for VECTOR nodes and extracts their stroke or fill color
 * Used for icon containers to get the color from deep vector children
 */
function extractVectorColorRecursive(node: any): string | null {
  if (!node) return null;

  // If this is a VECTOR node, extract its color
  if (node.type === 'VECTOR') {
    // Try strokes first (icons often use strokes)
    if (node.strokes && Array.isArray(node.strokes) && node.strokes.length > 0) {
      const stroke = node.strokes[0];
      if (stroke.visible !== false && stroke.type === 'SOLID' && stroke.color) {
        const { r, g, b, a } = stroke.color;
        if (a === undefined || a === 1) {
          return rgbToHex(r, g, b);
        } else {
          return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
        }
      }
    }

    // Fall back to fills
    if (node.fills && Array.isArray(node.fills) && node.fills.length > 0) {
      const fill = node.fills[0];
      if (fill.visible !== false && fill.type === 'SOLID' && fill.color) {
        const { r, g, b, a } = fill.color;
        if (a === undefined || a === 1) {
          return rgbToHex(r, g, b);
        } else {
          return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
        }
      }
    }
  }

  // Recursively search children
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      const color = extractVectorColorRecursive(child);
      if (color) return color;
    }
  }

  return null;
}

/**
 * Resolves a single node's visual CSS properties from globalStyles.
 */
function resolveNodeCSS(
  node: any,
  globalStyles: Record<string, string> = {},
): Record<string, string> {
  const css: Record<string, string> = {};

  // Try globalStyles first (Framelink path), then fall back to node properties (complete extraction path)

  // Layout
  const layout = globalStyles[node.layout] || extractLayoutFromNode(node);
  if (layout) {
    if (layout.mode === 'row' || node.layoutMode === 'HORIZONTAL') {
      css['display'] = 'flex';
      css['flex-direction'] = 'row';
    } else if (layout.mode === 'column' || node.layoutMode === 'VERTICAL') {
      css['display'] = 'flex';
      css['flex-direction'] = 'column';
    }
    if (layout.justifyContent) css['justify-content'] = layout.justifyContent;
    if (layout.alignItems) css['align-items'] = layout.alignItems;
    if (layout.gap) css['gap'] = layout.gap;
    if (layout.padding) css['padding'] = layout.padding;
    if (layout.dimensions?.height) css['height'] = `${layout.dimensions.height}px`;
    if (layout.dimensions?.width) css['width'] = `${layout.dimensions.width}px`;
    if (layout.dimensions?.minHeight) css['min-height'] = `${layout.dimensions.minHeight}px`;
    if (layout.dimensions?.minWidth) css['min-width'] = `${layout.dimensions.minWidth}px`;
  }

  // Direct node properties (complete extraction)
  if (node.itemSpacing) css['gap'] = `${node.itemSpacing}px`;
  if (node.padding) {
    const p = node.padding;
    if (typeof p === 'number') {
      css['padding'] = `${p}px`;
    } else if (p.top !== undefined) {
      css['padding'] = `${p.top}px ${p.right}px ${p.bottom}px ${p.left}px`;
    }
  }
  if (node.absoluteBoundingBox) {
    // Height handling
    if (!css['height']) css['height'] = `${node.absoluteBoundingBox.height}px`;

    // Width handling - check if this is a HUG layout (auto-size to content)
    const isHorizontalLayout = node.layoutMode === 'HORIZONTAL';
    const isVerticalLayout = node.layoutMode === 'VERTICAL';
    const primaryAxisIsAuto = node.primaryAxisSizingMode === 'AUTO';
    const counterAxisIsAuto = node.counterAxisSizingMode === 'AUTO';

    // If horizontal layout with AUTO primary axis, or vertical layout with AUTO counter axis, use min-width instead of fixed width
    const shouldUseMinWidth =
      (isHorizontalLayout && primaryAxisIsAuto) ||
      (isVerticalLayout && counterAxisIsAuto);

    if (!css['width']) {
      if (shouldUseMinWidth) {
        // Use min-width for flexible layouts (HUG)
        css['min-width'] = `${node.absoluteBoundingBox.width}px`;
      } else {
        // Use fixed width for FIXED layouts
        css['width'] = `${node.absoluteBoundingBox.width}px`;
      }
    }
  }

  // Fills (background)
  const fills = globalStyles[node.fills] || extractFillsFromNode(node);
  if (fills && Array.isArray(fills) && fills.length > 0) {
    css['background-color'] = fills[0];
  }

  // Strokes (border)
  const strokes = globalStyles[node.strokes] || extractStrokesFromNode(node);
  if (strokes?.colors?.[0] && strokes?.strokeWeight) {
    css['border'] = `${strokes.strokeWeight} solid ${strokes.colors[0]}`;
  }

  // Border radius
  if (node.cornerRadius) {
    css['border-radius'] = `${node.cornerRadius}px`;
  } else if (node.borderRadius) {
    css['border-radius'] = node.borderRadius;
  }

  // Opacity
  if (node.opacity !== undefined && node.opacity !== 1) {
    css['opacity'] = String(node.opacity);
  }

  // Effects
  const effects = globalStyles[node.effects] || extractEffectsFromNode(node);
  if (effects) {
    if (effects.boxShadow) css['box-shadow'] = effects.boxShadow;
    if (effects.backdropFilter) css['backdrop-filter'] = effects.backdropFilter;
  }

  return css;
}

/**
 * Extract layout info directly from node properties (complete extraction format)
 */
function extractLayoutFromNode(node: any): any | null {
  if (!node.layoutMode || node.layoutMode === 'NONE') return null;

  const layout: any = {};
  if (node.layoutMode === 'HORIZONTAL') layout.mode = 'row';
  if (node.layoutMode === 'VERTICAL') layout.mode = 'column';

  if (node.primaryAxisAlignItems) {
    layout.justifyContent = mapAlignItems(node.primaryAxisAlignItems);
  }
  if (node.counterAxisAlignItems) {
    layout.alignItems = mapAlignItems(node.counterAxisAlignItems);
  }
  if (node.itemSpacing) layout.gap = `${node.itemSpacing}px`;

  return layout;
}

/**
 * Map Figma alignment to CSS
 */
function mapAlignItems(align: string): string {
  const map: Record<string, string> = {
    'MIN': 'flex-start',
    'CENTER': 'center',
    'MAX': 'flex-end',
    'SPACE_BETWEEN': 'space-between',
    'STRETCH': 'stretch',
  };
  return map[align] || align.toLowerCase();
}

/**
 * Extract fills from node properties
 */
function extractFillsFromNode(node: any): string[] | null {
  if (!node.fills || !Array.isArray(node.fills)) return null;

  const colors: string[] = [];
  for (const fill of node.fills) {
    if (fill.type === 'SOLID' && fill.color) {
      const { r, g, b, a = 1 } = fill.color;

      // Figma has TWO opacity concepts:
      // 1. fill.opacity - the fill layer's opacity
      // 2. node.opacity - the entire node/layer's appearance opacity
      // Both need to be multiplied together for the final alpha
      const fillOpacity = fill.opacity !== undefined ? fill.opacity : 1;
      const nodeOpacity = node.opacity !== undefined ? node.opacity : 1;
      const finalAlpha = a * fillOpacity * nodeOpacity;

      if (finalAlpha < 1) {
        colors.push(`rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${finalAlpha})`);
      } else {
        const hex = `#${[r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
        colors.push(hex);
      }
    }
  }

  return colors.length > 0 ? colors : null;
}

/**
 * Extract strokes from node properties
 */
function extractStrokesFromNode(node: any): any | null {
  if (!node.strokes || !Array.isArray(node.strokes)) return null;

  const colors: string[] = [];
  for (const stroke of node.strokes) {
    if (stroke.type === 'SOLID' && stroke.color) {
      const { r, g, b, a = 1 } = stroke.color;

      // Figma has TWO opacity concepts:
      // 1. stroke.opacity - the stroke layer's opacity
      // 2. node.opacity - the entire node/layer's appearance opacity
      // Both need to be multiplied together for the final alpha
      const strokeOpacity = stroke.opacity !== undefined ? stroke.opacity : 1;
      const nodeOpacity = node.opacity !== undefined ? node.opacity : 1;
      const finalAlpha = a * strokeOpacity * nodeOpacity;

      if (finalAlpha < 1) {
        colors.push(`rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${finalAlpha})`);
      } else {
        const hex = `#${[r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
        colors.push(hex);
      }
    }
  }

  return colors.length > 0 ? {
    colors,
    strokeWeight: node.strokeWeight ? `${node.strokeWeight}px` : '1px'
  } : null;
}

/**
 * Extract effects from node properties
 */
function extractEffectsFromNode(node: any): any | null {
  if (!node.effects || !Array.isArray(node.effects)) return null;

  const result: any = {};
  const shadows: string[] = [];

  for (const effect of node.effects) {
    if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
      const { offset, radius, color } = effect;
      if (offset && color) {
        const { r, g, b, a = 1 } = color;
        const colorStr = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
        const prefix = effect.type === 'INNER_SHADOW' ? 'inset ' : '';
        shadows.push(`${prefix}${offset.x}px ${offset.y}px ${radius || 0}px 0px ${colorStr}`);
      }
    } else if (effect.type === 'LAYER_BLUR' && effect.radius) {
      result.backdropFilter = `blur(${effect.radius}px)`;
    }
  }

  if (shadows.length > 0) {
    result.boxShadow = shadows.join(', ');
  }

  return Object.keys(result).length > 0 ? result : null;
}

/** Recursively finds the first TEXT node in a subtree. */
function findFirstTextNode(node: any): any | null {
  if (node.type === 'TEXT') return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findFirstTextNode(child);
      if (found) return found;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// CSS generation — diff-based, universal
// ---------------------------------------------------------------------------

/**
 * Builds a clean, grouped CSS stylesheet from the variant data.
 *
 * Structure:
 *   .base { all default properties }
 *   .base__label { text properties }
 *   .base--value { prop-axis diff from default }
 *   .base:hover { state diff from default }
 *   .base--value:hover { state diff per prop-axis value }
 *   .base[data-error] { boolean state }
 *   .base[data-error]:hover { compound state }
 *
 * @param dimensionMap - Optional map of node ID → dimensions for icon sizing
 */
export function buildVariantCSS(
  data: ComponentSetData,
  dimensionMap?: Map<string, { width: number; height: number }>,
): string {
  const base = toKebabCase(data.name);
  const lines: string[] = [];

  const findVariant = (props: Record<string, string>) =>
    data.variants.find((v) =>
      Object.entries(props).every(([k, val]) => v.props[k] === val),
    );

  const defaultContainer = data.defaultVariant.styles.container;
  const defaultChildren = data.defaultVariant.styles.children;

  // Find text color to apply to icon containers (for SVG currentColor inheritance)
  let textColor: string | undefined;
  for (const [childKey, childCSS] of Object.entries(defaultChildren)) {
    if (childCSS['color']) {
      textColor = childCSS['color'];
      break;
    }
  }

  // Build a map from child name → dimensions by searching the node tree
  // Also check ALL variants to find explicit dimensions (like loading state with 14x14)
  const childDimensions = new Map<string, { width: number; height: number }>();

  // First, check all variants for explicit child dimensions
  for (const variant of data.variants) {
    for (const [childKey, childCSS] of Object.entries(variant.styles.children)) {
      if (childCSS['width'] && childCSS['height']) {
        // Extract numeric values
        const widthMatch = String(childCSS['width']).match(/(\d+(?:\.\d+)?)/);
        const heightMatch = String(childCSS['height']).match(/(\d+(?:\.\d+)?)/);
        if (widthMatch && heightMatch) {
          const dims = {
            width: parseFloat(widthMatch[1]),
            height: parseFloat(heightMatch[1]),
          };
          // Use first found dimensions for each child
          if (!childDimensions.has(childKey)) {
            childDimensions.set(childKey, dims);
          }
        }
      }
    }
  }

  // Then, check asset dimension map
  if (dimensionMap && dimensionMap.size > 0 && data.defaultVariantNode?.children) {
    for (const child of data.defaultVariantNode.children) {
      const childKey = toKebabCase(child.name ?? '');
      if (!childDimensions.has(childKey)) {
        const dims = findDimensionsInTree(child, dimensionMap);
        if (dims) {
          childDimensions.set(childKey, dims);
        }
      }
    }
  }

  // --- 1. Base styles: ALL properties from default variant ---
  lines.push(`.${base} {`);
  for (const [prop, val] of Object.entries(defaultContainer)) {
    lines.push(`  ${prop}: ${val};`);
  }
  // CRITICAL: Reset HTML button's default border if no border is defined
  // This prevents browser default borders from appearing on variants without borders
  // Use !important to override any global button styles
  if (!defaultContainer['border']) {
    lines.push(`  border: none !important;`);
    lines.push(`  outline: none;`);
  }
  lines.push('}');

  // Base child styles (each named child gets its own rule)
  for (const [childKey, childCSS] of Object.entries(defaultChildren)) {
    const mergedCSS = { ...childCSS };

    // Apply icon dimensions if available
    const dims = childDimensions.get(childKey);
    if (dims) {
      mergedCSS['width'] = `${dims.width}px`;
      mergedCSS['height'] = `${dims.height}px`;
    }

    // If this is an icon container, apply text color so SVG currentColor inherits properly
    const isIconContainer = childKey.toLowerCase().includes('icon');
    if (isIconContainer && textColor && !mergedCSS['color']) {
      mergedCSS['color'] = textColor;
    }

    if (Object.keys(mergedCSS).length > 0) {
      lines.push('');
      lines.push(`.${base}__${childKey} {`);
      for (const [prop, val] of Object.entries(mergedCSS)) {
        lines.push(`  ${prop}: ${val};`);
      }
      lines.push('}');

      // Add img child rules for icons to make SVG respect container color
      if (isIconContainer) {
        lines.push('');
        lines.push(`.${base}__${childKey} img {`);
        lines.push(`  width: 100%;`);
        lines.push(`  height: 100%;`);
        lines.push(`  object-fit: contain;`);
        lines.push('}');
      }
    }
  }

  // Helper: build default lookup props
  const defaultLookup: Record<string, string> = {};
  for (const axis of data.propAxes) {
    defaultLookup[axis.name] = data.defaultVariant.props[axis.name] ?? axis.values[0];
  }
  const defaultStateName = data.stateAxis
    ? (data.defaultVariant.props[data.stateAxis.name] ??
       data.stateAxis.values.find((v) => v.toLowerCase() === 'default') ??
       data.stateAxis.values[0])
    : undefined;

  // --- 2. Prop axis modifiers (diff-based) ---
  for (const axis of data.propAxes) {
    for (const value of axis.values) {
      if (value === (data.defaultVariant.props[axis.name] ?? axis.values[0])) continue;

      const lookupProps: Record<string, string> = { ...defaultLookup, [axis.name]: value };
      if (data.stateAxis && defaultStateName) {
        lookupProps[data.stateAxis.name] = defaultStateName;
      }

      const variant = findVariant(lookupProps);
      if (!variant) continue;

      const modSelector = `.${base}--${toKebabCase(value)}`;
      emitDiffRules(lines, base, modSelector, data.defaultVariant.styles, variant.styles);
    }
  }

  // --- 3. State overrides ---
  if (data.stateAxis && data.classifiedStates.length > 0) {
    const hasPropAxes = data.propAxes.length > 0;

    if (hasPropAxes) {
      for (const axis of data.propAxes) {
        for (const axisValue of axis.values) {
          const baseSelector = `.${base}--${toKebabCase(axisValue)}`;
          const defaultStateLookup: Record<string, string> = { ...defaultLookup, [axis.name]: axisValue };
          if (defaultStateName) {
            defaultStateLookup[data.stateAxis.name] = defaultStateName;
          }
          const defaultStateVariant = findVariant(defaultStateLookup);
          if (!defaultStateVariant) continue;

          emitStateOverrides(data, lines, base, baseSelector, defaultStateLookup, defaultStateVariant, findVariant);
        }
        break; // Only first prop axis
      }
    } else {
      const defaultStateLookup: Record<string, string> = {};
      if (defaultStateName) {
        defaultStateLookup[data.stateAxis.name] = defaultStateName;
      }
      const defaultStateVariant = findVariant(defaultStateLookup) ?? data.defaultVariant;

      emitStateOverrides(data, lines, base, `.${base}`, defaultStateLookup, defaultStateVariant, findVariant);
    }
  }

  return lines.join('\n');
}

/**
 * Emits diff CSS rules for container, text (__label), and all named children.
 */
function emitDiffRules(
  lines: string[],
  base: string,
  selector: string,
  baseStyles: VariantStyles,
  variantStyles: VariantStyles,
): void {
  const containerDiff = diffStyles(baseStyles.container, variantStyles.container);
  if (Object.keys(containerDiff).length > 0) {
    lines.push('');
    lines.push(`${selector} {`);
    for (const [prop, val] of Object.entries(containerDiff)) {
      lines.push(`  ${prop}: ${val};`);
    }
    lines.push('}');
  }

  // Diff all named children
  const allChildKeys = new Set([
    ...Object.keys(baseStyles.children),
    ...Object.keys(variantStyles.children),
  ]);
  for (const childKey of allChildKeys) {
    const baseChild = baseStyles.children[childKey] ?? {};
    const variantChild = variantStyles.children[childKey] ?? {};
    const childDiff = diffStyles(baseChild, variantChild);
    if (Object.keys(childDiff).length > 0) {
      lines.push('');
      lines.push(`${selector} .${base}__${childKey} {`);
      for (const [prop, val] of Object.entries(childDiff)) {
        lines.push(`  ${prop}: ${val};`);
      }
      lines.push('}');
    }
  }
}

/**
 * Builds the CSS selector for a classified state.
 */
function buildStateSelector(baseSelector: string, cs: ClassifiedState): string {
  let selector = baseSelector;
  if (cs.booleanCondition) {
    const boolLower = cs.booleanCondition.toLowerCase();
    const boolKebab = toKebabCase(cs.booleanCondition);
    const boolSelector =
      KNOWN_BOOLEAN_STATES[boolLower] ??
      KNOWN_BOOLEAN_STATES[boolKebab] ??
      `[data-${boolKebab}]`;
    selector += boolSelector;
  }
  if (cs.cssSelector) {
    selector += cs.cssSelector;
  }
  return selector;
}

/**
 * Emits CSS rules for state overrides relative to a base variant.
 */
function emitStateOverrides(
  data: ComponentSetData,
  lines: string[],
  base: string,
  baseSelector: string,
  baseLookup: Record<string, string>,
  baseVariant: VariantEntry,
  findVariant: (props: Record<string, string>) => VariantEntry | undefined,
): void {
  for (const cs of data.classifiedStates) {
    // Skip the default/resting state
    if (cs.cssSelector === '' && cs.booleanCondition === null) continue;

    const stateLookup = { ...baseLookup, [data.stateAxis!.name]: cs.originalValue };
    const stateVariant = findVariant(stateLookup);
    if (!stateVariant) continue;

    const selector = buildStateSelector(baseSelector, cs);
    emitDiffRules(lines, base, selector, baseVariant.styles, stateVariant.styles);
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Recursively searches a node tree for any node whose ID exists in the dimensionMap.
 * Returns the first matching dimensions found.
 */
function findDimensionsInTree(
  node: any,
  dimensionMap: Map<string, { width: number; height: number }>,
): { width: number; height: number } | null {
  if (!node) return null;

  // Check this node
  if (node.id && dimensionMap.has(node.id)) {
    return dimensionMap.get(node.id)!;
  }

  // Check children
  if (node.children) {
    for (const child of node.children) {
      const dims = findDimensionsInTree(child, dimensionMap);
      if (dims) return dims;
    }
  }

  return null;
}

function diffStyles(
  baseStyles: Record<string, string>,
  variantStyles: Record<string, string>,
): Record<string, string> {
  const diff: Record<string, string> = {};
  for (const [key, val] of Object.entries(variantStyles)) {
    if (baseStyles[key] !== val) {
      diff[key] = val;
    }
  }
  for (const key of Object.keys(baseStyles)) {
    if (!(key in variantStyles)) {
      diff[key] = 'unset';
    }
  }
  return diff;
}

export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/\s+/g, '-')
    .toLowerCase();
}

export function toCamelCase(str: string): string {
  return str
    .replace(/[-_\s]+(.)?/g, (_, char) => (char ? char.toUpperCase() : ''))
    .replace(/^[A-Z]/, (char) => char.toLowerCase());
}

/**
 * Safely add a unit to a value if it doesn't already have it
 * Prevents double units like "14pxpx"
 */
function addUnit(value: number | string, unit: string): string {
  if (typeof value === 'number') {
    return `${value}${unit}`;
  }

  const strValue = String(value);
  // If it already ends with the unit or any other unit-like suffix, return as-is
  if (strValue.match(/px|em|rem|%|pt|vh|vw$/)) {
    return strValue;
  }

  return `${strValue}${unit}`;
}
