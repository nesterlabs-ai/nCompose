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
import { config } from '../config.js';

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
  /** SVG path signature for deduplication (hash of path data) */
  pathSignature?: string;
  /** Shape group ID — icons with same position+shape but different colors share this ID */
  shapeGroupId?: string;
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
/** Node types that are pure vector/shape content (no text or raster). */
const PURE_VECTOR_TYPES = new Set([
  'INSTANCE', 'VECTOR', 'BOOLEAN_OPERATION',
  'LINE', 'ELLIPSE', 'STAR', 'REGULAR_POLYGON',
]);

function hasOnlyVectorContent(node: any): boolean {
  if (!node.children || node.children.length === 0) return false;

  for (const child of node.children) {
    const type = child.type;
    if (PURE_VECTOR_TYPES.has(type)) continue;
    // Nested FRAME/GROUP/COMPONENT containers are ok if they also contain only vectors
    if ((type === 'FRAME' || type === 'GROUP' || type === 'COMPONENT') && hasOnlyVectorContent(child)) {
      continue;
    }
    // TEXT, IMAGE, or other content → not a pure icon container
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
 *    - `FRAME` with small dimensions (≤64px) containing only INSTANCE/VECTOR children
 *    - Typically icon containers like "Left Icon", "Right Icon", status icons, etc.
 */
/**
 * Helper: extract width/height from any node (checks multiple sources).
 */
function getNodeDimensions(node: any): { width: number; height: number } | undefined {
  if (node.absoluteBoundingBox?.width != null && node.absoluteBoundingBox?.height != null) {
    return { width: node.absoluteBoundingBox.width, height: node.absoluteBoundingBox.height };
  }
  if (node.dimensions?.width != null && node.dimensions?.height != null) {
    return { width: node.dimensions.width, height: node.dimensions.height };
  }
  if (node.size?.x != null && node.size?.y != null) {
    return { width: node.size.x, height: node.size.y };
  }
  return undefined;
}

/** Max icon dimension for asset detection (px). */
const MAX_ICON_SIZE = config.figma.maxIconSize;

/** Leaf vector node types (SVG shapes without children). */
const LEAF_VECTOR_TYPES = new Set([
  'VECTOR', 'BOOLEAN_OPERATION', 'LINE', 'ELLIPSE', 'STAR', 'REGULAR_POLYGON',
]);

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

  const dims = getNodeDimensions(node);

  // Aspect ratio check: allow rectangular icons up to 2:3 ratio (e.g. hamburger, bell)
  const isIconAspectRatio = (d: { width: number; height: number }) =>
    Math.max(d.width, d.height) / Math.min(d.width, d.height) <= 1.5;

  // Small FRAME with only vector/instance content → icon container
  if (node.type === 'FRAME' && node.id && dims) {
    const isSmall = dims.width <= MAX_ICON_SIZE && dims.height <= MAX_ICON_SIZE;
    const hasVecContent = node.children?.length > 0 && hasOnlyVectorContent(node);
    if (isSmall && isIconAspectRatio(dims) && hasVecContent) return true;
  }

  // INSTANCE nodes — icon component references (e.g. "check-icon", "arrow-right")
  // Only small, reasonable-aspect-ratio instances qualify (avoids treating entire button instances as icons).
  if (node.type === 'INSTANCE' && node.id && dims) {
    const isSmall = dims.width <= MAX_ICON_SIZE && dims.height <= MAX_ICON_SIZE;
    if (isSmall && isIconAspectRatio(dims)) return true;
  }

  // Standalone VECTOR / BOOLEAN_OPERATION / LINE / ELLIPSE / STAR / REGULAR_POLYGON
  // These are leaf SVG shapes. Only detect small ones to avoid decorative elements.
  if (LEAF_VECTOR_TYPES.has(node.type) && node.id && dims) {
    const isSmall = dims.width <= MAX_ICON_SIZE && dims.height <= MAX_ICON_SIZE;
    if (isSmall) return true;
  }

  // GROUP containing only vector content
  if (node.type === 'GROUP' && node.id && dims) {
    const isSmall = dims.width <= MAX_ICON_SIZE && dims.height <= MAX_ICON_SIZE;
    const hasVecContent = node.children?.length > 0 && hasOnlyVectorContent(node);
    if (isSmall && isIconAspectRatio(dims) && hasVecContent) return true;
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
 * Extracts a deterministic color signature from SVG fill/stroke attributes.
 * Used together with path signature to distinguish same-shape icons with different colors.
 */
function extractSVGColorSignature(svgContent: string): string {
  const colors: string[] = [];

  const colorMatches = svgContent.matchAll(/(fill|stroke)="((?!none)[^"]+)"/g);
  for (const match of colorMatches) {
    colors.push(`${match[1]}:${match[2].toLowerCase().replace(/\s+/g, '')}`);
  }

  // Sort for determinism (fill/stroke order may vary)
  colors.sort();
  return colors.join('|');
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

          // Preserve original SVG colors — currentColor doesn't work with <img> tags
          // (SVGs in <img> are sandboxed and can't inherit CSS `color` from parent)

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

          // Preserve original SVG colors — currentColor doesn't work with <img> tags
          // (SVGs in <img> are sandboxed and can't inherit CSS `color` from parent)

          // Keep raw Figma SVG viewBox by default for exact fidelity.
          // Optional normalization can be enabled via config.
          if (config.figma.adjustSvgViewBox) {
            content = adjustViewBoxToPathBounds(content);
          }

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

    // Group by: position + SVG path shape + SVG colors
    // Including color ensures different-colored icons with the same shape
    // are kept as separate files (CSS color can't inherit into <img> tags)
    const position = entry.parentName || 'icon';
    const contentSignature = extractSVGPathSignature(entry.content);
    const colorSignature = extractSVGColorSignature(entry.content);
    const groupKey = `${position}::${contentSignature}::${colorSignature}`;

    // Track shape group (position + shape WITHOUT color) for color-variant grouping
    entry.shapeGroupId = `${position}::${contentSignature}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push(entry);
  }

  // Create one file per unique (position, content) group.
  // Sort groups so the DEFAULT variant's icon gets the clean filename (no -2 suffix).
  // This ensures left-icon-star.svg has the default-state color, not disabled gray.
  const DEFAULT_STATE_PATTERN = /\bdefault\b|\brest\b|\bnormal\b|\bidle\b|\bbase\b|\benabled\b/i;
  const sortedGroupEntries = [...groups.entries()].sort((a, b) => {
    const aHasDefault = a[1].some(e => e.variants?.some(v => DEFAULT_STATE_PATTERN.test(v)));
    const bHasDefault = b[1].some(e => e.variants?.some(v => DEFAULT_STATE_PATTERN.test(v)));
    if (aHasDefault && !bHasDefault) return -1;
    if (!aHasDefault && bHasDefault) return 1;
    return b[1].length - a[1].length; // fallback: most variants first
  });

  const deduplicated: AssetEntry[] = [];
  const usedFilenames = new Set<string>();

  for (const [groupKey, group] of sortedGroupEntries) {
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
 * Adjusts SVG viewBox to tightly fit the actual path content.
 *
 * Figma exports SVGs with viewBox matching the frame dimensions, but the
 * path content may not fill the entire frame (e.g. an icon in a 24×24 frame
 * might only occupy 16×16 of actual path area). This causes icons to render
 * smaller than expected. This function:
 *
 * 1. Extracts the existing viewBox from the SVG
 * 2. Parses all path `d` attributes to compute a bounding box
 * 3. If the path bbox is significantly smaller than viewBox, tightens the viewBox
 *    with a small padding to eliminate dead space
 */
function adjustViewBoxToPathBounds(svgContent: string): string {
  // Extract existing viewBox
  const vbMatch = svgContent.match(/viewBox="([\d.\-\s]+)"/);
  if (!vbMatch) return svgContent;

  const [vbX, vbY, vbW, vbH] = vbMatch[1].trim().split(/\s+/).map(Number);
  if (!vbW || !vbH || isNaN(vbW) || isNaN(vbH)) return svgContent;

  // Compute bounding box from all path d-attributes
  const bbox = computePathBBox(svgContent);
  if (!bbox) return svgContent;

  // Only tighten if path content is significantly smaller than viewBox (>15% dead space)
  const pathW = bbox.maxX - bbox.minX;
  const pathH = bbox.maxY - bbox.minY;
  if (pathW <= 0 || pathH <= 0) return svgContent;

  const fillRatioW = pathW / vbW;
  const fillRatioH = pathH / vbH;

  // If paths already fill >85% of viewBox in both dimensions, leave it alone
  if (fillRatioW > 0.85 && fillRatioH > 0.85) return svgContent;

  // Add small padding (5% of content size, min 0.5px)
  const padX = Math.max(pathW * 0.05, 0.5);
  const padY = Math.max(pathH * 0.05, 0.5);

  const newX = Math.floor((bbox.minX - padX) * 100) / 100;
  const newY = Math.floor((bbox.minY - padY) * 100) / 100;
  const newW = Math.ceil((pathW + padX * 2) * 100) / 100;
  const newH = Math.ceil((pathH + padY * 2) * 100) / 100;

  // Replace viewBox
  let result = svgContent.replace(
    /viewBox="[\d.\-\s]+"/,
    `viewBox="${newX} ${newY} ${newW} ${newH}"`,
  );

  // Also update width/height attributes to match new aspect ratio
  // Keep the larger dimension, scale the smaller one
  const widthMatch = result.match(/\bwidth="(\d+(?:\.\d+)?)"/);
  const heightMatch = result.match(/\bheight="(\d+(?:\.\d+)?)"/);
  if (widthMatch && heightMatch) {
    const origW = parseFloat(widthMatch[1]);
    const origH = parseFloat(heightMatch[1]);
    const aspect = newW / newH;
    if (origW >= origH) {
      const adjH = Math.round(origW / aspect);
      result = result.replace(/\bheight="\d+(?:\.\d+)?"/, `height="${adjH}"`);
    } else {
      const adjW = Math.round(origH * aspect);
      result = result.replace(/\bwidth="\d+(?:\.\d+)?"/, `width="${adjW}"`);
    }
  }

  return result;
}

/**
 * Computes a bounding box from all SVG path `d` attributes.
 * Handles M, L, H, V, C, S, Q, T, A, Z commands (absolute and relative).
 * Returns null if no paths found or parsing fails.
 */
function computePathBBox(svgContent: string): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const pathMatches = svgContent.matchAll(/<path[^>]+d="([^"]+)"/g);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let found = false;

  const updateBBox = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    found = true;
  };

  for (const match of pathMatches) {
    const d = match[1];
    // Tokenize: split into commands and numbers
    const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
    if (!tokens) continue;

    let curX = 0, curY = 0;
    let startX = 0, startY = 0;
    let cmd = '';
    let i = 0;

    const num = () => {
      if (i >= tokens.length) return 0;
      const val = parseFloat(tokens[i]);
      i++;
      return isNaN(val) ? 0 : val;
    };

    while (i < tokens.length) {
      const token = tokens[i];
      if (/[A-Za-z]/.test(token)) {
        cmd = token;
        i++;
      }

      switch (cmd) {
        case 'M': curX = num(); curY = num(); startX = curX; startY = curY; updateBBox(curX, curY); cmd = 'L'; break;
        case 'm': curX += num(); curY += num(); startX = curX; startY = curY; updateBBox(curX, curY); cmd = 'l'; break;
        case 'L': curX = num(); curY = num(); updateBBox(curX, curY); break;
        case 'l': curX += num(); curY += num(); updateBBox(curX, curY); break;
        case 'H': curX = num(); updateBBox(curX, curY); break;
        case 'h': curX += num(); updateBBox(curX, curY); break;
        case 'V': curY = num(); updateBBox(curX, curY); break;
        case 'v': curY += num(); updateBBox(curX, curY); break;
        case 'C': {
          const x1 = num(), y1 = num(), x2 = num(), y2 = num();
          curX = num(); curY = num();
          updateBBox(x1, y1); updateBBox(x2, y2); updateBBox(curX, curY);
          break;
        }
        case 'c': {
          const dx1 = num(), dy1 = num(), dx2 = num(), dy2 = num();
          const dx = num(), dy = num();
          updateBBox(curX + dx1, curY + dy1); updateBBox(curX + dx2, curY + dy2);
          curX += dx; curY += dy; updateBBox(curX, curY);
          break;
        }
        case 'S': { num(); num(); curX = num(); curY = num(); updateBBox(curX, curY); break; }
        case 's': { num(); num(); const dx = num(), dy = num(); curX += dx; curY += dy; updateBBox(curX, curY); break; }
        case 'Q': { const qx = num(), qy = num(); curX = num(); curY = num(); updateBBox(qx, qy); updateBBox(curX, curY); break; }
        case 'q': { const dqx = num(), dqy = num(); const qdx = num(), qdy = num(); updateBBox(curX + dqx, curY + dqy); curX += qdx; curY += qdy; updateBBox(curX, curY); break; }
        case 'T': curX = num(); curY = num(); updateBBox(curX, curY); break;
        case 't': curX += num(); curY += num(); updateBBox(curX, curY); break;
        case 'A': case 'a': {
          // Arc: rx ry xrot largeArc sweep x y
          num(); num(); num(); num(); num();
          if (cmd === 'A') { curX = num(); curY = num(); }
          else { curX += num(); curY += num(); }
          updateBBox(curX, curY);
          break;
        }
        case 'Z': case 'z': curX = startX; curY = startY; break;
        default: i++; break; // Unknown command, skip
      }
    }
  }

  // Also check circle, rect, ellipse elements
  for (const m of svgContent.matchAll(/<circle[^>]*\bcx="([\d.]+)"[^>]*\bcy="([\d.]+)"[^>]*\br="([\d.]+)"/g)) {
    const cx = parseFloat(m[1]), cy = parseFloat(m[2]), r = parseFloat(m[3]);
    updateBBox(cx - r, cy - r); updateBBox(cx + r, cy + r);
  }
  for (const m of svgContent.matchAll(/<rect[^>]*\bx="([\d.]+)"[^>]*\by="([\d.]+)"[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"/g)) {
    const x = parseFloat(m[1]), y = parseFloat(m[2]), w = parseFloat(m[3]), h = parseFloat(m[4]);
    updateBBox(x, y); updateBBox(x + w, y + h);
  }

  return found ? { minX, minY, maxX, maxY } : null;
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
