/**
 * API Parser - Extracts metadata from raw Figma REST API responses
 *
 * Parses components, componentSets, styles, and variables from the API response
 * to provide a structured metadata object for the extraction process.
 */

import type { ParsedAPIData } from './types.js';

/**
 * Parse raw Figma API response into structured metadata
 * Handles both GetFileResponse and GetFileNodesResponse formats
 */
export function parseAPIResponse(rawResponse: any): ParsedAPIData {
  // Handle GetFileNodesResponse (when fetching specific node)
  let document;
  if (rawResponse.nodes && typeof rawResponse.nodes === 'object' && !Array.isArray(rawResponse.nodes)) {
    // GetFileNodesResponse: nodes is a dictionary { nodeId: { document: {...} } }
    const nodeIds = Object.keys(rawResponse.nodes);
    if (nodeIds.length > 0) {
      document = rawResponse.nodes[nodeIds[0]].document;
    } else {
      document = { type: 'DOCUMENT', children: [] };
    }
  } else {
    // GetFileResponse: document is at top level
    document = rawResponse.document || rawResponse;
  }

  // Extract metadata
  const name = rawResponse.name || document.name || 'Untitled';
  const version = rawResponse.version || '1.0';
  const lastModified = rawResponse.lastModified || new Date().toISOString();
  const schemaVersion = rawResponse.schemaVersion || 0;

  // Parse components from top-level API response
  const components: Record<string, any> = {};
  if (rawResponse.components) {
    Object.entries(rawResponse.components).forEach(([key, component]) => {
      components[key] = component;
    });
  }

  // Parse component sets from top-level API response
  const componentSets: Record<string, any> = {};
  if (rawResponse.componentSets) {
    Object.entries(rawResponse.componentSets).forEach(([key, componentSet]) => {
      componentSets[key] = componentSet;
    });
  }

  // IMPORTANT: When fetching a specific COMPONENT_SET node, it won't be in the
  // top-level componentSets dictionary. We need to check if the fetched node
  // itself is a COMPONENT_SET and extract its properties directly.
  if (document.type === 'COMPONENT_SET' && document.componentPropertyDefinitions) {
    // Add it to componentSets using its ID
    const nodeId = document.id;
    componentSets[nodeId] = {
      id: nodeId,
      key: document.key || nodeId,
      name: document.name,
      description: document.description,
      documentationLinks: document.documentationLinks,
      componentPropertyDefinitions: document.componentPropertyDefinitions,
      variantGroupProperties: document.variantGroupProperties,
    };
  }

  // Parse styles from top-level API response
  const styles = {
    text: {} as Record<string, any>,
    fill: {} as Record<string, any>,
    stroke: {} as Record<string, any>,
    effect: {} as Record<string, any>,
    grid: {} as Record<string, any>,
  };

  if (rawResponse.styles) {
    Object.entries(rawResponse.styles).forEach(([key, style]: [string, any]) => {
      switch (style.styleType) {
        case 'TEXT':
          styles.text[key] = style;
          break;
        case 'FILL':
          styles.fill[key] = style;
          break;
        case 'STROKE':
          styles.stroke[key] = style;
          break;
        case 'EFFECT':
          styles.effect[key] = style;
          break;
        case 'GRID':
          styles.grid[key] = style;
          break;
      }
    });
  }

  // Parse variables from API response
  const variables: Record<string, any> = {};
  if (rawResponse.meta?.variables) {
    Object.entries(rawResponse.meta.variables).forEach(([key, variable]) => {
      variables[key] = variable;
    });
  }

  // Parse variable collections
  const variableCollections: Record<string, any> = {};
  if (rawResponse.meta?.variableCollections) {
    Object.entries(rawResponse.meta.variableCollections).forEach(([key, collection]) => {
      variableCollections[key] = collection;
    });
  }

  return {
    document,
    components,
    componentSets,
    styles,
    variables,
    variableCollections,
    schemaVersion,
    name,
    version,
    lastModified,
  };
}

/**
 * Get component definition by ID
 */
export function getComponent(
  componentId: string,
  parsedData: ParsedAPIData
): any | null {
  // Try components map first
  if (parsedData.components[componentId]) {
    return parsedData.components[componentId];
  }

  // Try component key
  for (const component of Object.values(parsedData.components)) {
    if (component.key === componentId || component.id === componentId) {
      return component;
    }
  }

  return null;
}

/**
 * Get component set definition by ID
 */
export function getComponentSet(
  componentSetId: string,
  parsedData: ParsedAPIData
): any | null {
  // Try componentSets map first
  if (parsedData.componentSets[componentSetId]) {
    return parsedData.componentSets[componentSetId];
  }

  // Try component set key
  for (const componentSet of Object.values(parsedData.componentSets)) {
    if (componentSet.key === componentSetId || componentSet.id === componentSetId) {
      return componentSet;
    }
  }

  return null;
}

/**
 * Get style definition by ID
 */
export function getStyle(
  styleId: string,
  styleType: 'text' | 'fill' | 'stroke' | 'effect' | 'grid',
  parsedData: ParsedAPIData
): any | null {
  const stylesMap = parsedData.styles[styleType];

  if (stylesMap[styleId]) {
    return stylesMap[styleId];
  }

  // Try style key
  for (const style of Object.values(stylesMap)) {
    if (style.key === styleId || style.id === styleId) {
      return style;
    }
  }

  return null;
}

/**
 * Get variable definition by ID
 */
export function getVariable(
  variableId: string,
  parsedData: ParsedAPIData
): any | null {
  if (parsedData.variables[variableId]) {
    return parsedData.variables[variableId];
  }

  // Try variable key
  for (const variable of Object.values(parsedData.variables)) {
    if (variable.key === variableId || variable.id === variableId) {
      return variable;
    }
  }

  return null;
}

/**
 * Resolve variable alias to actual value
 */
export function resolveVariableValue(
  variableId: string,
  modeId: string | undefined,
  parsedData: ParsedAPIData
): any | null {
  const variable = getVariable(variableId, parsedData);

  if (!variable) {
    return null;
  }

  // Get value for specific mode, or use the collection's default mode,
  // or fall back to the first available mode.
  let targetModeId = modeId;
  if (!targetModeId) {
    // Look up the variable's collection to find its declared default mode
    const collection = parsedData.variableCollections?.[variable.variableCollectionId];
    targetModeId = collection?.defaultModeId
      ?? collection?.modes?.[0]?.modeId
      ?? Object.keys(variable.valuesByMode)[0];
  }

  if (!targetModeId) {
    return null;
  }

  if (variable.valuesByMode[targetModeId] !== undefined) {
    return variable.valuesByMode[targetModeId];
  }

  return null;
}

/**
 * Check if a node is a component
 */
export function isComponent(node: any): boolean {
  return node.type === 'COMPONENT';
}

/**
 * Check if a node is a component set
 */
export function isComponentSet(node: any): boolean {
  return node.type === 'COMPONENT_SET';
}

/**
 * Check if a node is an instance
 */
export function isInstance(node: any): boolean {
  return node.type === 'INSTANCE';
}

/**
 * Get all components from parsed data
 */
export function getAllComponents(parsedData: ParsedAPIData): any[] {
  return Object.values(parsedData.components);
}

/**
 * Get all component sets from parsed data
 */
export function getAllComponentSets(parsedData: ParsedAPIData): any[] {
  return Object.values(parsedData.componentSets);
}

/**
 * Get component property definitions for a node
 */
export function getComponentPropertyDefinitions(
  node: any,
  parsedData: ParsedAPIData
): Record<string, any> | null {
  // Check if this is a component
  if (isComponent(node) && node.id) {
    const component = getComponent(node.id, parsedData);
    if (component?.componentPropertyDefinitions) {
      return component.componentPropertyDefinitions;
    }
  }

  // Check if this is a component set
  if (isComponentSet(node) && node.id) {
    const componentSet = getComponentSet(node.id, parsedData);
    if (componentSet?.componentPropertyDefinitions) {
      return componentSet.componentPropertyDefinitions;
    }
  }

  // Check if this is an instance - get from main component
  if (isInstance(node) && node.componentId) {
    const component = getComponent(node.componentId, parsedData);
    if (component?.componentPropertyDefinitions) {
      return component.componentPropertyDefinitions;
    }
  }

  return null;
}
