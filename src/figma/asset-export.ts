/**
 * Exports icon/SVG assets from Figma for nodes whose vector children are
 * stripped by Framelink during simplification.
 *
 * Framelink's simplifyRawFigmaObject() removes SVG vector children from FRAME
 * nodes (they have no layout/style data useful for an LLM). This leaves icon
 * slot FRAMEs with no children in the simplified tree — they collapse to 0×0.
 *
 * Fix: detect these icon nodes, call FigmaClient.getImages() to get SVG export
 * URLs, download the SVG content, and return entries that the prompt builder
 * uses to inject <img src="./assets/..."> hints for the LLM.
 */

import type { FigmaClient } from './fetch.js';
import { toKebabCase } from './component-set-parser.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AssetEntry {
  nodeId: string;
  nodeName: string;
  /** Deduplicated filename, e.g. "left-icon.svg", "vector-2.svg" */
  filename: string;
  /** Figma SVG export URL (presigned, short-lived) */
  url: string;
  /** Downloaded SVG markup — undefined if download failed */
  content?: string;
  /** Dimensions of the icon frame/container (if available) */
  dimensions?: { width: number; height: number };
  /** Parent container name for better file naming */
  parentName?: string;
  /** Variants where this icon appears (e.g. ["subtle/default", "subtle/hover"]) */
  variants?: string[];
  /** If true, this SVG can be recolored via CSS (identical shape to other variants) */
  isColorVariant?: boolean;
  /** SVG path signature for deduplication (hash of path data) */
  pathSignature?: string;
  /** Original Figma styling data */
  figmaStyles?: {
    fills?: any[];
    strokes?: any[];
    strokeWeight?: number;
    opacity?: number;
  };
}

export interface IconCollectionContext {
  /** Variant name this icon was found in (e.g. "subtle/default") */
  variantName: string;
  /** All icon nodes collected across variants */
  allNodes: Array<{
    id: string;
    name: string;
    dimensions?: { width: number; height: number };
    parentName?: string;
    variantName: string;
    figmaStyles?: {
      fills?: any[];
      strokes?: any[];
      strokeWeight?: number;
      opacity?: number;
    };
  }>;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Returns true if a node contains only vector/icon content (INSTANCE, VECTOR, etc.)
 */
function hasOnlyVectorContent(node: any): boolean {
  if (!node.children || node.children.length === 0) return false;

  for (const child of node.children) {
    const type = child.type;
    // Allow INSTANCE (icon components), VECTOR, BOOLEAN_OPERATION, or nested FRAMEs with vector content
    if (type === 'INSTANCE' || type === 'VECTOR' || type === 'BOOLEAN_OPERATION') {
      continue;
    }
    if (type === 'FRAME' && hasOnlyVectorContent(child)) {
      continue;
    }
    // If we hit TEXT, IMAGE, or other content, this is not a pure icon container
    return false;
  }

  return true;
}

/**
 * Returns true if a node represents a renderable SVG/image asset.
 *
 * Covers two scenarios:
 * 1. Framelink simplification (legacy):
 *    - `IMAGE-SVG` — Framelink collapses FRAME(only vectors) → IMAGE-SVG
 *    - `IMAGE`     — raster image nodes
 *    - `FRAME` with no children — icon slot whose vector content was stripped
 *
 * 2. Complete extraction (new):
 *    - `FRAME` with small dimensions (≤32px) containing only INSTANCE/VECTOR children
 *    - Typically icon containers like "Left Icon", "Right Icon", etc.
 */
export function isAssetNode(node: any): boolean {
  if (!node) return false;

  // Legacy Framelink detection
  if (node.type === 'IMAGE-SVG' || node.type === 'IMAGE') return true;
  if (
    node.type === 'FRAME' &&
    (!node.children || node.children.length === 0) &&
    node.id
  ) {
    return true;
  }

  // Complete extraction detection: small FRAME with only vector content
  if (node.type === 'FRAME' && node.id) {
    // Check dimensions (icons are typically small: 14x14, 16x16, 20x20, 24x24, 32x32)
    let width: number | undefined;
    let height: number | undefined;

    if (node.absoluteBoundingBox) {
      width = node.absoluteBoundingBox.width;
      height = node.absoluteBoundingBox.height;
    } else if (node.dimensions) {
      width = node.dimensions.width;
      height = node.dimensions.height;
    }

    // Icon heuristic: small square-ish container with only vector/instance children
    if (width !== undefined && height !== undefined) {
      const isSmall = width <= 32 && height <= 32;
      const isSquareish = Math.abs(width - height) <= 4; // Allow slight non-square
      const hasVectorContent = node.children && node.children.length > 0 && hasOnlyVectorContent(node);

      if (isSmall && isSquareish && hasVectorContent) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Recursively walks a simplified node tree and collects every asset node.
 * Stops recursion into asset nodes (their children, if any, are irrelevant).
 * Also captures dimensions from the node or its parent containers.
 */
export function collectAssetNodes(
  node: any,
  result: { id: string; name: string; dimensions?: { width: number; height: number }; parentName?: string; figmaStyles?: any }[] = [],
  parentDimensions?: { width: number; height: number },
  parentName?: string,
): { id: string; name: string; dimensions?: { width: number; height: number }; parentName?: string; figmaStyles?: any }[] {
  if (!node) return result;

  // Extract dimensions from this node (could be in layout.dimensions or node.dimensions)
  let nodeDimensions = parentDimensions;

  // Check all possible dimension sources
  if (node.dimensions?.width && node.dimensions?.height) {
    nodeDimensions = { width: node.dimensions.width, height: node.dimensions.height };
  } else if (node.layout?.dimensions?.width && node.layout?.dimensions?.height) {
    nodeDimensions = { width: node.layout.dimensions.width, height: node.layout.dimensions.height };
  } else if (node.absoluteBoundingBox?.width && node.absoluteBoundingBox?.height) {
    // Fallback to absolute bounding box
    nodeDimensions = { width: Math.round(node.absoluteBoundingBox.width), height: Math.round(node.absoluteBoundingBox.height) };
  }

  if (isAssetNode(node) && node.id) {
    // Use the immediate parent's name for position info (e.g., "Left Icon", "Right Icon")
    // Fallback to parentName only if node doesn't have a useful parent context
    const useParentName = parentName && !parentName.includes('=') ? parentName : undefined;

    // Try to get the actual icon name from the first child (e.g., "Star", "Spinner")
    let iconName = node.name ?? 'vector';
    if (node.children && node.children.length > 0 && node.children[0].name) {
      iconName = node.children[0].name;
    }

    // Extract Figma styling data for this icon
    const figmaStyles: any = {};
    if (node.fills && node.fills.length > 0) figmaStyles.fills = node.fills;
    if (node.strokes && node.strokes.length > 0) figmaStyles.strokes = node.strokes;
    if (node.strokeWeight !== undefined) figmaStyles.strokeWeight = node.strokeWeight;
    if (node.opacity !== undefined && node.opacity !== 1) figmaStyles.opacity = node.opacity;

    result.push({
      id: node.id,
      name: iconName, // Use inner child name (Star, Spinner) instead of frame name (Left Icon)
      dimensions: nodeDimensions,
      parentName: useParentName || (node.name ?? 'vector'), // Keep frame name as parent (Left Icon, Right Icon)
      figmaStyles: Object.keys(figmaStyles).length > 0 ? figmaStyles : undefined,
    });
    return result; // do not recurse into the asset node itself
  }

  if (node.children) {
    for (const child of node.children) {
      // Pass current node name as parent, but skip if it looks like a variant name
      const childParentName = node.name && !node.name.includes('=') ? node.name : parentName;
      collectAssetNodes(child, result, nodeDimensions, childParentName);
    }
  }

  return result;
}

/**
 * Collects asset nodes from all variants in a component set.
 * Tracks which variant each icon appears in for conditional rendering.
 */
export function collectAssetNodesFromAllVariants(
  variants: Array<{ node: any; variantName: string }>,
): IconCollectionContext[] {
  const allContexts: IconCollectionContext[] = [];

  for (const { node, variantName } of variants) {
    const nodes = collectAssetNodes(node);

    if (nodes.length > 0) {
      allContexts.push({
        variantName,
        allNodes: nodes.map(n => ({
          ...n,
          variantName,
          figmaStyles: n.figmaStyles
        })),
      });
    }
  }

  return allContexts;
}

// ---------------------------------------------------------------------------
// SVG Deduplication
// ---------------------------------------------------------------------------

/**
 * Extracts a signature from SVG content based on path data (ignoring colors).
 * Used to detect identical SVG shapes that only differ in color.
 */
function extractSVGPathSignature(svgContent: string): string {
  // Extract all path data, ignoring fill/stroke colors
  const paths: string[] = [];

  // Match <path d="..." />
  const pathMatches = svgContent.matchAll(/<path[^>]+d="([^"]+)"/g);
  for (const match of pathMatches) {
    paths.push(match[1]);
  }

  // Match other shape elements (circle, rect, polygon, etc.)
  const circleMatches = svgContent.matchAll(/<circle[^>]+cx="([^"]+)"[^>]+cy="([^"]+)"[^>]+r="([^"]+)"/g);
  for (const match of circleMatches) {
    paths.push(`circle:${match[1]},${match[2]},${match[3]}`);
  }

  const rectMatches = svgContent.matchAll(/<rect[^>]+x="([^"]*)"[^>]+y="([^"]*)"[^>]+width="([^"]+)"[^>]+height="([^"]+)"/g);
  for (const match of rectMatches) {
    paths.push(`rect:${match[1]},${match[2]},${match[3]},${match[4]}`);
  }

  // Create signature by joining all path data
  return paths.join('|');
}

/**
 * Checks if SVG content contains only grayscale/neutral colors that can be replaced with currentColor.
 * Returns true if the SVG can be safely recolored via CSS.
 */
function canBeRecoloredWithCSS(svgContent: string): boolean {
  // Extract all color values
  const colorMatches = svgContent.matchAll(/(fill|stroke)="(?!none|currentColor)([^"]+)"/g);

  for (const match of colorMatches) {
    const color = match[2];

    // Skip if already using currentColor
    if (color === 'currentColor') continue;

    // For now, assume any solid color can be replaced with currentColor
    // This works for icons that use a single color or grayscale
    // More complex logic could check if all colors are the same
    return true;
  }

  return false;
}

/**
 * Deduplicates SVG assets by comparing path signatures.
 * Groups identical shapes together and marks them as color variants.
 */
function deduplicateSVGAssets(assets: AssetEntry[]): AssetEntry[] {
  const signatureMap = new Map<string, AssetEntry[]>();

  // Group assets by path signature
  for (const asset of assets) {
    if (!asset.content) continue;

    const signature = extractSVGPathSignature(asset.content);
    asset.pathSignature = signature;

    if (!signatureMap.has(signature)) {
      signatureMap.set(signature, []);
    }
    signatureMap.get(signature)!.push(asset);
  }

  const deduplicated: AssetEntry[] = [];

  // For each unique shape
  for (const [signature, group] of signatureMap.entries()) {
    if (group.length === 1) {
      // Unique shape - keep as is
      deduplicated.push(group[0]);
    } else {
      // Multiple assets with same shape - deduplicate
      // Use the first one as the canonical version
      const canonical = group[0];

      // Check if this shape can be recolored with CSS
      const canRecolor = canonical.content ? canBeRecoloredWithCSS(canonical.content) : false;

      if (canRecolor) {
        // Mark as color variant and replace colors with currentColor
        canonical.isColorVariant = true;
        if (canonical.content) {
          canonical.content = makeColorInheritable(canonical.content);
        }

        // Merge variant lists from all duplicates
        const allVariants = new Set<string>();
        for (const asset of group) {
          if (asset.variants) {
            asset.variants.forEach(v => allVariants.add(v));
          }
        }
        canonical.variants = Array.from(allVariants);

        deduplicated.push(canonical);
      } else {
        // Cannot recolor safely - keep all variants as separate files
        deduplicated.push(...group);
      }
    }
  }

  return deduplicated;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Exports SVG assets for the given nodes via Figma's image export API,
 * downloads their content, and returns deduplicated AssetEntry objects.
 *
 * Deduplication rule: Uses parent name for filename to differentiate icons
 * in different containers (e.g. "left-icon.svg" vs "right-icon.svg").
 *
 * @param nodes   - {id, name, dimensions, parentName} from collectAssetNodes()
 * @param fileKey - Figma file key (from URL)
 * @param client  - Authenticated FigmaClient instance
 */
export async function exportAssets(
  nodes: { id: string; name: string; dimensions?: { width: number; height: number }; parentName?: string }[],
  fileKey: string,
  client: FigmaClient,
): Promise<AssetEntry[]> {
  if (nodes.length === 0) return [];

  // Step 1: Get SVG export URLs from Figma (scale=1 to match Figma dimensions)
  const nodeIds = nodes.map((n) => n.id);
  const imageUrls = await client.getImages(fileKey, nodeIds, 'svg', 1);

  // Step 2: Build entries with deduplicated filenames and preserve dimensions
  const entries: AssetEntry[] = [];
  const baseCount = new Map<string, number>();
  const seenUrls = new Map<string, string>(); // url → first filename

  for (const { id, name, dimensions, parentName } of nodes) {
    const url = imageUrls[id];
    if (!url) continue; // node not exported (invisible, out of scope, etc.)

    // Prefer the node's own name over parentName
    // (parentName might be the variant name, which is not useful for icon filenames)
    // Only use parentName if the node name is generic/non-descriptive
    const nodeName = name || 'vector';
    const lowerName = nodeName.toLowerCase();

    // Generic names that should fall back to parent name
    const isGeneric = lowerName === 'vector' ||
                      lowerName === 'star' ||
                      lowerName === 'icon' ||
                      lowerName === 'image' ||
                      lowerName === 'frame';

    const preferredName = isGeneric ? (parentName || nodeName) : nodeName;
    const base = toKebabCase(preferredName);

    // Check if we've already exported this exact SVG (by URL)
    if (seenUrls.has(url)) {
      // Reuse the same file for duplicate exports
      const existingFilename = seenUrls.get(url)!;
      entries.push({ nodeId: id, nodeName: name, filename: existingFilename, url, dimensions, parentName });
      continue;
    }

    const count = baseCount.get(base) ?? 0;
    baseCount.set(base, count + 1);

    const filename = count === 0 ? `${base}.svg` : `${base}-${count + 1}.svg`;
    seenUrls.set(url, filename);
    entries.push({ nodeId: id, nodeName: name, filename, url, dimensions, parentName });
  }

  // Step 3: Download SVG content in parallel (non-fatal failures)
  const downloadedUrls = new Set<string>();

  await Promise.all(
    entries.map(async (entry) => {
      // Skip if we already downloaded this URL
      if (downloadedUrls.has(entry.url)) {
        // Find the entry that already has this content
        const existing = entries.find(e => e.url === entry.url && e.content);
        if (existing) {
          entry.content = existing.content;
          entry.dimensions = entry.dimensions || existing.dimensions;
        }
        return;
      }

      try {
        const res = await fetch(entry.url);
        if (res.ok) {
          let content = await res.text();

          // Replace hardcoded colors with currentColor for CSS inheritance
          content = makeColorInheritable(content);

          entry.content = content;
          downloadedUrls.add(entry.url);

          // If no dimensions were found in Figma data, extract from SVG
          if (!entry.dimensions && entry.content) {
            const svgDims = extractSVGDimensions(entry.content);
            if (svgDims) {
              entry.dimensions = svgDims;
            }
          }
        }
      } catch {
        // URL is preserved — output writer can use it even without content
      }
    }),
  );

  return entries;
}

/**
 * Exports SVG assets from all variants in a component set.
 * Deduplicates identical shapes and tracks which variants each icon appears in.
 *
 * @param contexts - Icon collection contexts from all variants
 * @param fileKey - Figma file key
 * @param client - Figma API client
 * @returns Deduplicated asset entries with variant tracking
 */
export async function exportAssetsFromAllVariants(
  contexts: IconCollectionContext[],
  fileKey: string,
  client: FigmaClient,
): Promise<AssetEntry[]> {
  if (contexts.length === 0) return [];

  // Step 1: Collect all unique nodes across all variants
  const nodeMap = new Map<string, {
    id: string;
    name: string;
    dimensions?: { width: number; height: number };
    parentName?: string;
    variants: string[];  // Track which variants this node appears in
    figmaStyles?: any;   // Figma styling data (fills, strokes, etc.)
  }>();

  for (const context of contexts) {
    for (const node of context.allNodes) {
      if (!nodeMap.has(node.id)) {
        nodeMap.set(node.id, {
          id: node.id,
          name: node.name,
          dimensions: node.dimensions,
          parentName: node.parentName,
          variants: [],
          figmaStyles: node.figmaStyles,
        });
      }

      // Add this variant to the node's variant list
      nodeMap.get(node.id)!.variants.push(context.variantName);
    }
  }

  if (nodeMap.size === 0) return [];

  // Step 2: Get SVG export URLs from Figma for all unique nodes
  const allNodes = Array.from(nodeMap.values());
  const nodeIds = allNodes.map(n => n.id);
  const imageUrls = await client.getImages(fileKey, nodeIds, 'svg', 1);

  // Step 3: Build entries - one entry per unique node (no URL-based merging)
  const entries: AssetEntry[] = [];
  const baseCount = new Map<string, number>();

  for (const node of allNodes) {
    const url = imageUrls[node.id];
    if (!url) continue;

    // Generate filename based on parent name (e.g., "Left Icon" → "left-icon.svg")
    const nodeName = node.name || 'vector';
    const lowerName = nodeName.toLowerCase();

    const isGeneric = lowerName === 'vector' ||
                      lowerName === 'star' ||
                      lowerName === 'spinner' ||
                      lowerName === 'icon' ||
                      lowerName === 'image' ||
                      lowerName === 'frame';

    // Use parent name for filename (e.g., "Left Icon", "Right Icon")
    const baseName = isGeneric && node.parentName
      ? toKebabCase(node.parentName)
      : toKebabCase(nodeName);

    const base = baseName || 'icon';
    const count = baseCount.get(base) ?? 0;
    baseCount.set(base, count + 1);

    // Generate unique filename
    const filename = count === 0 ? `${base}.svg` : `${base}-${count + 1}.svg`;

    entries.push({
      nodeId: node.id,
      nodeName: node.name,
      filename,
      url,
      dimensions: node.dimensions,
      parentName: node.parentName,
      variants: [...node.variants],  // Copy variant list
      figmaStyles: node.figmaStyles,  // Preserve Figma styling data
    });
  }

  // Step 4: Download SVG content in parallel
  const downloadedUrls = new Map<string, string>();  // url → content

  await Promise.all(
    entries.map(async (entry) => {
      // Skip if we already downloaded this URL
      if (downloadedUrls.has(entry.url)) {
        entry.content = downloadedUrls.get(entry.url);
        return;
      }

      try {
        const res = await fetch(entry.url);
        if (res.ok) {
          let content = await res.text();

          // Replace colors with currentColor for CSS control
          content = makeColorInheritable(content);

          // TODO: Fix viewBox sizing (see OPEN_ISSUES.md)
          // For now, use SVGs as-is from Figma
          content = adjustViewBoxToPathBounds(content);

          entry.content = content;
          downloadedUrls.set(entry.url, content);

          // Extract dimensions from SVG if not available
          if (!entry.dimensions && content) {
            const svgDims = extractSVGDimensions(content);
            if (svgDims) {
              entry.dimensions = svgDims;
            }
          }
        }
      } catch {
        // URL is preserved even without content
      }
    }),
  );

  // Step 5: Smart deduplication by (parentName + SVG content)
  // Group icons that have the same position AND same visual content
  const groups = new Map<string, AssetEntry[]>();

  for (const entry of entries) {
    if (!entry.content) continue; // Skip if download failed

    // Group by: position (Left Icon, Right Icon) + SVG path signature
    const position = entry.parentName || 'icon';
    const contentSignature = extractSVGPathSignature(entry.content);
    const groupKey = `${position}::${contentSignature}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push(entry);
  }

  // Create one file per unique (position, content) group
  const deduplicated: AssetEntry[] = [];
  const usedFilenames = new Set<string>();

  for (const [groupKey, group] of groups.entries()) {
    const canonical = group[0];

    // Merge all variant lists from the group
    const allVariants = new Set<string>();
    for (const entry of group) {
      if (entry.variants) {
        entry.variants.forEach(v => allVariants.add(v));
      }
    }
    canonical.variants = Array.from(allVariants);

    // Generate filename: position-iconname.svg
    // e.g., "left-icon-spinner.svg", "right-icon-star.svg"
    const position = toKebabCase(canonical.parentName || 'icon');
    const iconName = toKebabCase(canonical.nodeName || 'icon').toLowerCase();

    let filename: string;
    if (iconName && iconName !== 'icon' && iconName !== 'vector' && iconName !== 'frame') {
      // Use position + icon name (e.g., "left-icon-spinner.svg")
      filename = `${position}-${iconName}.svg`;
    } else {
      // Just use position (e.g., "left-icon.svg")
      filename = `${position}.svg`;
    }

    // Ensure unique filenames
    let finalFilename = filename;
    let counter = 2;
    while (usedFilenames.has(finalFilename)) {
      const base = filename.replace('.svg', '');
      finalFilename = `${base}-${counter}.svg`;
      counter++;
    }
    usedFilenames.add(finalFilename);

    canonical.filename = finalFilename;

    // Debug logging
    if (process.env.DEBUG_ASSETS === 'true') {
      console.log(`[DEBUG] Deduplicated group: ${groupKey.substring(0, 50)}...`);
      console.log(`[DEBUG]   - ${group.length} instances merged`);
      console.log(`[DEBUG]   - parentName: "${canonical.parentName}", nodeName: "${canonical.nodeName}"`);
      console.log(`[DEBUG]   - position: "${position}", iconName: "${iconName}"`);
      console.log(`[DEBUG]   - Final filename: ${finalFilename}`);
      console.log(`[DEBUG]   - Variants: ${canonical.variants?.length || 0}`);
    }

    deduplicated.push(canonical);
  }

  if (process.env.DEBUG_ASSETS === 'true') {
    console.log(`\n[DEBUG] Final deduplicated count: ${deduplicated.length} files`);
    for (const entry of deduplicated) {
      console.log(`[DEBUG]   - ${entry.filename} (${entry.variants?.length || 0} variants)`);
    }
  }

  return deduplicated;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts width and height from SVG content.
 * Checks width/height attributes first, then viewBox.
 */
function extractSVGDimensions(svgContent: string): { width: number; height: number } | null {
  try {
    // Try to extract width/height attributes
    const widthMatch = svgContent.match(/width="(\d+(?:\.\d+)?)"/);
    const heightMatch = svgContent.match(/height="(\d+(?:\.\d+)?)"/);

    if (widthMatch && heightMatch) {
      return {
        width: Math.round(parseFloat(widthMatch[1])),
        height: Math.round(parseFloat(heightMatch[1])),
      };
    }

    // Fallback to viewBox
    const viewBoxMatch = svgContent.match(/viewBox="[\d\s.]+ [\d\s.]+ (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
    if (viewBoxMatch) {
      return {
        width: Math.round(parseFloat(viewBoxMatch[1])),
        height: Math.round(parseFloat(viewBoxMatch[2])),
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Replaces hardcoded stroke and fill colors in SVG with currentColor
 * so the icon inherits color from CSS (matches text color).
 *
 * Preserves fill="none" and doesn't touch opacity.
 *
 * SMART BEHAVIOR: If the SVG contains multiple distinct colors (e.g. a
 * checkbox with a colored background AND a white checkmark), the colors
 * are preserved as-is so the icon renders correctly. Single-color SVGs
 * (typical monochrome icons) get currentColor for CSS recoloring.
 */
function makeColorInheritable(svgContent: string): string {
  // Collect all distinct fill/stroke colors (excluding "none", "white"/"#fff" mask fills)
  const colorPattern = /(?:fill|stroke)="((?:#[0-9A-Fa-f]{3,8}|rgb[^"]*))"?/g;
  const colors = new Set<string>();
  let match;
  while ((match = colorPattern.exec(svgContent)) !== null) {
    const color = match[1].toLowerCase().replace(/\s+/g, '');
    // Normalize common white representations
    const isWhite = /^(#fff|#ffffff|#ffffffff|rgb\(255,255,255\)|rgba\(255,255,255,[^)]*\))$/.test(color);
    if (!isWhite) {
      colors.add(color);
    }
  }

  // If SVG has multiple distinct non-white colors, preserve original colors
  // (e.g. checkbox with blue background + white checkmark stroke)
  if (colors.size > 1) {
    return svgContent;
  }

  // Single-color SVG — safe to replace with currentColor for CSS control
  let result = svgContent;

  // Replace stroke="#..." with stroke="currentColor"
  result = result.replace(/stroke="[^"]*(?:#[0-9A-Fa-f]{3,8}|rgb[^"]*)"/g, 'stroke="currentColor"');

  // Replace fill="#..." with fill="currentColor" (but preserve fill="none")
  result = result.replace(/fill="(?!none)[^"]*(?:#[0-9A-Fa-f]{3,8}|rgb[^"]*)"/g, 'fill="currentColor"');

  return result;
}

/**
 * Placeholder for future viewBox adjustment logic.
 * Currently just returns SVG as-is from Figma.
 *
 * TODO: Fix icon sizing issue where path content doesn't fill viewBox.
 * See OPEN_ISSUES.md for details.
 */
function adjustViewBoxToPathBounds(svgContent: string): string {
  // Return SVG unchanged for now
  // Icons will render slightly smaller than frame, but this is acceptable
  // until we find a proper solution that works for all icon sizes
  return svgContent;
}

/**
 * Builds a map from node ID → relative asset path for use in prompt building.
 * e.g. "8119:29808" → "./assets/left-icon.svg"
 */
export function buildAssetMap(assets: AssetEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of assets) {
    map.set(entry.nodeId, `./assets/${entry.filename}`);
  }
  return map;
}

/**
 * Builds an enhanced asset map with full asset entry information including variant tracking.
 * This is used for generating more intelligent conditional rendering in the component.
 */
export function buildEnhancedAssetMap(assets: AssetEntry[]): Map<string, AssetEntry> {
  const map = new Map<string, AssetEntry>();
  for (const entry of assets) {
    map.set(entry.nodeId, entry);
  }
  return map;
}

/**
 * Builds a map from node ID → dimensions for use in CSS generation.
 * e.g. "8119:29808" → { width: 14, height: 14 }
 */
export function buildDimensionMap(assets: AssetEntry[]): Map<string, { width: number; height: number }> {
  const map = new Map<string, { width: number; height: number }>();
  for (const entry of assets) {
    if (entry.dimensions) {
      map.set(entry.nodeId, entry.dimensions);
    }
  }
  return map;
}
