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
  { pattern: /\bsidebar\b|side\s*bar|side\s*nav\b|sidenav\b|nav\s*bar|nav\s*panel|nav\s*drawer|nav\s*menu|side\s*menu|left\s*nav|left\s*panel|app\s*nav|main\s*nav|app\s*sidebar|navigation\s*panel|navigation\s*menu/i, formRole: 'sidebar' },
  { pattern: /\btable\b|data\s*table|data\s*grid|data\s*list|list\s*view|grid\s*view|table\s*view|record\s*list|spreadsheet/i, formRole: 'table' },
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

// ── Component-set property inference ─────────────────────────────────────────

/**
 * Infers a formRole from componentProperties (variant axes).
 *
 * INSTANCE nodes from COMPONENT_SETs carry variant properties like
 * Type, Size, State, Disabled, etc. These properties tell us what kind
 * of component it is — no name matching or dimension heuristics needed.
 *
 * Returns a formRole string. Falls back to 'component' (generic) if
 * the properties don't give a clear signal.
 */
function inferFormRoleFromProperties(cp: any): string {
  // Normalize all property keys and values to lowercase for matching.
  // Handle two formats:
  //   Raw Figma:       { "Type#123:0": { value: "Primary", type: "VARIANT" }, ... }
  //   Simplified node: [ { name: "Type#123:0", value: "Primary", type: "VARIANT" }, ... ]
  const keys = new Map<string, string>(); // lowercaseKey → value

  if (Array.isArray(cp)) {
    // Simplified format: array of {name, value, type}
    for (const entry of cp) {
      const cleanKey = cleanPropKey(String(entry.name ?? '')).toLowerCase();
      const value = String(entry.value ?? '').toLowerCase();
      keys.set(cleanKey, value);
    }
  } else {
    // Raw Figma format: key-value object
    for (const [rawKey, val] of Object.entries(cp)) {
      const cleanKey = cleanPropKey(rawKey).toLowerCase();
      const value = typeof val === 'object' && val !== null
        ? String((val as any).value ?? '').toLowerCase()
        : String(val).toLowerCase();
      keys.set(cleanKey, value);
    }
  }

  // Check property keys/values for component-type signals
  const keyArr: string[] = [];
  const valArr: string[] = [];
  keys.forEach((v, k) => { keyArr.push(k); valArr.push(v); });
  const hasKey = (patterns: RegExp) => keyArr.some((k) => patterns.test(k));
  const hasValue = (patterns: RegExp) => valArr.some((v) => patterns.test(v));

  // Checked / Unchecked → checkbox or toggle/switch
  if (hasKey(/^checked$|^selected$/)) return 'checkbox';

  // Open / Expanded → dropdown, dialog, or accordion
  if (hasKey(/^open$|^expanded$/)) return 'select';

  // Placeholder / Value + has input-like signals
  if (hasKey(/^placeholder$/)) return 'textInput';

  // Has Disabled + Type/Size/Icon properties → likely button
  if (hasKey(/^disabled$/) && (hasKey(/^type$|^variant$|^style$/) || hasKey(/^size$/))) {
    // Check if values suggest specific types
    if (hasValue(/primary|secondary|tertiary|destructive|danger|ghost|outline|link/)) {
      return 'button';
    }
  }

  // Has Icon properties → likely button or icon-button
  if (hasKey(/icon/)) {
    if (hasKey(/^disabled$/) || hasKey(/^type$|^variant$/)) return 'button';
  }

  // Generic: node is from a COMPONENT_SET but we can't determine exact type.
  // Return 'component' so it still gets extracted as a sub-component.
  return 'component';
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
 * Checks both simplified and raw node since simplification may strip layoutMode.
 */
function isHorizontalLayout(node: any, rawNode?: any): boolean {
  return node.layoutMode === 'HORIZONTAL' || rawNode?.layoutMode === 'HORIZONTAL';
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
function matchVisualHeuristic(node: any, rawNode?: any): string | null {
  const dims = getNodeDimensions(node) ?? getNodeDimensions(rawNode);
  if (!dims) return null;
  const { w, h } = dims;
  const childCount = visibleChildCount(node);
  const horiz = isHorizontalLayout(node, rawNode);

  // Button visual heuristic REMOVED.
  // Buttons are detected reliably via INSTANCE node type + name matching
  // + componentProperties inference. Visual heuristics on plain FRAMEs
  // cause false positives (hero banners, content cards, CTA containers
  // all match "short horizontal frame with text").

  // Input: horizontal, has border/stroke, wider than tall, has TEXT, h≤64
  if (horiz && hasBorder(node) && w > h && hasTextChild(node) && h <= 64) {
    return 'textInput';
  }

  // Checkbox: horizontal, has small square child (≤28px), has TEXT, h≤40
  if (horiz && h <= 40 && hasTextChild(node) && Array.isArray(node.children)) {
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
  if (horiz && h <= 36 && hasTextChild(node)) {
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

/**
 * Detects FRAME (non-INSTANCE) nodes that are interactive UI elements
 * using the same visual heuristics as matchVisualHeuristic() plus
 * name-based pattern matching.
 *
 * Many Figma designs use raw FRAMEs for inputs, search bars, etc.
 * instead of component instances. This function applies the same
 * data-driven detection (dimensions, layout, strokes, children)
 * that already works for INSTANCE nodes.
 *
 * For FRAMEs, input detection takes priority over button detection
 * because a bordered FRAME with text is far more likely to be an input
 * than a button (buttons are almost always INSTANCE nodes in Figma).
 *
 * Returns a formRole string if matched, null otherwise.
 */
// Container formRoles that should NOT be detected from plain FRAMEs.
// These are structural wrappers whose children contain the actual
// interactive primitives (inputs, buttons, checkboxes). Detecting them
// as leaf widgets would stop recursion and miss the children.
const CONTAINER_FORM_ROLES = new Set([
  'form', 'card', 'dialog', 'toast', 'tab',
  'stepper',
]);

// Structural formRoles that should be BOTH detected from plain FRAMEs
// AND allow recursion into children (in deepRecurse mode).
// Unlike CONTAINER_FORM_ROLES (which are pure wrappers), these are
// meaningful components that should use their shadcn template while
// their children (checkboxes, switches, badges) are also discovered.
export const STRUCTURAL_FORM_ROLES = new Set([
  'sidebar', 'table',
]);

function detectFrameBasedWidget(node: any, rawNode?: any): string | null {
  // First try name-based patterns (same as for INSTANCE nodes)
  const nameRole = matchComponentPattern(node.name ?? '');
  if (nameRole && nameRole !== 'component'
      && !CONTAINER_FORM_ROLES.has(nameRole)
      && !STRUCTURAL_FORM_ROLES.has(nameRole)) return nameRole;

  // For FRAMEs, check input heuristic FIRST — a bordered FRAME with
  // text is almost certainly an input, not a button. Buttons in Figma
  // are nearly always INSTANCE nodes from a design system.
  const dims = getNodeDimensions(node) ?? getNodeDimensions(rawNode);
  if (dims) {
    const { w, h } = dims;
    const horiz = isHorizontalLayout(node, rawNode);
    if (horiz && hasBorder(node) && w > h && hasTextChild(node) && h <= 64) {
      return 'textInput';
    }
  }

  // Fall back to remaining visual heuristics (checkbox, toggle, chip, avatar)
  return matchVisualHeuristic(node, rawNode);
}

// ── Discovery logic ─────────────────────────────────────────────────────────

/**
 * Matches a node name against known UI component patterns.
 * Returns the formRole if matched, null otherwise.
 */
export function matchComponentPattern(name: string): string | null {
  for (const { pattern, formRole } of COMPONENT_PATTERNS) {
    if (pattern.test(name)) return formRole;
  }
  return null;
}

/**
 * Validates that a name-matched 'button' formRole is structurally plausible.
 * Names like "CTA", "CTAs", "special CTA" can appear on large container frames.
 * INSTANCE nodes are always trusted (from a design system component).
 * FRAME/GROUP nodes must be compact to be actual buttons.
 */
function validateButtonFormRole(node: any, rawNode?: any): boolean {
  if (node.type === 'INSTANCE') return true;
  const dims = getNodeDimensions(node) ?? getNodeDimensions(rawNode);
  if (!dims || dims.h === 0) return true;
  if (dims.h > 80) return false;
  if (dims.w / dims.h > 5) return false;
  return true;
}

/**
 * Validates that a name-matched 'sidebar' formRole is structurally plausible.
 *
 * A sidebar is taller than wide (vertical navigation panel).
 * A top navbar is wider than tall (horizontal bar).
 * Names like "Navbar", "Navigation" match the sidebar regex but are
 * often top navigation bars — the node's own dimensions distinguish them.
 * INSTANCE nodes are trusted (from a design system component).
 */
function validateSidebarFormRole(node: any, rawNode?: any): boolean {
  if (node.type === 'INSTANCE') return true;
  const dims = getNodeDimensions(node) ?? getNodeDimensions(rawNode);
  if (!dims || dims.w === 0 || dims.h === 0) return true;
  // A sidebar must be taller than wide (aspect ratio h/w > 1)
  // A navbar like 390×98 has h/w = 0.25 → not a sidebar
  // A sidebar like 280×900 has h/w = 3.2 → is a sidebar
  return dims.h > dims.w;
}

/**
 * Refines a name-based formRole by inspecting the node's componentProperties.
 *
 * Figma component sets often use variant properties like `Dropdown=Yes`,
 * `Country=Yes`, `Type=Dropdown` to toggle between input styles.
 * The name might just be "Input Fields" for all variants, so we check
 * the actual properties to detect dropdowns, country selectors, etc.
 */
function refineFormRole(formRole: string, node: any, rawNode?: any): string {
  // Validate button: large containers named "CTA" etc. aren't actual buttons
  if ((formRole === 'button' || formRole === 'iconButton') && !validateButtonFormRole(node, rawNode)) {
    return 'component';
  }

  // Validate sidebar: wide+short nodes named "Navbar" etc. aren't sidebars
  if (formRole === 'sidebar' && !validateSidebarFormRole(node, rawNode)) {
    return 'component';
  }

  if (formRole !== 'textInput') return formRole; // only refine text inputs further

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
  deepRecurse?: boolean,
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

  const isRoot = path.length === 0;

  // ── FRAME-based widget detection (deepRecurse only) ──────────────────
  // Some Figma designs use plain FRAMEs (not INSTANCE nodes) for inputs,
  // search bars, etc. Apply the same name + visual heuristic detection
  // used for INSTANCE nodes so the LLM renders them semantically.
  if (deepRecurse && (node.type === 'FRAME' || node.type === 'GROUP') && node.name && !isRoot) {
    // First check for structural components (sidebar, table) by name.
    // These are collected AND recursion continues into their children
    // so leaf widgets inside (checkboxes, switches, badges) are also found.
    let structNameRole = matchComponentPattern(node.name ?? '');
    // Validate structural roles using Figma dimensions — e.g. "Navbar" matches
    // the sidebar regex but is wider than tall, so it's not actually a sidebar.
    if (structNameRole && STRUCTURAL_FORM_ROLES.has(structNameRole)) {
      if (structNameRole === 'sidebar' && !validateSidebarFormRole(node, rawNode)) {
        structNameRole = null; // not a sidebar — let it fall through
      }
    }
    if (structNameRole && STRUCTURAL_FORM_ROLES.has(structNameRole)) {
      const key = `frame::${node.name}::${structNameRole}`;
      if (!results.has(key)) {
        results.set(key, { formRole: structNameRole, componentName: node.name, instances: [] });
      }
      results.get(key)!.instances.push({
        node,
        props: {},
        treePath: [...path],
      });
      // Fall through — DO NOT return. Continue recursing into children
      // to find leaf widgets (checkboxes, switches, etc.) inside the table/sidebar.
    } else {
      // Leaf widget detection (button, input, checkbox, etc.)
      const frameFormRole = detectFrameBasedWidget(node, rawNode);
      if (frameFormRole && frameFormRole !== 'component') {
        const key = `frame::${node.name}::${frameFormRole}`;
        if (!results.has(key)) {
          results.set(key, { formRole: frameFormRole, componentName: node.name, instances: [] });
        }
        results.get(key)!.instances.push({
          node,
          props: {},
          treePath: [...path],
        });
        // Don't recurse into recognized frame widgets — they're leaf units
        return;
      }
    }
  }

  // Check if this is a recognizable component INSTANCE.
  // In deepRecurse mode, skip the root node (depth 0 / empty path) — we're
  // scanning it FOR sub-components, not classifying the root itself.
  if (node.type === 'INSTANCE' && node.name && !(deepRecurse && isRoot)) {
    let rawFormRole = matchComponentPattern(node.name);
    if (!rawFormRole) rawFormRole = matchVisualHeuristic(node, rawNode); // visual fallback

    // Option 3: If name and visual heuristics didn't match, check if the
    // INSTANCE comes from a COMPONENT_SET (has componentProperties with
    // variant axes). Any such node is a reusable design-system component
    // and should be extracted as a sub-component — no name guessing needed.
    if (!rawFormRole) {
      const cp = node.componentProperties ?? node.componentPropertyValues
        ?? rawNode?.componentProperties ?? rawNode?.componentPropertyValues;
      const cpLen = Array.isArray(cp) ? cp.length : (cp ? Object.keys(cp).length : 0);
      if (cp && cpLen > 0) {
        rawFormRole = inferFormRoleFromProperties(cp);
      }
    }

    if (rawFormRole) {
      const formRole = refineFormRole(rawFormRole, node, rawNode);

      if (deepRecurse) {
        // In deepRecurse mode: collect recognized leaf primitives but ALWAYS
        // continue recursing into children. This handles two cases:
        //   a) True leaf primitives (Button, Checkbox Field) — collected here
        //      and children are empty, so recursion is a no-op.
        //   b) Containers that happen to name-match (e.g. "Dropdown List of
        //      Items" matches /drop\s*down/ → 'select', "Chip List" matches
        //      /chip\b/) — collected here but recursion continues to find
        //      actual primitives nested inside.
        // Generic 'component' formRole is NOT collected — it's just a container
        // with no specific UI role.
        if (formRole !== 'component') {
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
        }
        // Fall through to child recursion below — never stop in deepRecurse
      } else {
        // Normal mode (PATH C): collect and stop recursion at recognized nodes
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
  }

  // Recurse into children (threading raw children alongside simplified ones)
  if (node.children && Array.isArray(node.children)) {
    const rawChildren: any[] = rawNode?.children ?? [];
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const rawChild = rawChildren[i] ?? child;
      if (child && child.visible !== false) {
        walkForComponents(child, rawChild, [...path, i], results, deepRecurse);
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
 * @param options        - Discovery options
 * @param options.deepRecurse - When true, recurse through generic 'component'
 *   INSTANCE nodes to find specific UI primitives nested inside container
 *   components. Used by PATH B composite delegation to find shadcn-supported
 *   children buried inside wrapper instances (e.g. Checkbox Field inside
 *   "item row" inside "list of items"). Default: false (PATH C behavior unchanged).
 * @returns Discovery result with unique component types and their instances
 */
export function discoverComponents(
  sectionNode: any,
  rawSectionNode?: any,
  options?: { deepRecurse?: boolean },
): ComponentDiscoveryResult {
  const componentMap = new Map<string, { formRole: string; componentName: string; instances: ComponentInstance[] }>();

  walkForComponents(sectionNode, rawSectionNode ?? sectionNode, [], componentMap, options?.deepRecurse);

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
