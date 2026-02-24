/**
 * Design Extractor - Main entry point for complete Figma data extraction
 *
 * Orchestrates the extraction process:
 * 1. Parse API response
 * 2. Walk node tree with extractors
 * 3. Build globalVars deduplication
 * 4. Return complete design
 */

import { parseAPIResponse } from './api-parser.js';
import { walkDocument } from './node-walker.js';
import type {
  CompleteFigmaDesign,
  ExtractionContext,
  ExtractionOptions,
  ExtractorFn,
  ComponentDefinition,
  ComponentSetDefinition,
  TextStyleDefinition,
  FillStyleDefinition,
  StrokeStyleDefinition,
  EffectStyleDefinition,
  GridStyleDefinition,
  VariableDefinition,
} from './types.js';

/**
 * Extract complete design from raw Figma API response
 */
export function extractCompleteDesign(
  rawApiResponse: any,
  extractors: ExtractorFn[],
  options: ExtractionOptions = {}
): CompleteFigmaDesign {
  // Parse API response
  const parsedData = parseAPIResponse(rawApiResponse);

  // Initialize globalVars for deduplication
  const globalVars: CompleteFigmaDesign['globalVars'] = {
    layouts: {},
    textStyles: {},
    fills: {},
    strokes: {},
    effects: {},
  };

  // Build extraction context
  const context: ExtractionContext = {
    components: parsedData.components,
    componentSets: parsedData.componentSets,
    styles: parsedData.styles,
    variables: parsedData.variables,
    variableCollections: parsedData.variableCollections,
    globalVars,
    depth: 0,
    maxDepth: options.maxDepth,
    preserveHiddenNodes: options.preserveHiddenNodes ?? false,
    includeAbsoluteBounds: options.includeAbsoluteBounds ?? true,
    includeRelativeTransform: options.includeRelativeTransform ?? true,
  };

  // Walk document tree with extractors
  const nodes = walkDocument(parsedData.document, extractors, context);

  // Transform component definitions
  const components: Record<string, ComponentDefinition> = {};
  Object.entries(parsedData.components).forEach(([key, raw]) => {
    components[key] = transformComponentDefinition(raw);
  });

  // Transform component set definitions
  const componentSets: Record<string, ComponentSetDefinition> = {};
  Object.entries(parsedData.componentSets).forEach(([key, raw]) => {
    componentSets[key] = transformComponentSetDefinition(raw);
  });

  // Transform style definitions
  const styles = {
    text: transformStyles(parsedData.styles.text) as Record<string, TextStyleDefinition>,
    fill: transformStyles(parsedData.styles.fill) as Record<string, FillStyleDefinition>,
    stroke: transformStyles(parsedData.styles.stroke) as Record<string, StrokeStyleDefinition>,
    effect: transformStyles(parsedData.styles.effect) as Record<string, EffectStyleDefinition>,
    grid: transformStyles(parsedData.styles.grid) as Record<string, GridStyleDefinition>,
  };

  // Transform variable definitions
  const variables = {
    colors: {} as Record<string, VariableDefinition>,
    numbers: {} as Record<string, VariableDefinition>,
    strings: {} as Record<string, VariableDefinition>,
    booleans: {} as Record<string, VariableDefinition>,
  };

  Object.entries(parsedData.variables).forEach(([key, raw]) => {
    const varDef = transformVariableDefinition(raw);
    switch (varDef.resolvedType) {
      case 'COLOR':
        variables.colors[key] = varDef;
        break;
      case 'FLOAT':
        variables.numbers[key] = varDef;
        break;
      case 'STRING':
        variables.strings[key] = varDef;
        break;
      case 'BOOLEAN':
        variables.booleans[key] = varDef;
        break;
    }
  });

  // Build complete design
  const design: CompleteFigmaDesign = {
    name: parsedData.name,
    version: parsedData.version,
    lastModified: parsedData.lastModified,
    schemaVersion: parsedData.schemaVersion,
    nodes,
    components,
    componentSets,
    styles,
    variables,
    variableCollections: parsedData.variableCollections,
    globalVars,
  };

  return design;
}

/**
 * Transform component definition (preserve all properties)
 */
function transformComponentDefinition(raw: any): ComponentDefinition {
  return {
    id: raw.id,
    key: raw.key,
    name: raw.name,
    description: raw.description,
    documentationLinks: raw.documentationLinks,
    componentPropertyDefinitions: raw.componentPropertyDefinitions,
    remote: raw.remote,
    componentSetId: raw.componentSetId,
  };
}

/**
 * Transform component set definition (preserve all properties)
 */
function transformComponentSetDefinition(raw: any): ComponentSetDefinition {
  return {
    id: raw.id,
    key: raw.key,
    name: raw.name,
    description: raw.description,
    documentationLinks: raw.documentationLinks,
    componentPropertyDefinitions: raw.componentPropertyDefinitions,
    variantGroupProperties: raw.variantGroupProperties,
  };
}

/**
 * Transform style definitions
 */
function transformStyles(rawStyles: Record<string, any>): Record<string, any> {
  const transformed: Record<string, any> = {};

  Object.entries(rawStyles).forEach(([key, raw]) => {
    transformed[key] = {
      key: raw.key,
      name: raw.name,
      description: raw.description,
      remote: raw.remote,
      styleType: raw.styleType,
      ...raw, // Preserve all other properties
    };
  });

  return transformed;
}

/**
 * Transform variable definition
 */
function transformVariableDefinition(raw: any): VariableDefinition {
  return {
    id: raw.id,
    name: raw.name,
    key: raw.key,
    variableCollectionId: raw.variableCollectionId,
    resolvedType: raw.resolvedType,
    valuesByMode: raw.valuesByMode,
    scopes: raw.scopes || [],
    codeSyntax: raw.codeSyntax,
    description: raw.description,
    hiddenFromPublishing: raw.hiddenFromPublishing,
  };
}

/**
 * Get default extraction options
 */
export function getDefaultOptions(): ExtractionOptions {
  return {
    maxDepth: undefined,
    preserveHiddenNodes: false,
    includeAbsoluteBounds: true,
    includeRelativeTransform: true,
  };
}
