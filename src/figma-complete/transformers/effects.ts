/**
 * Effects Transformers - Transform effects data
 */

import type { Effect, Color } from '../types.js';

/**
 * Convert color to CSS string, multiplying in paint-level opacity.
 */
function colorToCss(color: Color, paintOpacity?: number): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = parseFloat(((color.a ?? 1) * (paintOpacity ?? 1)).toFixed(3));

  if (a >= 0.999) {
    return `rgb(${r}, ${g}, ${b})`;
  }

  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * Convert effect to CSS box-shadow or filter
 */
export function effectToCss(effect: Effect): string | null {
  if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
    const offsetX = effect.offset?.x || 0;
    const offsetY = effect.offset?.y || 0;
    const blur = effect.radius || 0;
    const spread = effect.spread || 0;
    const color = effect.color ? colorToCss(effect.color) : 'rgba(0,0,0,0.25)';
    const inner = effect.type === 'INNER_SHADOW' ? 'inset ' : '';

    return `${inner}${offsetX}px ${offsetY}px ${blur}px ${spread}px ${color}`;
  }

  if (effect.type === 'LAYER_BLUR') {
    return `blur(${effect.radius}px)`;
  }

  if (effect.type === 'BACKGROUND_BLUR') {
    return `blur(${effect.radius}px)`;
  }

  return null;
}

/**
 * Convert effects array to CSS
 */
export function effectsToCss(effects: Effect[]): {
  boxShadow?: string;
  filter?: string;
  backdropFilter?: string;
} {
  const boxShadows: string[] = [];
  const filters: string[] = [];
  const backdropFilters: string[] = [];

  for (const effect of effects) {
    if (effect.visible === false) continue;

    const css = effectToCss(effect);
    if (!css) continue;

    if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
      boxShadows.push(css);
    } else if (effect.type === 'BACKGROUND_BLUR') {
      backdropFilters.push(css);
    } else {
      filters.push(css);
    }
  }

  const result: any = {};

  if (boxShadows.length > 0) {
    result.boxShadow = boxShadows.join(', ');
  }

  if (filters.length > 0) {
    result.filter = filters.join(' ');
  }

  if (backdropFilters.length > 0) {
    result.backdropFilter = backdropFilters.join(' ');
  }

  return result;
}
