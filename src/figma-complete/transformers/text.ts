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
    css.lineHeight = `${style.lineHeightPx}px`;
  } else if (style.lineHeightPercent) {
    css.lineHeight = `${style.lineHeightPercent}%`;
  }

  if (style.letterSpacing) {
    css.letterSpacing = `${style.letterSpacing}px`;
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
