/**
 * Element-to-Code Mapping for Visual Edit
 *
 * Injects stable data-ve-id attributes into the Mitosis component tree
 * and builds a map from element path → source metadata. This allows the
 * refinement LLM to precisely target the selected DOM element when the
 * user clicks in the preview.
 */

import type { MitosisComponent, MitosisNode } from '@builder.io/mitosis';

/** Metadata for a single mapped element, used to enrich LLM refinement context. */
export interface ElementMapEntry {
  /** Unique path (e.g. "0-1-2") used as data-ve-id */
  path: string;
  /** HTML tag name (div, span, button, etc.) */
  tagName: string;
  /** Static text content if present (from _text or children) */
  textContent?: string;
  /** className from properties if present */
  className?: string;
  /** id from properties if present */
  id?: string;
}

/** Map from data-ve-id (path) to element metadata. */
export type ElementMap = Record<string, ElementMapEntry>;

/** Mitosis node with optional children (handles various Mitosis shapes). */
interface WalkableNode {
  name?: string;
  properties?: Record<string, any>;
  children?: WalkableNode[];
}

/** Mitosis block names that don't render as DOM elements (For, Show, etc.) */
const MITOSIS_BLOCKS = new Set(['For', 'Show', 'Fragment', 'Slot', 'BuilderBlock']);

/**
 * Walks the Mitosis tree and injects data-ve-id on each DOM element node,
 * building the elementMap as we go. Skips Mitosis blocks (For, Show, etc.).
 */
function walkAndInject(
  nodes: WalkableNode[] | undefined,
  pathPrefix: string,
  elementMap: ElementMap,
): void {
  if (!nodes || !Array.isArray(nodes)) return;

  nodes.forEach((node, index) => {
    const path = pathPrefix ? `${pathPrefix}-${index}` : String(index);

    // Skip non-element nodes
    const name = node.name;
    if (!name || typeof name !== 'string') return;

    // Skip Mitosis blocks - they don't render as DOM elements
    if (MITOSIS_BLOCKS.has(name)) {
      const children = node.children;
      if (children && Array.isArray(children)) {
        walkAndInject(children, path, elementMap);
      }
      return;
    }

    // Initialize properties if missing
    if (!node.properties) node.properties = {};

    // Extract text for map (Mitosis wraps text in _text)
    const textContent = node.properties?.['_text'] as string | undefined;

    // Build map entry (use className or class - Mitosis may use either)
    const className = (node.properties?.class ?? node.properties?.className) as string | undefined;
    const id = node.properties?.id as string | undefined;

    elementMap[path] = {
      path,
      tagName: name.toLowerCase(),
      textContent: textContent?.trim() || undefined,
      className,
      id,
    };

    // Inject data-ve-id (overwrites any existing)
    node.properties['data-ve-id'] = path;

    // Recurse into children
    const children = node.children;
    if (children && Array.isArray(children)) {
      walkAndInject(children, path, elementMap);
    }
  });
}

/**
 * Injects data-ve-id attributes into the Mitosis component and returns
 * the modified component plus the element map.
 *
 * Call this BEFORE generateFrameworkCode() so the generated React/Vue/etc
 * output includes data-ve-id on each element.
 *
 * @param component - Parsed Mitosis component from parseJsx
 * @returns Modified component (mutated) and elementMap
 */
export function injectDataVeIds(component: MitosisComponent): {
  component: MitosisComponent;
  elementMap: ElementMap;
} {
  const elementMap: ElementMap = {};
  const children = (component as any).children;
  walkAndInject(children, '', elementMap);

  return { component, elementMap };
}
