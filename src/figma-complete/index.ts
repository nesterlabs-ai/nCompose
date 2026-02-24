/**
 * Figma Complete Data Processing Library
 *
 * A comprehensive library for extracting complete design data from Figma REST API responses
 * with NO data loss. Preserves component properties, variables, styles, and all metadata.
 */

// Main extraction
export { extractCompleteDesign, getDefaultOptions } from './design-extractor.js';

// API parser
export {
  parseAPIResponse,
  getComponent,
  getComponentSet,
  getStyle,
  getVariable,
  resolveVariableValue,
  isComponent,
  isComponentSet,
  isInstance,
  getAllComponents,
  getAllComponentSets,
  getComponentPropertyDefinitions,
} from './api-parser.js';

// Node walker
export {
  walkNodeTree,
  walkNodes,
  walkDocument,
  createStyleHash,
  addToGlobalVars,
  safeGet,
  hasValue,
  copyProperties,
  deepClone,
} from './node-walker.js';

// Extractors
export {
  allExtractors,
  basicExtractors,
  componentExtractors,
  layoutOnlyExtractors,
  visualsOnlyExtractors,
  textOnlyExtractors,
  defaultExtractors,
  layoutExtractor,
  textExtractor,
  visualsExtractor,
  componentExtractor,
  variablesExtractor,
  hierarchyExtractor,
  createExtractorCombination,
  composeExtractors,
  conditionalExtractor,
  nodeTypeExtractor,
  predicateExtractor,
  safeExtractor,
  debugExtractor,
} from './extractors/built-in.js';

// Layout helpers
export { usesAutoLayout, getEffectiveSize } from './extractors/layout.js';

// Text helpers
export { isTextNode, getTextContent } from './extractors/text.js';

// Component helpers
export {
  isComponentOrInstance,
  getComponentPropertyDefinitionsForNode,
  classifyComponentProperties,
  extractIconSlotProperties,
  extractTextContentProperties,
  extractBooleanVisibilityProperties,
} from './extractors/component.js';

// Variables helpers
export {
  resolveVariable,
  getVariablesByType,
  hasVariableBindings,
  extractAllVariableIds,
  resolveAllVariables,
} from './extractors/variables.js';

// Hierarchy helpers
export {
  findParentNode,
  findNodeById,
  getAncestorIds,
  getDescendantIds,
  getNestingDepth,
  isAncestorOf,
  getSiblings,
  getChildIndex,
  flattenTree,
  buildNodeMap,
} from './extractors/hierarchy.js';

// Transformers - Component
export {
  componentPropertyValueToString,
  componentPropertyDefinitionToDescription,
  getPropertiesByType,
  flattenComponentPropertyDefinitions,
  mergeComponentPropertyDefinitions,
} from './transformers/component.js';

// Transformers - Layout
export { layoutToCss, extractInlineStyles } from './transformers/layout.js';

// Transformers - Style
export { colorToCss, paintToCssBackground } from './transformers/style.js';

// Transformers - Text
export { typeStyleToCss, escapeHtml } from './transformers/text.js';

// Transformers - Effects
export { effectToCss, effectsToCss } from './transformers/effects.js';

// Types - Re-export all types
export type * from './types.js';
