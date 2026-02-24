/**
 * Component Transformers - Transform component data to clean structures
 *
 * These transformers are already integrated into design-extractor.ts
 * This file provides additional utility transforms.
 */

import type {
  ComponentDefinition,
  ComponentSetDefinition,
  ComponentProperty,
  ComponentPropertyDefinition,
} from '../types.js';

/**
 * Transform component property value to string representation
 */
export function componentPropertyValueToString(prop: ComponentProperty): string {
  if (typeof prop.value === 'boolean') {
    return prop.value ? 'true' : 'false';
  }
  return String(prop.value);
}

/**
 * Transform component property definition to a human-readable description
 */
export function componentPropertyDefinitionToDescription(
  name: string,
  def: ComponentPropertyDefinition
): string {
  switch (def.type) {
    case 'VARIANT':
      return `${name}: variant (options: ${def.variantOptions?.join(', ') || 'none'})`;
    case 'TEXT':
      return `${name}: text (default: "${def.defaultValue}")`;
    case 'BOOLEAN':
      return `${name}: boolean (default: ${def.defaultValue})`;
    case 'INSTANCE_SWAP':
      return `${name}: instance swap (swappable component)`;
    default:
      return `${name}: ${def.type}`;
  }
}

/**
 * Get all property names of a specific type
 */
export function getPropertiesByType(
  propertyDefinitions: Record<string, ComponentPropertyDefinition>,
  type: 'VARIANT' | 'TEXT' | 'BOOLEAN' | 'INSTANCE_SWAP'
): string[] {
  return Object.entries(propertyDefinitions)
    .filter(([, def]) => def.type === type)
    .map(([name]) => name);
}

/**
 * Convert component property definitions to a flat list
 */
export function flattenComponentPropertyDefinitions(
  defs: Record<string, ComponentPropertyDefinition>
): Array<{ name: string; definition: ComponentPropertyDefinition }> {
  return Object.entries(defs).map(([name, definition]) => ({
    name,
    definition,
  }));
}

/**
 * Merge component property definitions (for inheritance scenarios)
 */
export function mergeComponentPropertyDefinitions(
  base: Record<string, ComponentPropertyDefinition>,
  override: Record<string, ComponentPropertyDefinition>
): Record<string, ComponentPropertyDefinition> {
  return { ...base, ...override };
}
