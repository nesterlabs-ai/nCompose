/**
 * Component Discovery System
 *
 * Walks a Figma section tree, identifies INSTANCE nodes that are recognizable
 * UI components (Dropdown, Input, Button, Chip, Toggle, etc.) AND chart/graph
 * sections. Groups them by component name, and extracts props from
 * componentProperties.
 *
 * Used by PATH C to generate leaf components (and charts) individually before
 * assembling the full section — producing better semantic HTML via focused
 * LLM calls and deterministic Recharts codegen.
 */

import { isChartSection } from './chart-detection.js';

// ── Name patterns for recognizable UI components ────────────────────────────

const COMPONENT_PATTERNS: Array<{ pattern: RegExp; formRole: string }> = [
  { pattern: /dropdown\s*menu|context\s*menu|popover\s*menu/i, formRole: 'dropdownMenu' },
  { pattern: /dropdown\s*field|drop\s*down/i, formRole: 'select' },
  { pattern: /select\s*field|select\s*box/i, formRole: 'select' },
  { pattern: /input\s*field|text\s*field|text\s*box|text\s*input/i, formRole: 'textInput' },
  { pattern: /search\s*bar|search\s*field|search\s*input/i, formRole: 'search' },
  { pattern: /text\s*area|text\s*editor/i, formRole: 'textarea' },
  { pattern: /checkbox/i, formRole: 'checkbox' },
  { pattern: /radio\s*button|radio\s*group|radio\b/i, formRole: 'radio' },
  { pattern: /toggle|switch/i, formRole: 'toggle' },
  { pattern: /^button\b|btn\b|cta\b/i, formRole: 'button' },
  { pattern: /button\s*icon|icon\s*button/i, formRole: 'iconButton' },
  { pattern: /chip\b|tag\b|badge\b/i, formRole: 'chip' },
  { pattern: /status\s*indicator|status\s*badge|status\s*dot/i, formRole: 'statusIndicator' },
  { pattern: /tab\b|tab\s*item/i, formRole: 'tab' },
  { pattern: /breadcrumb/i, formRole: 'breadcrumb' },
  { pattern: /avatar/i, formRole: 'avatar' },
  { pattern: /tooltip/i, formRole: 'tooltip' },
  { pattern: /slider|range/i, formRole: 'slider' },
  { pattern: /pagination/i, formRole: 'pagination' },
  { pattern: /stepper|step\s*indicator/i, formRole: 'stepper' },
  { pattern: /toast\b|snackbar/i, formRole: 'toast' },
  { pattern: /dialog\b|modal\b/i, formRole: 'dialog' },
  { pattern: /calendar|date\s*picker/i, formRole: 'calendar' },
  { pattern: /\bform\b|form\s*field|form\s*group/i, formRole: 'form' },
  { pattern: /\bcard\b/i, formRole: 'card' },
];

// ── Types ───────────────────────────────────────────────────────────────────

export interface ComponentInstance {
  /** Reference to the original Figma node */
  node: any;
  /** Raw Figma node for chart detection (has arcData, strokes, etc.) */
  rawNode?: any;
  /** Cleaned props extracted from componentProperties */
  props: Record<string, string | boolean>;
  /** Path from section root to this instance (for substitution) */
  treePath: number[];
}

export interface DiscoveredComponent {
  /** Figma component name (e.g., "Dropdown Field") */
  name: string;
  /** Grouping key: "name::fingerprint" — unique per structural variant */
  variantKey: string;
  /** Inferred form role (e.g., "select", "textInput", "button", "chart") */
  formRole: string;
  /** All instances of this component found in the section */
  instances: ComponentInstance[];
  /** Representative node for generation (first instance, richest props) */
  representativeNode: any;
  /** Raw Figma node for chart metadata extraction */
  representativeRawNode?: any;
  /** Merged props across all instances (superset of all prop keys) */
  allPropKeys: string[];
}

export interface ComponentDiscoveryResult {
  /** Unique component types found */
  components: DiscoveredComponent[];
  /** Total instances found (before dedup) */
  totalInstances: number;
}

// ── Prop extraction ─────────────────────────────────────────────────────────

/**
 * Cleans a Figma componentProperty key by stripping the internal ID suffix.
 * "Label#3395:18" → "Label"
 * "Show Value#4792:0" → "Show Value"
 */
function cleanPropKey(raw: string): string {
  return raw.replace(/#[\d:]+$/, '').trim();
}

/**
 * Extracts clean props from a node's componentProperties.
 * Converts Figma's internal format to simple key-value pairs.
 */
function extractProps(node: any): Record<string, string | boolean> {
  const props: Record<string, string | boolean> = {};
  const raw = node.componentProperties ?? node.componentPropertyValues ?? {};

  for (const [key, val] of Object.entries(raw)) {
    const cleanKey = cleanPropKey(key);
    if (typeof val === 'object' && val !== null) {
      props[cleanKey] = (val as any).value ?? String(val);
    } else {
      props[cleanKey] = val as string | boolean;
    }
  }

  return props;
}

// ── Structural Fingerprinting ────────────────────────────────────────────────

/**
 * Computes a structural fingerprint from a node's componentProperties.
 *
 * 
 * Uses Figma's own property `type` metadata to classify:
 * - BOOLEAN / VARIANT → structural (affect DOM shape) → include
 * - TEXT → content-only (labels, values) → exclude
 * - INSTANCE_SWAP → icon swap node IDs → exclude
 *
 * Fallback (no type metadata): includes booleans + short strings,
 * excludes node IDs and long text content.
 *
 * Always excludes "State" (interaction states don't change DOM).
 */
export function computeStructuralFingerprint(node: any): string {
  const raw = node.componentProperties ?? node.componentPropertyValues ?? {};
  const parts: string[] = [];

  for (const [key, val] of Object.entries(raw)) {
    const cleanKey = cleanPropKey(key);

    // Skip "State" — interaction states (hover/focus/default) don't change DOM
    if (cleanKey.toLowerCase() === 'state') continue;

    // Extract type and value from Figma property object
    const propType = typeof val === 'object' && val !== null
      ? (val as any).type as string | undefined
      : undefined;
    const value = typeof val === 'object' && val !== null
      ? (val as any).value ?? String(val)
      : val;

    if (propType) {
      // Use Figma's type metadata — no hardcoded property name lists needed
      if (propType === 'TEXT' || propType === 'INSTANCE_SWAP') continue;
      // BOOLEAN, VARIANT, and any other structural types → include
      parts.push(`${cleanKey}=${value}`);
    } else {
      // Fallback: no type metadata available
      // Skip node ID references ("7896:28357")
      if (typeof value === 'string' && /^\d+:\d+$/.test(value)) continue;
      // Skip long text content (likely labels/descriptions)
      if (typeof value === 'string' && value.length > 50) continue;
      // Include booleans and short string values
      if (typeof value === 'boolean' || typeof value === 'string') {
        parts.push(`${cleanKey}=${value}`);
      }
    }
  }

  // Sort alphabetically for determinism
  parts.sort();
  return parts.join('|');
}

// ── Visual heuristic helpers ─────────────────────────────────────────────────

/**
 * Reads node dimensions from absoluteBoundingBox or size.
 */
function getNodeDimensions(node: any): { w: number; h: number } | null {
  const w = node.absoluteBoundingBox?.width ?? node.size?.x;
  const h = node.absoluteBoundingBox?.height ?? node.size?.y;
  if (w == null || h == null) return null;
  return { w, h };
}

/**
 * Checks if node has a horizontal auto-layout.
 */
function isHorizontalLayout(node: any): boolean {
  return node.layoutMode === 'HORIZONTAL';
}

/**
 * Checks if a node has visible strokes (border).
 */
function hasBorder(node: any): boolean {
  return Array.isArray(node.strokes) && node.strokes.some((s: any) => s.visible !== false && s.color);
}

/**
 * Checks if a node has a TEXT child.
 */
function hasTextChild(node: any): boolean {
  return Array.isArray(node.children) && node.children.some((c: any) => c.type === 'TEXT' && c.visible !== false);
}

/**
 * Checks if a node has an image fill.
 */
function hasImageFill(node: any): boolean {
  return Array.isArray(node.fills) && node.fills.some((f: any) => f.type === 'IMAGE' && f.visible !== false);
}

/**
 * Counts direct visible children.
 */
function visibleChildCount(node: any): number {
  if (!Array.isArray(node.children)) return 0;
  return node.children.filter((c: any) => c.visible !== false).length;
}

/**
 * Visual heuristic fallback for component detection.
 * Uses measurable node properties (dimensions, layout, children) — no names.
 * Returns a formRole string or null if no heuristic matches.
 */
function matchVisualHeuristic(node: any): string | null {
  const dims = getNodeDimensions(node);
  if (!dims) return null;
  const { w, h } = dims;
  const childCount = visibleChildCount(node);

  // Button: h≤64, horizontal layout, 1-3 children, has TEXT child
  if (h <= 64 && isHorizontalLayout(node) && childCount >= 1 && childCount <= 3 && hasTextChild(node)) {
    return 'button';
  }

  // Input: horizontal, has border/stroke, wider than tall, has TEXT, h≤64
  if (isHorizontalLayout(node) && hasBorder(node) && w > h && hasTextChild(node) && h <= 64) {
    return 'textInput';
  }

  // Checkbox: horizontal, has small square child (≤28px), has TEXT, h≤40
  if (isHorizontalLayout(node) && h <= 40 && hasTextChild(node) && Array.isArray(node.children)) {
    const hasSmallSquare = node.children.some((c: any) => {
      const cd = getNodeDimensions(c);
      return cd && cd.w <= 28 && cd.h <= 28 && Math.abs(cd.w - cd.h) <= 4;
    });
    if (hasSmallSquare) return 'checkbox';
  }

  // Toggle: aspect ratio 1.5-2.5:1, h≤40, w≤80, has circle child
  if (h <= 40 && w <= 80 && h > 0) {
    const ratio = w / h;
    if (ratio >= 1.5 && ratio <= 2.5 && Array.isArray(node.children)) {
      const hasCircle = node.children.some((c: any) => {
        if (c.type === 'ELLIPSE') return true;
        const cd = getNodeDimensions(c);
        return cd && Math.abs(cd.w - cd.h) <= 2 && cd.w <= h;
      });
      if (hasCircle) return 'toggle';
    }
  }

  // Chip/Badge: horizontal, h≤36, border-radius ≥ 40% of height, has TEXT
  if (isHorizontalLayout(node) && h <= 36 && hasTextChild(node)) {
    const cr = node.cornerRadius ?? (node.rectangleCornerRadii ? node.rectangleCornerRadii[0] : 0);
    if (cr && cr >= h * 0.4) return 'chip';
  }

  // Avatar: square (±4px), ≤56px, has image fill OR single short TEXT child
  if (w <= 56 && h <= 56 && Math.abs(w - h) <= 4) {
    if (hasImageFill(node)) return 'avatar';
    if (childCount === 1 && Array.isArray(node.children)) {
      const firstChild = node.children.find((c: any) => c.visible !== false);
      if (firstChild?.type === 'TEXT' && (firstChild.characters ?? '').length <= 3) return 'avatar';
    }
  }

  return null;
}

// ── Discovery logic ─────────────────────────────────────────────────────────

/**
 * Matches a node name against known UI component patterns.
 * Returns the formRole if matched, null otherwise.
 */
function matchComponentPattern(name: string): string | null {
  for (const { pattern, formRole } of COMPONENT_PATTERNS) {
    if (pattern.test(name)) return formRole;
  }
  return null;
}

/**
 * Refines a name-based formRole by inspecting the node's componentProperties.
 *
 * Figma component sets often use variant properties like `Dropdown=Yes`,
 * `Country=Yes`, `Type=Dropdown` to toggle between input styles.
 * The name might just be "Input Fields" for all variants, so we check
 * the actual properties to detect dropdowns, country selectors, etc.
 */
function refineFormRole(formRole: string, node: any): string {
  if (formRole !== 'textInput') return formRole; // only refine text inputs

  const raw = node.componentProperties ?? node.componentPropertyValues ?? {};

  for (const [key, val] of Object.entries(raw)) {
    const cleanKey = cleanPropKey(key).toLowerCase();
    const value = typeof val === 'object' && val !== null
      ? (val as any).value
      : val;
    const strValue = typeof value === 'string' ? value.toLowerCase() : '';
    const isTrue = value === true || strValue === 'yes' || strValue === 'true';

    // Property named "dropdown", "select", "combo", "picker" set to true/yes
    if (isTrue && /^(dropdown|select|combo|picker)$/.test(cleanKey)) {
      return 'select';
    }

    // Property named "type" or "variant" with value containing "dropdown"/"select"
    if (/^(type|variant|style)$/.test(cleanKey) && /dropdown|select/i.test(strValue)) {
      return 'select';
    }

    // Property named "country" set to true/yes → country picker (select)
    if (isTrue && /^country$/.test(cleanKey)) {
      return 'select';
    }
  }

  return formRole;
}

/**
 * Recursively walks the Figma tree to find INSTANCE nodes that match
 * known UI component patterns AND chart/graph sections.
 * Collects them with their tree path so we can substitute them later.
 *
 * @param node      Simplified Figma node (used for component matching)
 * @param rawNode   Raw Figma node (used for chart detection — has arcData, strokes)
 * @param path      Current tree path from section root
 * @param results   Map to collect discovered components
 */
function walkForComponents(
  node: any,
  rawNode: any,
  path: number[],
  results: Map<string, { formRole: string; componentName: string; instances: ComponentInstance[] }>,
): void {
  if (!node || node.visible === false) return;

  // Check if this FRAME/GROUP is a chart/graph section (uses raw node for detection).
  // Only check at depth 0 (the section root itself) to match the old behavior
  // where only top-level page sections were tested. Checking inner frames causes
  // false positives (navigation groups, text containers, etc.).
  const depth = path.length;
  const nodeType = rawNode?.type ?? node.type;
  if (depth === 0 && (nodeType === 'FRAME' || nodeType === 'GROUP' || nodeType === 'INSTANCE')) {
    if (rawNode && isChartSection(rawNode)) {
      const chartName = node.name ?? rawNode.name ?? 'Chart';
      // Unique key per chart instance (by position in tree)
      const key = `chart::${chartName}::${path.join('-')}`;
      if (!results.has(key)) {
        results.set(key, { formRole: 'chart', componentName: chartName, instances: [] });
      }
      results.get(key)!.instances.push({
        node,
        rawNode,
        props: {},
        treePath: [...path],
      });
      // Don't recurse into charts — they're leaf units
      return;
    }
  }

  // Check if this is a recognizable component INSTANCE
  if (node.type === 'INSTANCE' && node.name) {
    let rawFormRole = matchComponentPattern(node.name);
    if (!rawFormRole) rawFormRole = matchVisualHeuristic(node); // visual fallback
    if (rawFormRole) {
      const formRole = refineFormRole(rawFormRole, node);
      const fingerprint = computeStructuralFingerprint(node);
      const key = fingerprint ? `${node.name}::${fingerprint}` : node.name;
      if (!results.has(key)) {
        results.set(key, { formRole, componentName: node.name, instances: [] });
      }
      results.get(key)!.instances.push({
        node,
        props: extractProps(node),
        treePath: [...path],
      });
      // Don't recurse into recognized components — they're leaf units
      return;
    }
  }

  // Recurse into children (threading raw children alongside simplified ones)
  if (node.children && Array.isArray(node.children)) {
    const rawChildren: any[] = rawNode?.children ?? [];
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const rawChild = rawChildren[i] ?? child;
      if (child && child.visible !== false) {
        walkForComponents(child, rawChild, [...path, i], results);
      }
    }
  }
}

/**
 * Discovers all recognizable UI component instances and chart sections
 * in a section tree.
 *
 * @param sectionNode    - The root FRAME of a page section (simplified)
 * @param rawSectionNode - The raw Figma node (for chart detection)
 * @returns Discovery result with unique component types and their instances
 */
export function discoverComponents(
  sectionNode: any,
  rawSectionNode?: any,
): ComponentDiscoveryResult {
  const componentMap = new Map<string, { formRole: string; componentName: string; instances: ComponentInstance[] }>();

  walkForComponents(sectionNode, rawSectionNode ?? sectionNode, [], componentMap);

  const components: DiscoveredComponent[] = [];
  let totalInstances = 0;

  for (const [variantKey, { formRole, componentName, instances }] of componentMap) {
    totalInstances += instances.length;

    // Pick the instance with the most props as representative
    const representative = instances.reduce((best, curr) =>
      Object.keys(curr.props).length > Object.keys(best.props).length ? curr : best,
    );

    // Collect all unique prop keys across instances
    const allPropKeys = [...new Set(
      instances.flatMap((inst) => Object.keys(inst.props)),
    )];

    components.push({
      name: componentName,
      variantKey,
      formRole,
      instances,
      representativeNode: representative.node,
      representativeRawNode: representative.rawNode,
      allPropKeys,
    });
  }

  return { components, totalInstances };
}
