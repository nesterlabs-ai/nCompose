/**
 * Layout Transformers - Transform layout data
 */

import type { SimplifiedLayout, CompleteNode } from '../types.js';

/**
 * Convert layout to CSS string
 */
export function layoutToCss(layout: SimplifiedLayout): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(layout)) {
    const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
    lines.push(`  ${cssKey}: ${value};`);
  }

  return lines.join('\n');
}

/**
 * Extract inline styles from node
 */
export function extractInlineStyles(node: CompleteNode): Record<string, any> {
  const styles: Record<string, any> = {};

  if (node.absoluteBoundingBox) {
    styles.width = `${node.absoluteBoundingBox.width}px`;
    styles.height = `${node.absoluteBoundingBox.height}px`;
  }

  if (node.opacity !== undefined && node.opacity !== 1) {
    styles.opacity = node.opacity;
  }

  if (node.rotation && node.rotation !== 0) {
    styles.transform = `rotate(${node.rotation}deg)`;
  }

  return styles;
}
