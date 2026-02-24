/**
 * Style Transformers - Transform visual style data
 */

import type { Paint, Color } from '../types.js';

/**
 * Convert Figma color to CSS string
 */
export function colorToCss(color: Color): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = color.a;

  if (a === 1) {
    return `rgb(${r}, ${g}, ${b})`;
  }

  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * Convert paint to CSS background
 */
export function paintToCssBackground(paint: Paint): string | null {
  if (paint.type === 'SOLID' && paint.color) {
    return colorToCss(paint.color);
  }

  if (paint.type.startsWith('GRADIENT') && paint.gradientStops) {
    const stops = paint.gradientStops
      .map((stop) => `${colorToCss(stop.color)} ${Math.round(stop.position * 100)}%`)
      .join(', ');

    switch (paint.type) {
      case 'GRADIENT_LINEAR':
        return `linear-gradient(${stops})`;
      case 'GRADIENT_RADIAL':
        return `radial-gradient(${stops})`;
      case 'GRADIENT_ANGULAR':
        return `conic-gradient(${stops})`;
    }
  }

  return null;
}
