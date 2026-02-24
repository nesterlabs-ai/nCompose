/**
 * Built-in Extractors - Pre-configured extractor combinations
 *
 * Exports individual extractors and convenient combinations for
 * common extraction scenarios.
 */

import type { ExtractorFn } from '../types.js';
import { layoutExtractor } from './layout.js';
import { textExtractor } from './text.js';
import { visualsExtractor } from './visuals.js';
import { componentExtractor } from './component.js';
import { variablesExtractor } from './variables.js';
import { hierarchyExtractor } from './hierarchy.js';

// Export individual extractors
export { layoutExtractor } from './layout.js';
export { textExtractor } from './text.js';
export { visualsExtractor } from './visuals.js';
export { componentExtractor } from './component.js';
export { variablesExtractor } from './variables.js';
export { hierarchyExtractor } from './hierarchy.js';

/**
 * All extractors in recommended order
 *
 * Order matters:
 * 1. Hierarchy first (establishes parent relationships)
 * 2. Layout (geometry and positioning)
 * 3. Text (text content and styling)
 * 4. Visuals (fills, strokes, effects)
 * 5. Component (component properties - CRITICAL)
 * 6. Variables last (validates and enhances variable bindings)
 */
export const allExtractors: ExtractorFn[] = [
  hierarchyExtractor,
  layoutExtractor,
  textExtractor,
  visualsExtractor,
  componentExtractor,
  variablesExtractor,
];

/**
 * Basic extractors (no component or variable extraction)
 *
 * Use for simple designs without components or variables
 */
export const basicExtractors: ExtractorFn[] = [
  hierarchyExtractor,
  layoutExtractor,
  textExtractor,
  visualsExtractor,
];

/**
 * Component-focused extractors
 *
 * Use when you specifically need component metadata
 * but don't care about detailed layout/visual extraction
 */
export const componentExtractors: ExtractorFn[] = [
  hierarchyExtractor,
  componentExtractor,
  variablesExtractor,
];

/**
 * Layout-only extractors
 *
 * Use for extracting just layout properties
 */
export const layoutOnlyExtractors: ExtractorFn[] = [
  hierarchyExtractor,
  layoutExtractor,
];

/**
 * Visuals-only extractors
 *
 * Use for extracting just visual properties (fills, strokes, effects)
 */
export const visualsOnlyExtractors: ExtractorFn[] = [
  hierarchyExtractor,
  visualsExtractor,
  variablesExtractor,
];

/**
 * Text-only extractors
 *
 * Use for extracting just text content and styling
 */
export const textOnlyExtractors: ExtractorFn[] = [
  hierarchyExtractor,
  textExtractor,
];

/**
 * Create custom extractor combination
 */
export function createExtractorCombination(
  extractors: ExtractorFn[]
): ExtractorFn[] {
  // Always include hierarchy extractor first if not already present
  const hasHierarchy = extractors.some(
    (e) => e === hierarchyExtractor
  );

  if (!hasHierarchy) {
    return [hierarchyExtractor, ...extractors];
  }

  return extractors;
}

/**
 * Compose multiple extractors into a single extractor
 */
export function composeExtractors(
  ...extractors: ExtractorFn[]
): ExtractorFn {
  return (node, result, context) => {
    for (const extractor of extractors) {
      extractor(node, result, context);
    }
  };
}

/**
 * Create a conditional extractor
 */
export function conditionalExtractor(
  condition: (node: any, context: any) => boolean,
  extractor: ExtractorFn
): ExtractorFn {
  return (node, result, context) => {
    if (condition(node, context)) {
      extractor(node, result, context);
    }
  };
}

/**
 * Create an extractor that only runs on specific node types
 */
export function nodeTypeExtractor(
  nodeTypes: string[],
  extractor: ExtractorFn
): ExtractorFn {
  return conditionalExtractor(
    (node) => nodeTypes.includes(node.type),
    extractor
  );
}

/**
 * Create an extractor that only runs on nodes matching a predicate
 */
export function predicateExtractor(
  predicate: (node: any, context: any) => boolean,
  extractor: ExtractorFn
): ExtractorFn {
  return conditionalExtractor(predicate, extractor);
}

/**
 * Create an extractor with error handling
 */
export function safeExtractor(
  extractor: ExtractorFn,
  onError?: (error: Error, node: any) => void
): ExtractorFn {
  return (node, result, context) => {
    try {
      extractor(node, result, context);
    } catch (error) {
      if (onError) {
        onError(error as Error, node);
      } else {
        console.warn(`Extractor failed for node ${node.id}:`, error);
      }
    }
  };
}

/**
 * Create an extractor that logs its execution
 */
export function debugExtractor(
  extractor: ExtractorFn,
  label?: string
): ExtractorFn {
  return (node, result, context) => {
    console.log(`[${label || 'Extractor'}] Processing node ${node.id} (${node.type})`);
    extractor(node, result, context);
    console.log(`[${label || 'Extractor'}] Completed node ${node.id}`);
  };
}

/**
 * Default extractor set (recommended for most use cases)
 */
export const defaultExtractors = allExtractors;
