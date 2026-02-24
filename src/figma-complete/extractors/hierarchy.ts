/**
 * Hierarchy Extractor - Extracts parent-child relationships
 *
 * Preserves hierarchy information including:
 * - Parent node ID
 * - Child indices
 * - Nesting depth
 *
 * Note: Children are handled by the node walker, this extractor
 * focuses on parent references and metadata.
 */

import type { ExtractorFn } from '../types.js';

export const hierarchyExtractor: ExtractorFn = (node, result, context) => {
  // Store parent node ID if available
  if (context.parentNode) {
    result.parent = context.parentNode.id;
  }

  // Plugin data (can contain custom hierarchy info)
  if (node.pluginData && Object.keys(node.pluginData).length > 0) {
    result.pluginData = { ...node.pluginData };
  }

  // Shared plugin data
  if (node.sharedPluginData && Object.keys(node.sharedPluginData).length > 0) {
    result.sharedPluginData = { ...node.sharedPluginData };
  }

  // Boolean operations (affects visual hierarchy)
  if (node.booleanOperation) {
    result.booleanOperation = node.booleanOperation;
  }

  // Vector data (for shape hierarchy)
  if (node.vectorNetwork) {
    result.vectorNetwork = node.vectorNetwork;
  }

  if (node.vectorPaths) {
    result.vectorPaths = node.vectorPaths;
  }

  // Fill and stroke geometry (for complex shapes)
  if (node.fillGeometry) {
    result.fillGeometry = node.fillGeometry;
  }

  if (node.strokeGeometry) {
    result.strokeGeometry = node.strokeGeometry;
  }
};

/**
 * Helper to find parent node by child ID
 */
export function findParentNode(childId: string, rootNode: any): any | null {
  if (!rootNode.children) {
    return null;
  }

  for (const child of rootNode.children) {
    if (child.id === childId) {
      return rootNode;
    }

    const parent = findParentNode(childId, child);
    if (parent) {
      return parent;
    }
  }

  return null;
}

/**
 * Helper to find node by ID in tree
 */
export function findNodeById(nodeId: string, rootNode: any): any | null {
  if (rootNode.id === nodeId) {
    return rootNode;
  }

  if (!rootNode.children) {
    return null;
  }

  for (const child of rootNode.children) {
    const found = findNodeById(nodeId, child);
    if (found) {
      return found;
    }
  }

  return null;
}

/**
 * Helper to get all ancestor IDs for a node
 */
export function getAncestorIds(node: any, rootNode: any): string[] {
  const ancestors: string[] = [];
  let current = findParentNode(node.id, rootNode);

  while (current) {
    ancestors.push(current.id);
    current = findParentNode(current.id, rootNode);
  }

  return ancestors;
}

/**
 * Helper to get all descendant IDs for a node
 */
export function getDescendantIds(node: any): string[] {
  const descendants: string[] = [];

  function traverse(n: any) {
    if (n.children) {
      for (const child of n.children) {
        descendants.push(child.id);
        traverse(child);
      }
    }
  }

  traverse(node);
  return descendants;
}

/**
 * Helper to get nesting depth of a node
 */
export function getNestingDepth(node: any, rootNode: any): number {
  return getAncestorIds(node, rootNode).length;
}

/**
 * Helper to check if a node is an ancestor of another
 */
export function isAncestorOf(ancestorId: string, descendantId: string, rootNode: any): boolean {
  const ancestors = getAncestorIds(findNodeById(descendantId, rootNode)!, rootNode);
  return ancestors.includes(ancestorId);
}

/**
 * Helper to get siblings of a node
 */
export function getSiblings(node: any, rootNode: any): any[] {
  const parent = findParentNode(node.id, rootNode);

  if (!parent || !parent.children) {
    return [];
  }

  return parent.children.filter((child: any) => child.id !== node.id);
}

/**
 * Helper to get child index of a node
 */
export function getChildIndex(node: any, rootNode: any): number {
  const parent = findParentNode(node.id, rootNode);

  if (!parent || !parent.children) {
    return -1;
  }

  return parent.children.findIndex((child: any) => child.id === node.id);
}

/**
 * Helper to flatten tree to array
 */
export function flattenTree(rootNode: any): any[] {
  const flattened: any[] = [rootNode];

  function traverse(node: any) {
    if (node.children) {
      for (const child of node.children) {
        flattened.push(child);
        traverse(child);
      }
    }
  }

  traverse(rootNode);
  return flattened;
}

/**
 * Helper to build a map of node ID to node
 */
export function buildNodeMap(rootNode: any): Record<string, any> {
  const map: Record<string, any> = {};

  function traverse(node: any) {
    map[node.id] = node;

    if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }

  traverse(rootNode);
  return map;
}
