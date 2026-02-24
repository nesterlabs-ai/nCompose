import { dump } from 'js-yaml';
import { parseFigmaUrl } from './utils/figma-url-parser.js';
import { FigmaClient } from './figma/fetch.js';
import { extractCompleteDesign, allExtractors } from './figma-complete/index.js';
import { parseComponentSet, buildVariantCSS } from './figma/component-set-parser.js';
import {
  buildVariantPromptData,
  buildComponentSetUserPrompt,
  buildComponentSetSystemPrompt,
} from './figma/variant-prompt-builder.js';
import {
  collectAssetNodes,
  collectAssetNodesFromAllVariants,
  exportAssets,
  exportAssetsFromAllVariants,
  buildAssetMap,
  buildDimensionMap,
} from './figma/asset-export.js';
import { injectCSS } from './compile/inject-css.js';
import { createLLMProvider } from './llm/index.js';
import { assembleSystemPrompt, assembleUserPrompt } from './prompt/index.js';
import { generateWithRetry } from './compile/retry.js';
import { generateFrameworkCode } from './compile/generate.js';
import type { ConvertOptions, ConversionResult, Framework } from './types/index.js';

export interface ConvertCallbacks {
  onStep?: (step: string) => void;
  onAttempt?: (attempt: number, maxRetries: number, error?: string) => void;
  onDebugData?: (data: { yamlContent: string; rawLLMOutput: string }) => void;
}

/**
 * Detects if the simplified Figma data contains a COMPONENT_SET node.
 */
function isComponentSet(enhanced: any): boolean {
  const nodes = enhanced?.nodes;
  if (!nodes || !Array.isArray(nodes)) return false;
  return nodes[0]?.type === 'COMPONENT_SET';
}

/**
 * Extracts a trimmed YAML representation of the default variant's Figma node.
 * Only includes structural info relevant for the LLM prompt.
 */
function extractDefaultVariantYaml(node: any): string {
  if (!node) return '';
  const trimmed = trimNodeForPrompt(node);
  return dump(trimmed, { lineWidth: 120, noRefs: true });
}

function trimNodeForPrompt(node: any): any {
  // Skip internal metadata nodes (Figma convention: _prefix)
  if (node.name?.startsWith('_')) return null;

  const result: any = { name: node.name, type: node.type };
  if (node.text) result.text = node.text;
  if (node.textStyle) result.textStyle = node.textStyle;
  if (node.fills) result.fills = node.fills;
  if (node.borderRadius) result.borderRadius = node.borderRadius;
  if (node.children) {
    result.children = node.children.map(trimNodeForPrompt).filter(Boolean);
  }
  return result;
}

/**
 * Core pipeline: Figma URL → framework code.
 *
 * Two paths:
 * A) COMPONENT_SET → parse variants → LLM generates class-based Mitosis component
 *    → Mitosis compiles → inject deterministic CSS
 * B) Single component → LLM generates Mitosis with css={{}} → Mitosis compiles
 *
 * This function is decoupled from CLI/IO for testability.
 */
export async function convertFigmaToCode(
  figmaUrl: string,
  options: ConvertOptions,
  callbacks?: ConvertCallbacks,
): Promise<ConversionResult> {
  const onStep = callbacks?.onStep;

  // Step 1: Parse URL
  onStep?.('Parsing Figma URL...');
  const { fileKey, nodeId } = parseFigmaUrl(figmaUrl);

  // Step 2: Fetch from Figma API
  onStep?.(`Fetching from Figma: file=${fileKey}, node=${nodeId ?? 'root'}...`);
  const figmaToken = process.env.FIGMA_TOKEN;
  if (!figmaToken) {
    throw new Error(
      'FIGMA_TOKEN environment variable is required.\n' +
      'Generate one at: Figma → Settings → Account → Personal access tokens',
    );
  }

  const client = new FigmaClient(figmaToken);
  const rawData = nodeId
    ? await client.getNode(fileKey, nodeId, options.depth)
    : await client.getFile(fileKey, options.depth);

  // Step 3: Extract complete design data (preserves ALL properties)
  onStep?.('Extracting complete design data...');
  const enhanced = extractCompleteDesign(rawData, allExtractors, {
    maxDepth: options.depth,
    preserveHiddenNodes: false,
    includeAbsoluteBounds: true,
    includeRelativeTransform: true,
  });

  // Convert to YAML for diagnostics / LLM
  const yamlContent = dump(enhanced, { lineWidth: 120, noRefs: true });

  // --- PATH A: Component Set (variant-aware) ---
  if (isComponentSet(enhanced)) {
    return convertComponentSet(enhanced, yamlContent, fileKey, client, options, callbacks);
  }

  // --- PATH B: Single Component (LLM → Mitosis → framework generators) ---
  return convertSingleComponent(enhanced, yamlContent, fileKey, client, options, callbacks);
}

/**
 * PATH A: Component Set → LLM (class-based Mitosis) → compile → inject CSS.
 *
 * 1. Parse variant axes and styles from Figma data
 * 2. Export SVG assets for icon nodes stripped by Framelink
 * 3. Generate CSS deterministically from variant data
 * 4. LLM generates a Mitosis component using class={state.classes}
 * 5. Mitosis compiles to all target frameworks
 * 6. Inject the deterministic CSS into each framework output
 */
async function convertComponentSet(
  enhanced: any,
  yamlContent: string,
  fileKey: string,
  client: FigmaClient,
  options: ConvertOptions,
  callbacks?: ConvertCallbacks,
): Promise<ConversionResult> {
  const { onStep, onAttempt, onDebugData } = callbacks ?? {};

  onStep?.('Detected COMPONENT_SET — parsing variants...');

  const componentSetData = parseComponentSet(enhanced);
  if (!componentSetData) {
    throw new Error('Failed to parse COMPONENT_SET variant data.');
  }

  const variantCount = componentSetData.variants.length;
  const axesSummary = componentSetData.axes
    .map((a) => `${a.name}(${a.values.length})`)
    .join(' × ');
  onStep?.(`Found ${variantCount} variants: ${axesSummary}`);

  // Step A1: Collect icon nodes from ALL variants (not just default)
  // This ensures we find all unique SVGs (e.g., spinner in loading state, icons in various states)
  onStep?.('Collecting icons from all variants...');

  // Get the actual variant nodes from the root component set node
  const rootNode = enhanced?.nodes?.[0];
  const variantNodes = rootNode?.children || [];

  // Map variant nodes to their property names
  const variantContexts = collectAssetNodesFromAllVariants(
    variantNodes.map((variantNode: any) => {
      // Parse variant name to match with componentSetData
      const variantName = variantNode.name || 'unknown';
      return {
        node: variantNode,
        variantName,
      };
    })
  );

  // Debug: Log how many contexts and nodes were found
  const totalNodes = variantContexts.reduce((sum, ctx) => sum + ctx.allNodes.length, 0);
  if (variantContexts.length === 0 || totalNodes === 0) {
    onStep?.(`  No icon nodes found in any variant (checked ${componentSetData.variants.length} variants)`);
  } else {
    onStep?.(`  Found ${totalNodes} icon node(s) across ${variantContexts.length} variant(s)`);
  }

  // Export all unique SVGs with deduplication and variant tracking
  onStep?.('Exporting and deduplicating SVG assets...');
  const assets = variantContexts.length > 0
    ? await exportAssetsFromAllVariants(variantContexts, fileKey, client).catch((err) => {
        onStep?.(`  Asset export failed: ${err.message}`);
        return [];
      })
    : [];
  const assetMap = buildAssetMap(assets);
  const dimensionMap = buildDimensionMap(assets);
  if (assets.length > 0) {
    const variantInfo = assets.some(a => a.variants && a.variants.length > 0)
      ? ` (with variant tracking)`
      : '';
    onStep?.(`Exported ${assets.length} SVG asset(s)${variantInfo}: ${assets.map((a) => a.filename).join(', ')}`);

    // Log which icons appear in which variants (helpful for debugging)
    for (const asset of assets) {
      if (asset.variants && asset.variants.length > 0 && asset.variants.length < componentSetData.variants.length) {
        onStep?.(`  - ${asset.filename} appears in ${asset.variants.length}/${componentSetData.variants.length} variants${asset.isColorVariant ? ' (recolorable via CSS)' : ''}`);
      }
    }
  }

  // Step A2: Generate CSS deterministically from variant data
  onStep?.('Building variant CSS from design tokens...');
  const variantCSS = buildVariantCSS(componentSetData, dimensionMap);

  // Step A3: Build specialized prompt for class-based component (asset hints + variant tracking included)
  const promptData = buildVariantPromptData(componentSetData, assetMap, assets);
  const systemPrompt = buildComponentSetSystemPrompt();
  const defaultVariantYaml = extractDefaultVariantYaml(componentSetData.defaultVariantNode);
  const userPrompt = buildComponentSetUserPrompt(promptData, defaultVariantYaml, componentSetData);

  // Step A4: LLM generates Mitosis component with class bindings
  const llm = createLLMProvider(options.llm);
  onStep?.(`Generating Mitosis component via ${llm.name} (class-based)...`);
  const parseResult = await generateWithRetry(llm, systemPrompt, userPrompt, onAttempt);

  onDebugData?.({ yamlContent, rawLLMOutput: parseResult.rawCode });

  if (!parseResult.success || !parseResult.component) {
    throw new Error(
      `Failed to generate valid Mitosis component for variant set.\n` +
      `Last error: ${parseResult.error}\n` +
      `Raw output saved for debugging.`,
    );
  }

  const componentName = options.name ?? promptData.componentName;

  // Step A5: Compile to target frameworks via Mitosis
  onStep?.(`Compiling to: ${options.frameworks.join(', ')}...`);
  const rawFrameworkOutputs = generateFrameworkCode(parseResult.component, options.frameworks);

  // Step A6: Inject variant CSS into each framework output
  onStep?.('Injecting variant CSS...');
  const frameworkOutputs: Record<string, string> = {};
  for (const fw of options.frameworks) {
    const rawCode = rawFrameworkOutputs[fw as Framework];
    if (rawCode && !rawCode.startsWith('// Error')) {
      frameworkOutputs[fw] = injectCSS(rawCode, variantCSS, fw as Framework);
    } else {
      frameworkOutputs[fw] = rawCode;
    }
  }

  return {
    componentName,
    mitosisSource: parseResult.rawCode,
    frameworkOutputs: frameworkOutputs as Record<Framework, string>,
    assets,
    componentPropertyDefinitions: componentSetData.componentPropertyDefinitions,
  };
}

/**
 * PATH B: Single Component → LLM → Mitosis → framework generators.
 */
async function convertSingleComponent(
  enhanced: any,
  yamlContent: string,
  fileKey: string,
  client: FigmaClient,
  options: ConvertOptions,
  callbacks?: ConvertCallbacks,
): Promise<ConversionResult> {
  const { onStep, onAttempt, onDebugData } = callbacks ?? {};

  // Export SVG assets for any icon nodes stripped by Framelink
  onStep?.('Exporting SVG assets...');
  const iconNodes = collectAssetNodes(enhanced?.nodes?.[0]);
  const assets = iconNodes.length > 0
    ? await exportAssets(iconNodes, fileKey, client).catch(() => [])
    : [];
  if (assets.length > 0) {
    onStep?.(`Exported ${assets.length} SVG asset(s): ${assets.map((a) => a.filename).join(', ')}`);
  }

  // Assemble prompts
  onStep?.('Assembling prompts...');
  const systemPrompt = assembleSystemPrompt();
  const userPrompt = assembleUserPrompt(yamlContent, options.name);

  // Generate Mitosis code via LLM with retry
  const llm = createLLMProvider(options.llm);
  onStep?.(`Generating Mitosis code via ${llm.name}...`);
  const parseResult = await generateWithRetry(llm, systemPrompt, userPrompt, onAttempt);

  onDebugData?.({ yamlContent, rawLLMOutput: parseResult.rawCode });

  if (!parseResult.success || !parseResult.component) {
    throw new Error(
      `Failed to generate valid Mitosis code after retries.\n` +
      `Last error: ${parseResult.error}\n` +
      `Raw output saved for debugging.`,
    );
  }

  const componentName = options.name ?? parseResult.component.name ?? 'Component';

  // Compile to target frameworks
  onStep?.(`Compiling to: ${options.frameworks.join(', ')}...`);
  const frameworkOutputs = generateFrameworkCode(parseResult.component, options.frameworks);

  return {
    componentName,
    mitosisSource: parseResult.rawCode,
    frameworkOutputs: frameworkOutputs as Record<Framework, string>,
    assets,
  };
}
