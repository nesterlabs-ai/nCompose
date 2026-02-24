/**
 * Variables Extractor - Extracts variable bindings from Figma nodes
 *
 * Preserves variable references including:
 * - Fill variable bindings
 * - Stroke variable bindings
 * - Effect variable bindings
 * - Text variable bindings
 * - Opacity variable bindings
 * - Component property variable bindings
 *
 * This extractor complements the visuals extractor by ensuring all
 * variable references are preserved (already extracted by visuals extractor,
 * but this validates and enhances them).
 */

import type { ExtractorFn } from '../types.js';
import { getVariable, resolveVariableValue } from '../api-parser.js';

export const variablesExtractor: ExtractorFn = (node, result, context) => {
  // Note: Most variable bindings are already extracted by their respective extractors
  // (visuals, component, etc.). This extractor validates and enhances them.

  // Validate fill variable bindings
  if (result.fillVariableIds) {
    validateVariableBindings(result.fillVariableIds, context);
  }

  // Validate stroke variable bindings
  if (result.strokeVariableIds) {
    validateVariableBindings(result.strokeVariableIds, context);
  }

  // Validate effect variable bindings
  if (result.effectVariableIds) {
    validateVariableBindings(result.effectVariableIds, context);
  }

  // Validate background variable bindings
  if (result.backgroundVariableIds) {
    validateVariableBindings(result.backgroundVariableIds, context);
  }

  // Validate opacity variable binding
  if (result.opacityVariableId) {
    validateVariableBinding(result.opacityVariableId, context);
  }

  // Validate component property variable bindings
  if (result.componentProperties) {
    for (const [, prop] of Object.entries(result.componentProperties)) {
      if (prop.boundVariables?.value) {
        validateVariableBinding(prop.boundVariables.value.id, context);
      }
    }
  }
};

/**
 * Validate that a variable exists in the context
 */
function validateVariableBinding(variableId: string, context: any): boolean {
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

  const variable = getVariable(variableId, parsedData);

  if (!variable) {
    console.warn(`Variable ${variableId} not found in context`);
    return false;
  }

  return true;
}

/**
 * Validate multiple variable bindings
 */
function validateVariableBindings(
  variableIds: Record<string, string>,
  context: any
): void {
  for (const variableId of Object.values(variableIds)) {
    validateVariableBinding(variableId, context);
  }
}

/**
 * Helper to resolve a variable value for a specific mode
 */
export function resolveVariable(
  variableId: string,
  modeId: string | undefined,
  context: any
): any | null {
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

  return resolveVariableValue(variableId, modeId, parsedData);
}

/**
 * Helper to get all variables of a specific type
 */
export function getVariablesByType(
  type: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN',
  context: any
): any[] {
  const variables: any[] = [];

  for (const variable of Object.values(context.variables)) {
    if ((variable as any).resolvedType === type) {
      variables.push(variable);
    }
  }

  return variables;
}

/**
 * Helper to check if a node has any variable bindings
 */
export function hasVariableBindings(node: any): boolean {
  return !!(
    node.fillVariableIds ||
    node.strokeVariableIds ||
    node.effectVariableIds ||
    node.backgroundVariableIds ||
    node.opacityVariableId ||
    (node.componentProperties &&
      Object.values(node.componentProperties).some(
        (prop: any) => prop.boundVariables?.value
      ))
  );
}

/**
 * Helper to extract all variable IDs from a node
 */
export function extractAllVariableIds(node: any): string[] {
  const variableIds: Set<string> = new Set();

  // Fill variables
  if (node.fillVariableIds) {
    Object.values(node.fillVariableIds).forEach((id) => variableIds.add(id as string));
  }

  // Stroke variables
  if (node.strokeVariableIds) {
    Object.values(node.strokeVariableIds).forEach((id) => variableIds.add(id as string));
  }

  // Effect variables
  if (node.effectVariableIds) {
    Object.values(node.effectVariableIds).forEach((id) => variableIds.add(id as string));
  }

  // Background variables
  if (node.backgroundVariableIds) {
    Object.values(node.backgroundVariableIds).forEach((id) =>
      variableIds.add(id as string)
    );
  }

  // Opacity variable
  if (node.opacityVariableId) {
    variableIds.add(node.opacityVariableId);
  }

  // Component property variables
  if (node.componentProperties) {
    for (const prop of Object.values(node.componentProperties)) {
      if ((prop as any).boundVariables?.value) {
        variableIds.add((prop as any).boundVariables.value.id);
      }
    }
  }

  return Array.from(variableIds);
}

/**
 * Helper to resolve all variable bindings for a node
 */
export function resolveAllVariables(
  node: any,
  modeId: string | undefined,
  context: any
): Record<string, any> {
  const resolved: Record<string, any> = {};

  const variableIds = extractAllVariableIds(node);

  for (const variableId of variableIds) {
    const value = resolveVariable(variableId, modeId, context);
    if (value !== null) {
      resolved[variableId] = value;
    }
  }

  return resolved;
}
