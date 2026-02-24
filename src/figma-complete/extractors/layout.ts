/**
 * Layout Extractor - Extracts ALL layout properties from Figma nodes
 *
 * Preserves complete layout data including:
 * - Geometry (absolute bounds, relative transform, size)
 * - Rotation
 * - Auto layout properties
 * - Constraints
 * - Positioning
 */

import type { ExtractorFn, CompleteNode } from '../types.js';
import { copyProperties, hasValue, addToGlobalVars } from '../node-walker.js';

export const layoutExtractor: ExtractorFn = (node, result, context) => {
  // Geometry
  if (context.includeAbsoluteBounds && node.absoluteBoundingBox) {
    result.absoluteBoundingBox = {
      x: node.absoluteBoundingBox.x,
      y: node.absoluteBoundingBox.y,
      width: node.absoluteBoundingBox.width,
      height: node.absoluteBoundingBox.height,
    };
  }

  if (context.includeRelativeTransform && node.relativeTransform) {
    result.relativeTransform = node.relativeTransform;
  }

  if (node.size) {
    result.size = { x: node.size.x, y: node.size.y };
  }

  // Rotation
  if (node.rotation !== undefined && node.rotation !== 0) {
    result.rotation = node.rotation;
  }

  // Layout mode (auto layout)
  if (node.layoutMode) {
    result.layoutMode = node.layoutMode;
  }

  // Layout sizing
  if (node.primaryAxisSizingMode || node.counterAxisSizingMode) {
    result.layoutSizing = {
      horizontal:
        node.layoutMode === 'HORIZONTAL'
          ? node.primaryAxisSizingMode || 'FIXED'
          : node.counterAxisSizingMode || 'FIXED',
      vertical:
        node.layoutMode === 'VERTICAL'
          ? node.primaryAxisSizingMode || 'FIXED'
          : node.counterAxisSizingMode || 'FIXED',
    };
  }

  // Layout align
  if (node.layoutAlign) {
    result.layoutAlign = node.layoutAlign;
  }

  // Layout grow
  if (node.layoutGrow !== undefined && node.layoutGrow !== 0) {
    result.layoutGrow = node.layoutGrow;
  }

  // Padding
  if (
    hasValue(node.paddingLeft) ||
    hasValue(node.paddingRight) ||
    hasValue(node.paddingTop) ||
    hasValue(node.paddingBottom)
  ) {
    result.padding = {
      left: node.paddingLeft || 0,
      right: node.paddingRight || 0,
      top: node.paddingTop || 0,
      bottom: node.paddingBottom || 0,
    };
  }

  // Item spacing (gap between items)
  if (node.itemSpacing !== undefined && node.itemSpacing !== 0) {
    result.itemSpacing = node.itemSpacing;
  }

  // Counter axis spacing
  if (node.counterAxisSpacing !== undefined && node.counterAxisSpacing !== 0) {
    result.counterAxisSpacing = node.counterAxisSpacing;
  }

  // Primary axis alignment
  if (node.primaryAxisAlignItems) {
    result.primaryAxisAlignItems = node.primaryAxisAlignItems;
  }

  // Counter axis alignment
  if (node.counterAxisAlignItems) {
    result.counterAxisAlignItems = node.counterAxisAlignItems;
  }

  // Sizing modes
  if (node.primaryAxisSizingMode) {
    result.primaryAxisSizingMode = node.primaryAxisSizingMode;
  }

  if (node.counterAxisSizingMode) {
    result.counterAxisSizingMode = node.counterAxisSizingMode;
  }

  // Constraints (for non-auto-layout)
  if (node.constraints) {
    result.constraints = {
      horizontal: node.constraints.horizontal,
      vertical: node.constraints.vertical,
    };
  }

  // Layout positioning (absolute vs auto)
  if (node.layoutPositioning) {
    result.layoutPositioning = node.layoutPositioning;
  }

  // Clipping
  if (node.clipsContent !== undefined) {
    result.clipsContent = node.clipsContent;
  }

  // Preserve aspect ratio
  if (node.preserveRatio !== undefined) {
    result.preserveRatio = node.preserveRatio;
  }

  // Locked state
  if (node.locked !== undefined) {
    result.locked = node.locked;
  }

  // Build simplified layout for globalVars (CSS-friendly)
  const simplifiedLayout = buildSimplifiedLayout(node);
  if (simplifiedLayout && Object.keys(simplifiedLayout).length > 0) {
    const layoutRef = addToGlobalVars(
      context.globalVars.layouts,
      simplifiedLayout,
      'layout'
    );
    result.layoutRef = layoutRef;
  }
};

/**
 * Build CSS-friendly simplified layout
 */
function buildSimplifiedLayout(node: any): any {
  const layout: any = {};

  // Display mode
  if (node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL') {
    layout.display = 'flex';
    layout.flexDirection = node.layoutMode === 'HORIZONTAL' ? 'row' : 'column';

    // Alignment
    if (node.primaryAxisAlignItems) {
      const alignMap: Record<string, string> = {
        MIN: 'flex-start',
        CENTER: 'center',
        MAX: 'flex-end',
        SPACE_BETWEEN: 'space-between',
      };
      layout.justifyContent = alignMap[node.primaryAxisAlignItems] || 'flex-start';
    }

    if (node.counterAxisAlignItems) {
      const alignMap: Record<string, string> = {
        MIN: 'flex-start',
        CENTER: 'center',
        MAX: 'flex-end',
      };
      layout.alignItems = alignMap[node.counterAxisAlignItems] || 'stretch';
    }

    // Gap
    if (node.itemSpacing) {
      layout.gap = `${node.itemSpacing}px`;
    }

    // Padding
    if (
      node.paddingLeft ||
      node.paddingRight ||
      node.paddingTop ||
      node.paddingBottom
    ) {
      const parts = [
        node.paddingTop || 0,
        node.paddingRight || 0,
        node.paddingBottom || 0,
        node.paddingLeft || 0,
      ];
      if (parts.every((p) => p === parts[0])) {
        layout.padding = `${parts[0]}px`;
      } else {
        layout.padding = parts.map((p) => `${p}px`).join(' ');
      }
    }
  }

  // Sizing
  if (node.absoluteBoundingBox) {
    layout.width = `${node.absoluteBoundingBox.width}px`;
    layout.height = `${node.absoluteBoundingBox.height}px`;
  }

  // Position (for absolutely positioned elements)
  if (node.layoutPositioning === 'ABSOLUTE') {
    layout.position = 'absolute';

    if (node.relativeTransform) {
      layout.left = `${node.relativeTransform[0][2]}px`;
      layout.top = `${node.relativeTransform[1][2]}px`;
    }
  }

  // Rotation
  if (node.rotation && node.rotation !== 0) {
    layout.transform = `rotate(${node.rotation}deg)`;
  }

  // Opacity
  if (node.opacity !== undefined && node.opacity < 1) {
    layout.opacity = node.opacity;
  }

  return layout;
}

/**
 * Helper to determine if a node uses auto layout
 */
export function usesAutoLayout(node: CompleteNode): boolean {
  return node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL';
}

/**
 * Helper to get effective width/height considering sizing mode
 */
export function getEffectiveSize(node: CompleteNode): { width: number; height: number } | null {
  if (node.absoluteBoundingBox) {
    return {
      width: node.absoluteBoundingBox.width,
      height: node.absoluteBoundingBox.height,
    };
  }

  if (node.size) {
    return {
      width: node.size.x,
      height: node.size.y,
    };
  }

  return null;
}
