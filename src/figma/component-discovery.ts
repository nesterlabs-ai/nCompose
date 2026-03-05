/**
 * Component Discovery System
 *
 * Walks a Figma section tree, identifies INSTANCE nodes that are recognizable
 * UI components (Dropdown, Input, Button, Chip, Toggle, etc.), groups them
 * by component name, and extracts props from componentProperties.
 *
 * Used by PATH C to generate leaf components individually before assembling
 * the full section — producing better semantic HTML via focused LLM calls.
 */

// ── Name patterns for recognizable UI components ────────────────────────────

const COMPONENT_PATTERNS: Array<{ pattern: RegExp; formRole: string }> = [
  { pattern: /dropdown\s*field|drop\s*down/i, formRole: 'select' },
  { pattern: /select\s*field|select\s*box/i, formRole: 'select' },
  { pattern: /input\s*field|text\s*field|text\s*box|text\s*input/i, formRole: 'textInput' },
  { pattern: /search\s*bar|search\s*field|search\s*input/i, formRole: 'search' },
  { pattern: /text\s*area|text\s*editor/i, formRole: 'textarea' },
  { pattern: /checkbox/i, formRole: 'checkbox' },
  { pattern: /radio\s*button|radio\s*group/i, formRole: 'radio' },
  { pattern: /toggle|switch/i, formRole: 'toggle' },
  { pattern: /^button\b|btn\b|cta\b/i, formRole: 'button' },
  { pattern: /button\s*icon|icon\s*button/i, formRole: 'iconButton' },
  { pattern: /chip\b|tag\b|badge\b/i, formRole: 'chip' },
  { pattern: /tab\b|tab\s*item/i, formRole: 'tab' },
  { pattern: /breadcrumb/i, formRole: 'breadcrumb' },
  { pattern: /avatar/i, formRole: 'avatar' },
  { pattern: /tooltip/i, formRole: 'tooltip' },
  { pattern: /slider|range/i, formRole: 'slider' },
  { pattern: /pagination/i, formRole: 'pagination' },
  { pattern: /stepper|step\s*indicator/i, formRole: 'stepper' },
];

// ── Types ───────────────────────────────────────────────────────────────────

export interface ComponentInstance {
  /** Reference to the original Figma node */
  node: any;
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
  /** Inferred form role (e.g., "select", "textInput", "button") */
  formRole: string;
  /** All instances of this component found in the section */
  instances: ComponentInstance[];
  /** Representative node for generation (first instance, richest props) */
  representativeNode: any;
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
 * Recursively walks the Figma tree to find INSTANCE nodes that match
 * known UI component patterns. Collects them with their tree path
 * so we can substitute them later.
 */
function walkForComponents(
  node: any,
  path: number[],
  results: Map<string, { formRole: string; componentName: string; instances: ComponentInstance[] }>,
): void {
  if (!node || node.visible === false) return;

  // Check if this is a recognizable component INSTANCE
  if (node.type === 'INSTANCE' && node.name) {
    const formRole = matchComponentPattern(node.name);
    if (formRole) {
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

  // Recurse into children
  if (node.children && Array.isArray(node.children)) {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (child && child.visible !== false) {
        walkForComponents(child, [...path, i], results);
      }
    }
  }
}

/**
 * Discovers all recognizable UI component instances in a section tree.
 *
 * @param sectionNode - The root FRAME of a page section
 * @returns Discovery result with unique component types and their instances
 */
export function discoverComponents(sectionNode: any): ComponentDiscoveryResult {
  const componentMap = new Map<string, { formRole: string; componentName: string; instances: ComponentInstance[] }>();

  walkForComponents(sectionNode, [], componentMap);

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
      allPropKeys,
    });
  }

  return { components, totalInstances };
}
