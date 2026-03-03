/**
 * Component Extractor - Extracts component-related properties
 *
 * Preserves CRITICAL component data including:
 * - Component ID and references
 * - Component Set ID (for variants)
 * - Component properties (VARIANT, TEXT, BOOLEAN, INSTANCE_SWAP)
 * - Component property references (which nodes are affected)
 * - Instance overrides
 *
 * This extractor is CRITICAL for preserving component metadata that was
 * previously lost in Framelink's simplification.
 */

import type { ExtractorFn, ComponentProperty } from '../types.js';
import { getComponent, getComponentSet, isComponent, isComponentSet, isInstance } from '../api-parser.js';

export const componentExtractor: ExtractorFn = (node, result, context) => {
  // Extract component ID (for COMPONENT nodes)
  if (isComponent(node)) {
    result.componentId = node.id;

    // Check if this component belongs to a component set
    const component = getComponent(node.id, {
      components: context.components,
      componentSets: context.componentSets,
      styles: context.styles,
      variables: context.variables,
      variableCollections: context.variableCollections,
      document: null,
      schemaVersion: 0,
      name: '',
      version: '',
      lastModified: '',
    });

    if (component?.componentSetId) {
      result.componentSetId = component.componentSetId;
    }
  }

  // Extract component set ID (for COMPONENT_SET nodes)
  if (isComponentSet(node)) {
    result.componentSetId = node.id;
  }

  // Extract instance properties (for INSTANCE nodes)
  if (isInstance(node)) {
    // Reference to main component
    if (node.componentId) {
      result.componentId = node.componentId;
    }

    // Component properties (instance overrides)
    if (node.componentProperties) {
      result.componentProperties = extractComponentProperties(node.componentProperties);
    }

    // Component property references — resolve node IDs to names/types for
    // downstream consumers (LLM prompt, code generation) so they know which
    // child element each property controls.
    if (node.componentPropertyReferences) {
      result.componentPropertyReferences = resolvePropertyReferences(
        node.componentPropertyReferences,
        node,
      );
    }

    // Main component reference (if available)
    if (node.mainComponent) {
      result.mainComponent = node.mainComponent;
    }

    // Check if this instance's main component belongs to a component set
    if (node.componentId) {
      const component = getComponent(node.componentId, {
        components: context.components,
        componentSets: context.componentSets,
        styles: context.styles,
        variables: context.variables,
        variableCollections: context.variableCollections,
        document: null,
        schemaVersion: 0,
        name: '',
        version: '',
        lastModified: '',
      });

      if (component?.componentSetId) {
        result.componentSetId = component.componentSetId;
      }
    }

    // Overrides (detached instance properties)
    if (node.overrides) {
      result.overrides = node.overrides;
    }
  }

  // Extract reactions (prototype interactions)
  if (node.reactions && Array.isArray(node.reactions) && node.reactions.length > 0) {
    result.reactions = node.reactions;
  }

  // Extract transition properties
  if (node.transitionNodeID) {
    result.transitionNodeID = node.transitionNodeID;
  }

  if (node.transitionDuration) {
    result.transitionDuration = node.transitionDuration;
  }

  if (node.transitionEasing) {
    result.transitionEasing = node.transitionEasing;
  }
};

/**
 * Find a node by ID in the raw Figma tree (pre-extraction).
 */
function findNodeById(root: any, targetId: string): any | null {
  if (root.id === targetId) return root;
  if (root.children && Array.isArray(root.children)) {
    for (const child of root.children) {
      const found = findNodeById(child, targetId);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Resolve component property references from raw node IDs to enriched objects
 * with node name, type, and the property aspects they control.
 */
function resolvePropertyReferences(
  refs: Record<string, string>,
  instanceNode: any,
): Record<string, any> {
  const resolved: Record<string, any> = {};

  for (const [propName, nodeId] of Object.entries(refs)) {
    const targetNode = findNodeById(instanceNode, nodeId);
    if (targetNode) {
      resolved[propName] = {
        nodeId,
        nodeName: targetNode.name,
        nodeType: targetNode.type,
      };
    } else {
      // Node not found in subtree — store raw ID
      resolved[propName] = { nodeId };
    }
  }

  return resolved;
}

/**
 * Extract component properties (preserve all metadata)
 */
function extractComponentProperties(
  rawProperties: Record<string, any>
): Record<string, ComponentProperty> {
  const properties: Record<string, ComponentProperty> = {};

  for (const [name, rawProp] of Object.entries(rawProperties)) {
    properties[name] = {
      type: rawProp.type,
      value: rawProp.value,
    };

    // Preserve preferred values for INSTANCE_SWAP
    if (rawProp.preferredValues) {
      properties[name].preferredValues = rawProp.preferredValues;
    }

    // Preserve bound variables
    if (rawProp.boundVariables) {
      properties[name].boundVariables = rawProp.boundVariables;
    }
  }

  return properties;
}

/**
 * Helper to check if a node is a component or instance
 */
export function isComponentOrInstance(node: any): boolean {
  return isComponent(node) || isInstance(node);
}

/**
 * Helper to get component property definitions for a node
 */
export function getComponentPropertyDefinitionsForNode(
  node: any,
  context: any
): Record<string, any> | null {
  const parsedData = {
    components: context.components,
    componentSets: context.componentSets,
    styles: context.styles,
    variables: context.variables,
    variableCollections: context.variableCollections,
    document: null,
    schemaVersion: 0,
    name: '',
    version: '',
    lastModified: '',
  };

  // For components, get from component metadata
  if (isComponent(node)) {
    const component = getComponent(node.id, parsedData);
    return component?.componentPropertyDefinitions || null;
  }

  // For component sets, get from component set metadata
  if (isComponentSet(node)) {
    const componentSet = getComponentSet(node.id, parsedData);
    return componentSet?.componentPropertyDefinitions || null;
  }

  // For instances, get from main component
  if (isInstance(node) && node.componentId) {
    const component = getComponent(node.componentId, parsedData);
    return component?.componentPropertyDefinitions || null;
  }

  return null;
}

/**
 * Helper to classify component property types
 */
export function classifyComponentProperties(
  propertyDefinitions: Record<string, any>
): {
  variantProps: string[];
  textProps: string[];
  booleanProps: string[];
  instanceSwapProps: string[];
} {
  const variantProps: string[] = [];
  const textProps: string[] = [];
  const booleanProps: string[] = [];
  const instanceSwapProps: string[] = [];

  for (const [name, def] of Object.entries(propertyDefinitions)) {
    switch (def.type) {
      case 'VARIANT':
        variantProps.push(name);
        break;
      case 'TEXT':
        textProps.push(name);
        break;
      case 'BOOLEAN':
        booleanProps.push(name);
        break;
      case 'INSTANCE_SWAP':
        instanceSwapProps.push(name);
        break;
    }
  }

  return {
    variantProps,
    textProps,
    booleanProps,
    instanceSwapProps,
  };
}

/**
 * Helper to extract icon slot properties from INSTANCE_SWAP definitions
 */
export function extractIconSlotProperties(
  propertyDefinitions: Record<string, any>
): Array<{
  name: string;
  type: 'INSTANCE_SWAP';
  defaultValue: string;
  preferredValues?: any[];
}> {
  const iconSlots: any[] = [];

  for (const [name, def] of Object.entries(propertyDefinitions)) {
    if (def.type === 'INSTANCE_SWAP') {
      iconSlots.push({
        name,
        type: 'INSTANCE_SWAP',
        defaultValue: def.defaultValue,
        preferredValues: def.preferredValues,
      });
    }
  }

  return iconSlots;
}

/**
 * Helper to extract text content properties from TEXT definitions
 */
export function extractTextContentProperties(
  propertyDefinitions: Record<string, any>
): Array<{
  name: string;
  type: 'TEXT';
  defaultValue: string;
}> {
  const textProps: any[] = [];

  for (const [name, def] of Object.entries(propertyDefinitions)) {
    if (def.type === 'TEXT') {
      textProps.push({
        name,
        type: 'TEXT',
        defaultValue: def.defaultValue,
      });
    }
  }

  return textProps;
}

/**
 * Helper to extract boolean visibility properties from BOOLEAN definitions
 */
export function extractBooleanVisibilityProperties(
  propertyDefinitions: Record<string, any>
): Array<{
  name: string;
  type: 'BOOLEAN';
  defaultValue: boolean;
}> {
  const boolProps: any[] = [];

  for (const [name, def] of Object.entries(propertyDefinitions)) {
    if (def.type === 'BOOLEAN') {
      boolProps.push({
        name,
        type: 'BOOLEAN',
        defaultValue: def.defaultValue,
      });
    }
  }

  return boolProps;
}
