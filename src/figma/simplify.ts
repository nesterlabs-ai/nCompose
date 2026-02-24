import {
  simplifyRawFigmaObject,
  allExtractors,
  type SimplifiedDesign,
} from 'figma-developer-mcp';
import type { GetFileResponse, GetFileNodesResponse } from '@figma/rest-api-spec';

export type { SimplifiedDesign };

/**
 * Simplifies raw Figma API data into a compact, AI-friendly format.
 *
 * Uses Framelink's extraction pipeline which:
 * - Converts layout to flex terms (row/column, justifyContent, alignItems, gap, padding)
 * - Converts colors to CSS hex/rgba, gradients to CSS linear-gradient()
 * - Converts effects to CSS box-shadow / filter / backdrop-filter
 * - Deduplicates styles into globalVars (referenced by ID from nodes)
 * - Collapses SVG containers (FRAME with only vectors → IMAGE-SVG)
 * - Strips invisible nodes and irrelevant metadata
 */
export function simplifyFigmaData(
  rawApiResponse: GetFileResponse | GetFileNodesResponse,
  options?: { maxDepth?: number },
): SimplifiedDesign {
  return simplifyRawFigmaObject(
    rawApiResponse,
    allExtractors,
    {
      maxDepth: options?.maxDepth ?? 25,
    },
  );
}
