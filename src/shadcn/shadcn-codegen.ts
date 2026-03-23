/**
 * shadcn/ui Codegen Orchestrator
 *
 * Coordinates: read base source from starter → extract Figma styles → LLM → parse two files
 */

import type { LLMProvider } from '../llm/provider.js';
import type { AssetEntry } from '../types/index.js';
import { makeColorInheritable } from '../figma/asset-export.js';
import { getShadcnComponentType } from './shadcn-types.js';
import type { ShadcnCodegenResult } from './shadcn-types.js';
import { readShadcnSource } from './shadcn-source-reader.js';
import { extractVariantStyles, extractNodeStyle } from './style-extractor.js';
import { extractComponentContent } from './content-extractor.js';
import {
  buildShadcnSystemPrompt,
  buildShadcnUserPrompt,
  buildShadcnSingleComponentSystemPrompt,
  buildShadcnSingleComponentUserPrompt,
  buildShadcnInlineComponentSystemPrompt,
  buildShadcnInlineComponentUserPrompt,
  buildShadcnStructuralSystemPrompt,
  buildShadcnStructuralUserPrompt,
  type LeafComponentInfo,
} from './shadcn-prompt-builder.js';

/**
 * Generate a shadcn component from a COMPONENT_SET node (PATH A).
 */
export async function generateShadcnComponentSet(
  rootNode: any,
  formRoleOrCategory: string,
  componentSetData: any,
  componentName: string,
  llm: LLMProvider,
  onStep?: (step: string) => void,
  assets?: AssetEntry[],
): Promise<ShadcnCodegenResult> {
  const shadcnType = getShadcnComponentType(formRoleOrCategory);
  if (!shadcnType) throw new Error(`No shadcn mapping for "${formRoleOrCategory}"`);

  // 1. Read base source from starter template
  onStep?.(`[shadcn] Reading base ${shadcnType}.tsx from starter template...`);
  const baseShadcnSource = readShadcnSource(shadcnType);
  onStep?.(`[shadcn] Got ${baseShadcnSource.length} chars of base source`);

  // 2. Extract styles from ALL variant nodes
  onStep?.('[shadcn] Extracting styles from all Figma variants...');
  const variantStyles = extractVariantStyles(rootNode);
  const count = Object.keys(variantStyles.byVariant).length + Object.keys(variantStyles.byVariantState).length;
  onStep?.(`[shadcn] Extracted styles for ${count} variant/state combinations`);

  // 3. Extract content from default variant
  const defaultNode = componentSetData?.defaultVariantNode ?? rootNode?.children?.[0];
  const content = extractComponentContent(defaultNode, formRoleOrCategory);

  // 4. Build axes info
  const axes = (componentSetData?.axes ?? []).map((a: any) => ({
    name: a.name,
    values: a.values as string[],
  }));

  // 5. Boolean props
  const propDefs = componentSetData?.componentPropertyDefinitions ?? rootNode?.componentPropertyDefinitions;
  const booleanProps: Record<string, boolean> = {};
  if (propDefs && typeof propDefs === 'object') {
    for (const [name, def] of Object.entries(propDefs as Record<string, any>)) {
      if (def?.type === 'BOOLEAN') booleanProps[name] = def.defaultValue ?? true;
    }
  }

  // 6. Build prompt & call LLM
  const systemPrompt = buildShadcnSystemPrompt();
  const userPrompt = buildShadcnUserPrompt({
    componentName,
    shadcnType,
    baseShadcnSource,
    variantStyles,
    content,
    axes,
    booleanProps: Object.keys(booleanProps).length > 0 ? booleanProps : undefined,
    assets: assets && assets.length > 0
      ? assets.map((a: any) => ({
          filename: a.filename,
          parentName: a.parentName,
          variants: a.variants,
          dimensions: a.dimensions,
          svgContent: a.content ? makeColorInheritable(a.content) : undefined,
        }))
      : undefined,
  });

  onStep?.(`[shadcn] Generating via ${llm.name}...`);
  let rawResponse = await llm.generate(userPrompt, systemPrompt);
  let parsed = parseTwoCodeBlocks(rawResponse);

  // Retry once if parsing failed
  if (!parsed) {
    onStep?.('[shadcn] Retrying — could not parse two code blocks...');
    const retryPrompt = userPrompt + '\n\nIMPORTANT: Output EXACTLY two fenced code blocks. Block 1 = updated .tsx. Block 2 = consumer .jsx.';
    rawResponse = await llm.generate(retryPrompt, systemPrompt);
    parsed = parseTwoCodeBlocks(rawResponse);
  }

  if (!parsed) throw new Error('[shadcn] Failed to parse LLM output into two code blocks');

  onStep?.(`[shadcn] Generated ${shadcnType}.tsx (${parsed.block1.length} chars) + ${componentName}.jsx (${parsed.block2.length} chars)`);

  return {
    consumerCode: parsed.block2,
    updatedShadcnSource: parsed.block1,
    shadcnComponentName: shadcnType,
    componentName,
  };
}

/**
 * Generate a shadcn component from a single COMPONENT node (PATH B).
 * No CVA variants — just customizes the base template with Figma styles.
 */
export async function generateShadcnSingleComponent(
  rootNode: any,
  formRoleOrCategory: string,
  componentName: string,
  llm: LLMProvider,
  onStep?: (step: string) => void,
  assets?: AssetEntry[],
  nodeYaml?: string,
): Promise<ShadcnCodegenResult> {
  const shadcnType = getShadcnComponentType(formRoleOrCategory);
  if (!shadcnType) throw new Error(`No shadcn mapping for "${formRoleOrCategory}"`);

  onStep?.(`[shadcn] Reading base ${shadcnType}.tsx from starter template...`);
  const baseShadcnSource = readShadcnSource(shadcnType);

  // Extract styles from single node (not multi-variant)
  onStep?.('[shadcn] Extracting styles from Figma node...');
  const style = extractNodeStyle(rootNode);

  // Extract content
  const content = extractComponentContent(rootNode, formRoleOrCategory);

  // Boolean props
  const propDefs = rootNode?.componentPropertyDefinitions;
  const booleanProps: Record<string, boolean> = {};
  if (propDefs && typeof propDefs === 'object') {
    for (const [name, def] of Object.entries(propDefs as Record<string, any>)) {
      if (def?.type === 'BOOLEAN') booleanProps[name] = def.defaultValue ?? true;
    }
  }

  const systemPrompt = buildShadcnSingleComponentSystemPrompt();
  const userPrompt = buildShadcnSingleComponentUserPrompt({
    componentName,
    shadcnType,
    baseShadcnSource,
    style,
    content,
    booleanProps: Object.keys(booleanProps).length > 0 ? booleanProps : undefined,
    assets: assets && assets.length > 0
      ? assets.map((a: any) => ({
          filename: a.filename,
          parentName: a.parentName,
          dimensions: a.dimensions,
          svgContent: a.content ? makeColorInheritable(a.content) : undefined,
        }))
      : undefined,
    nodeYaml,
  });

  onStep?.(`[shadcn] Generating via ${llm.name}...`);
  let rawResponse = await llm.generate(userPrompt, systemPrompt);
  let parsed = parseTwoCodeBlocks(rawResponse);

  if (!parsed) {
    onStep?.('[shadcn] Retrying — could not parse two code blocks...');
    const retryPrompt = userPrompt + '\n\nIMPORTANT: Output EXACTLY two fenced code blocks. Block 1 = updated .tsx. Block 2 = consumer .jsx.';
    rawResponse = await llm.generate(retryPrompt, systemPrompt);
    parsed = parseTwoCodeBlocks(rawResponse);
  }

  if (!parsed) throw new Error('[shadcn] Failed to parse LLM output into two code blocks');

  onStep?.(`[shadcn] Generated ${shadcnType}.tsx (${parsed.block1.length} chars) + ${componentName}.jsx (${parsed.block2.length} chars)`);

  return {
    consumerCode: parsed.block2,
    updatedShadcnSource: parsed.block1,
    shadcnComponentName: shadcnType,
    componentName,
  };
}

/**
 * Generate inline JSX for a shadcn-supported sub-component within a page section (PATH C).
 * Returns { html, css } matching GeneratedComponent format.
 */
export async function generateShadcnInlineComponent(
  node: any,
  formRoleOrCategory: string,
  componentName: string,
  llm: LLMProvider,
  nodeYaml?: string,
): Promise<{ html: string; css: string }> {
  const shadcnType = getShadcnComponentType(formRoleOrCategory);
  if (!shadcnType) throw new Error(`No shadcn mapping for "${formRoleOrCategory}"`);

  const baseShadcnSource = readShadcnSource(shadcnType);
  const style = extractNodeStyle(node);
  const content = extractComponentContent(node, formRoleOrCategory);

  const systemPrompt = buildShadcnInlineComponentSystemPrompt();
  const userPrompt = buildShadcnInlineComponentUserPrompt(
    componentName, shadcnType, baseShadcnSource, style, content, nodeYaml,
  );

  let rawResponse = await llm.generate(userPrompt, systemPrompt);
  let html = parseOneCodeBlock(rawResponse);

  if (!html) {
    const retryPrompt = userPrompt + '\n\nIMPORTANT: Output EXACTLY one fenced code block with the JSX fragment.';
    rawResponse = await llm.generate(retryPrompt, systemPrompt);
    html = parseOneCodeBlock(rawResponse);
  }

  if (!html) throw new Error('[shadcn-inline] Failed to parse LLM output');

  return { html, css: '' };
}

/**
 * Generate a shadcn structural component (sidebar, table) from a single Figma node.
 * Unlike leaf components (button, input), structural components are layout-heavy:
 * the LLM composes many sub-components from the template library rather than
 * customizing a single element with CVA variants.
 */
export async function generateShadcnStructuralComponent(
  rootNode: any,
  formRoleOrCategory: string,
  componentName: string,
  llm: LLMProvider,
  onStep?: (step: string) => void,
  assets?: AssetEntry[],
  nodeYaml?: string,
  leafComponents?: LeafComponentInfo[],
): Promise<ShadcnCodegenResult> {
  const shadcnType = getShadcnComponentType(formRoleOrCategory);
  if (!shadcnType) throw new Error(`No shadcn mapping for "${formRoleOrCategory}"`);

  onStep?.(`[shadcn-structural] Reading base ${shadcnType}.tsx from starter template...`);
  const baseShadcnSource = readShadcnSource(shadcnType);

  if (!nodeYaml) throw new Error('[shadcn-structural] nodeYaml is required for structural components');

  const systemPrompt = buildShadcnStructuralSystemPrompt();
  const userPrompt = buildShadcnStructuralUserPrompt({
    componentName,
    shadcnType,
    baseShadcnSource,
    nodeYaml,
    assets: assets && assets.length > 0
      ? assets.map((a: any) => ({
          filename: a.filename,
          parentName: a.parentName,
          dimensions: a.dimensions,
          svgContent: a.content ? makeColorInheritable(a.content) : undefined,
        }))
      : undefined,
    leafComponents: leafComponents && leafComponents.length > 0 ? leafComponents : undefined,
  });

  onStep?.(`[shadcn-structural] Generating via ${llm.name}...`);
  let rawResponse = await llm.generate(userPrompt, systemPrompt);
  let parsed = parseTwoCodeBlocks(rawResponse);

  if (!parsed) {
    onStep?.('[shadcn-structural] Retrying — could not parse two code blocks...');
    const retryPrompt = userPrompt + '\n\nIMPORTANT: Output EXACTLY two fenced code blocks. Block 1 = the .tsx library source (unchanged). Block 2 = consumer .jsx.';
    rawResponse = await llm.generate(retryPrompt, systemPrompt);
    parsed = parseTwoCodeBlocks(rawResponse);
  }

  if (!parsed) throw new Error('[shadcn-structural] Failed to parse LLM output into two code blocks');

  onStep?.(`[shadcn-structural] Generated ${shadcnType}.tsx (${parsed.block1.length} chars) + ${componentName}.jsx (${parsed.block2.length} chars)`);

  return {
    consumerCode: parsed.block2,
    updatedShadcnSource: parsed.block1,
    shadcnComponentName: shadcnType,
    componentName,
  };
}

/**
 * Parse exactly two fenced code blocks from LLM output.
 */
function parseTwoCodeBlocks(raw: string): { block1: string; block2: string } | null {
  const blocks = parseCodeBlocks(raw);
  if (blocks.length < 2) return null;
  return { block1: blocks[0], block2: blocks[1] };
}

/**
 * Parse exactly one fenced code block from LLM output.
 */
function parseOneCodeBlock(raw: string): string | null {
  const blocks = parseCodeBlocks(raw);
  return blocks.length > 0 ? blocks[0] : null;
}

/**
 * Extract all fenced code blocks from LLM output.
 */
function parseCodeBlocks(raw: string): string[] {
  const regex = /```(?:tsx?|jsx?|typescript|javascript)?\s*\n([\s\S]*?)```/g;
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    const content = match[1].trim();
    if (content.length > 0) blocks.push(content);
  }
  return blocks;
}
