/**
 * Text Transformers - Transform text data
 */

import type { TypeStyle, SimplifiedTextStyle } from '../types.js';

/**
 * Convert type style to CSS
 */
export function typeStyleToCss(style: TypeStyle): SimplifiedTextStyle {
  const css: SimplifiedTextStyle = {};

  if (style.fontFamily) {
    css.fontFamily = style.fontFamily;
  }

  if (style.fontSize) {
    css.fontSize = `${style.fontSize}px`;
  }

  if (style.fontWeight) {
    css.fontWeight = style.fontWeight;
  }

  if (style.lineHeightPx) {
    css.lineHeight = `${Math.round(style.lineHeightPx * 100) / 100}px`;
  } else if (style.lineHeightPercent) {
    css.lineHeight = `${Math.round(style.lineHeightPercent * 100) / 100}%`;
  }

  if (style.letterSpacing) {
    css.letterSpacing = `${Math.round(style.letterSpacing * 100) / 100}px`;
  }

  if (style.textAlignHorizontal) {
    const alignMap: Record<string, string> = {
      LEFT: 'left',
      CENTER: 'center',
      RIGHT: 'right',
      JUSTIFIED: 'justify',
    };
    css.textAlign = alignMap[style.textAlignHorizontal] || 'left';
  }

  return css;
}

/**
 * Escape text for HTML
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
