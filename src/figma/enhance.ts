import type { SimplifiedDesign } from 'figma-developer-mcp';

/**
 * Reverse-engineers original element dimensions from a rotated bounding box.
 *
 * Figma's absoluteBoundingBox is the axis-aligned bounding box AFTER rotation.
 * This function recovers the original width/height/position before rotation
 * using trigonometric reversal.
 *
 * Adapted from FigmaToCode's commonPosition.ts (MIT license).
 */
export function calculateOriginalRect(
  boundingBoxWidth: number,
  boundingBoxHeight: number,
  rotationDegrees: number,
): { width: number; height: number } {
  // No rotation — bounding box IS the original rect
  if (rotationDegrees === 0) {
    return { width: boundingBoxWidth, height: boundingBoxHeight };
  }

  // Normalize to 0-360 range
  const normalized = ((Math.abs(rotationDegrees) % 360) + 360) % 360;

  // At 90° or 270°, width and height simply swap
  if (Math.abs(normalized - 90) < 0.01 || Math.abs(normalized - 270) < 0.01) {
    return { width: boundingBoxHeight, height: boundingBoxWidth };
  }

  // At 180°, dimensions stay the same
  if (Math.abs(normalized - 180) < 0.01) {
    return { width: boundingBoxWidth, height: boundingBoxHeight };
  }

  const radians = (normalized * Math.PI) / 180;
  const absCos = Math.abs(Math.cos(radians));
  const absSin = Math.abs(Math.sin(radians));

  const denominator = absCos * absCos - absSin * absSin;

  // Near 45/135/225/315 degrees the denominator approaches zero — fall back to bounding box
  if (Math.abs(denominator) < 0.0001) {
    return { width: boundingBoxWidth, height: boundingBoxHeight };
  }

  const height = (boundingBoxWidth * absSin - boundingBoxHeight * absCos) / -denominator;
  const width = (boundingBoxWidth - height * absSin) / absCos;

  return {
    width: Math.round(Math.abs(width) * 100) / 100,
    height: Math.round(Math.abs(height) * 100) / 100,
  };
}

/**
 * Checks whether a node needs absolute positioning.
 * A node is absolute when:
 * 1. Its parent has layoutMode "none" (no auto-layout), OR
 * 2. It explicitly has position "absolute" in its layout
 */
export function isAbsolutePositioned(
  nodeLayout?: { mode?: string; position?: string },
): boolean {
  if (!nodeLayout) return false;
  return nodeLayout.position === 'absolute' || nodeLayout.mode === 'none';
}

/**
 * Optional enhancement pass on SimplifiedDesign.
 *
 * Currently a no-op passthrough — the rotation math and overlap detection
 * functions above are available for use when specific edge cases are encountered
 * during prompt iteration (Phase 5). We wire them in when we discover designs
 * that Framelink's simplification doesn't handle correctly.
 *
 * For 90%+ of auto-layout designs, Framelink's output is sufficient as-is.
 */
export function enhanceSimplifiedDesign(design: SimplifiedDesign): SimplifiedDesign {
  // Passthrough — enhancement functions available for future use
  return design;
}
