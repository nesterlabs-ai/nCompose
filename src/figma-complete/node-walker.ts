/**
 * Node Walker - Single-pass tree traversal with extractor application
 *
 * Efficiently walks the Figma node tree and applies extractors to build
 * complete node data while maintaining parent context.
 */

import type { CompleteNode, ExtractionContext, ExtractorFn } from './types.js';

/**
 * Walk a node tree and apply extractors
 */
export function walkNodeTree(
  rawNode: any,
  extractors: ExtractorFn[],
  context: ExtractionContext,
  parentNode?: CompleteNode
): CompleteNode | null {
  // Check depth limit
  if (context.maxDepth !== undefined && context.depth >= context.maxDepth) {
    return null;
  }

  // Skip hidden nodes unless preserving them
  if (!context.preserveHiddenNodes && rawNode.visible === false) {
    return null;
  }

  // Initialize result node with base properties
  const result: Partial<CompleteNode> = {
    id: rawNode.id,
    name: rawNode.name,
    type: rawNode.type,
    visible: rawNode.visible !== false,
  };

  // Update context with parent
  const nodeContext: ExtractionContext = {
    ...context,
    parentNode,
    depth: context.depth + 1,
  };

  // Apply all extractors in sequence
  for (const extractor of extractors) {
    try {
      extractor(rawNode, result, nodeContext);
    } catch (error) {
      console.warn(`Extractor failed for node ${rawNode.id}:`, error);
    }
  }

  // Cast to CompleteNode (extractors have populated it)
  const completeNode = result as CompleteNode;

  // Recursively process children
  if (rawNode.children && Array.isArray(rawNode.children)) {
    completeNode.children = [];

    for (const childRawNode of rawNode.children) {
      const childNode = walkNodeTree(
        childRawNode,
        extractors,
        nodeContext,
        completeNode
      );

      if (childNode) {
        completeNode.children.push(childNode);
      }
    }

    // Remove empty children array
    if (completeNode.children.length === 0) {
      delete completeNode.children;
    }
  }

  return completeNode;
}

/**
 * Walk multiple root nodes
 */
export function walkNodes(
  rawNodes: any[],
  extractors: ExtractorFn[],
  context: ExtractionContext
): CompleteNode[] {
  const results: CompleteNode[] = [];

  for (const rawNode of rawNodes) {
    const node = walkNodeTree(rawNode, extractors, context);
    if (node) {
      results.push(node);
    }
  }

  return results;
}

/**
 * Walk a single document node and return all top-level children
 *
 * IMPORTANT: When fetching a specific node (GetFileNodesResponse), the "document"
 * is the node itself (e.g., COMPONENT_SET), not a DOCUMENT wrapper.
 */
export function walkDocument(
  document: any,
  extractors: ExtractorFn[],
  context: ExtractionContext
): CompleteNode[] {
  // If this is an actual node (COMPONENT_SET, FRAME, etc.), not a DOCUMENT wrapper
  if (document.type && document.type !== 'DOCUMENT') {
    // Walk this node directly
    const node = walkNodeTree(document, extractors, context);
    return node ? [node] : [];
  }

  // Otherwise, it's a DOCUMENT wrapper - walk its children (canvases)
  if (document.children && Array.isArray(document.children)) {
    return walkNodes(document.children, extractors, context);
  }

  return [];
}

/**
 * Create a hash key for deduplication
 */
export function createStyleHash(obj: any): string {
  // Simple deterministic hash based on JSON stringification
  // Sort keys to ensure consistent hashing
  const sortedKeys = Object.keys(obj).sort();
  const parts = sortedKeys.map((key) => `${key}:${JSON.stringify(obj[key])}`);
  return parts.join('|');
}

/**
 * Add to global vars with deduplication
 */
export function addToGlobalVars<T>(
  globalMap: Record<string, T>,
  value: T,
  prefix: string = 'style'
): string {
  const hash = createStyleHash(value);

  // Check if already exists
  if (globalMap[hash]) {
    return hash;
  }

  // Add new entry
  globalMap[hash] = value;
  return hash;
}

/**
 * Helper to safely access nested properties
 */
export function safeGet(obj: any, path: string, defaultValue?: any): any {
  const keys = path.split('.');
  let current = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return defaultValue;
    }
    current = current[key];
  }

  return current !== undefined ? current : defaultValue;
}

/**
 * Helper to check if a value exists and is not empty
 */
export function hasValue(value: any): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }

  return true;
}

/**
 * Copy properties from source to target if they exist
 */
export function copyProperties(
  source: any,
  target: any,
  properties: string[]
): void {
  for (const prop of properties) {
    if (source[prop] !== undefined && source[prop] !== null) {
      target[prop] = source[prop];
    }
  }
}

/**
 * Deep clone an object (simple version, handles most cases)
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item)) as any;
  }

  const cloned: any = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }

  return cloned;
}
