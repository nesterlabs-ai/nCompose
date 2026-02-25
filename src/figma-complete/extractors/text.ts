/**
 * Text Extractor - Extracts text content and styling from Figma nodes
 *
 * Preserves complete text data including:
 * - Text content (characters)
 * - Text styling (font, size, weight, line-height, etc.)
 * - Styled text segments (rich text)
 * - Named text styles
 * - Text alignment and auto-resize
 */

import type { ExtractorFn, StyledTextSegment, TypeStyle } from '../types.js';
import { addToGlobalVars, hasValue } from '../node-walker.js';

export const textExtractor: ExtractorFn = (node, result, context) => {
  // Only process TEXT nodes
  if (node.type !== 'TEXT') {
    return;
  }

  // Extract text content
  if (node.characters !== undefined) {
    result.characters = node.characters;
  }

  // Extract text alignment
  if (node.textAlignHorizontal) {
    result.textAlignHorizontal = node.textAlignHorizontal;
  }

  if (node.textAlignVertical) {
    result.textAlignVertical = node.textAlignVertical;
  }

  // Extract auto-resize mode
  if (node.textAutoResize) {
    result.textAutoResize = node.textAutoResize;
  }

  // Extract text truncation
  if (node.textTruncation) {
    result.textTruncation = node.textTruncation;
  }

  // Extract max lines
  if (node.maxLines) {
    result.maxLines = node.maxLines;
  }

  // Extract named text style reference
  if (node.styles?.text) {
    result.namedTextStyle = node.styles.text;
  }

  // Extract inline text style
  if (node.style) {
    result.style = extractTypeStyle(node.style);
  }

  // Extract styled text segments (for rich text)
  if (node.characterStyleOverrides && node.styleOverrideTable) {
    result.styledTextSegments = extractStyledTextSegments(
      node.characters || '',
      node.characterStyleOverrides,
      node.styleOverrideTable,
      node.style
    );
  }

  // Build simplified text style for globalVars
  const simplifiedTextStyle = buildSimplifiedTextStyle(node);
  if (simplifiedTextStyle && Object.keys(simplifiedTextStyle).length > 0) {
    const textStyleRef = addToGlobalVars(
      context.globalVars.textStyles,
      simplifiedTextStyle,
      'textStyle'
    );
    result.textStyle = textStyleRef;
  }
};

/**
 * Extract TypeStyle from raw node style
 */
function extractTypeStyle(rawStyle: any): TypeStyle {
  const style: TypeStyle = {};

  if (rawStyle.fontFamily) style.fontFamily = rawStyle.fontFamily;
  if (rawStyle.fontPostScriptName) style.fontPostScriptName = rawStyle.fontPostScriptName;
  if (rawStyle.fontWeight) style.fontWeight = rawStyle.fontWeight;
  if (rawStyle.fontSize) style.fontSize = rawStyle.fontSize;
  if (rawStyle.textCase) style.textCase = rawStyle.textCase;
  if (rawStyle.textDecoration) style.textDecoration = rawStyle.textDecoration;
  if (rawStyle.textAlignHorizontal) style.textAlignHorizontal = rawStyle.textAlignHorizontal;
  if (rawStyle.textAlignVertical) style.textAlignVertical = rawStyle.textAlignVertical;
  if (rawStyle.letterSpacing) style.letterSpacing = rawStyle.letterSpacing;
  if (rawStyle.lineHeightPx) style.lineHeightPx = rawStyle.lineHeightPx;
  if (rawStyle.lineHeightPercent) style.lineHeightPercent = rawStyle.lineHeightPercent;
  if (rawStyle.lineHeightPercentFontSize)
    style.lineHeightPercentFontSize = rawStyle.lineHeightPercentFontSize;
  if (rawStyle.lineHeightUnit) style.lineHeightUnit = rawStyle.lineHeightUnit;
  if (rawStyle.paragraphSpacing) style.paragraphSpacing = rawStyle.paragraphSpacing;
  if (rawStyle.paragraphIndent) style.paragraphIndent = rawStyle.paragraphIndent;
  if (rawStyle.italic !== undefined) style.italic = rawStyle.italic;
  if (rawStyle.fills) style.fills = rawStyle.fills;
  if (rawStyle.hyperlink) style.hyperlink = rawStyle.hyperlink;
  if (rawStyle.opentypeFlags) style.opentypeFlags = rawStyle.opentypeFlags;

  return style;
}

/**
 * Extract styled text segments for rich text
 */
function extractStyledTextSegments(
  characters: string,
  styleOverrides: number[],
  styleTable: Record<string, any>,
  baseStyle: any
): StyledTextSegment[] {
  const segments: StyledTextSegment[] = [];

  let currentStart = 0;
  let currentStyleId: string | null = null;

  for (let i = 0; i <= characters.length; i++) {
    const styleId = styleOverrides[i]?.toString() || null;

    // Style changed or reached end
    if (styleId !== currentStyleId || i === characters.length) {
      if (i > currentStart) {
        const style = currentStyleId
          ? { ...baseStyle, ...styleTable[currentStyleId] }
          : baseStyle;

        segments.push({
          characters: characters.substring(currentStart, i),
          start: currentStart,
          end: i,
          style: extractTypeStyle(style),
        });
      }

      currentStart = i;
      currentStyleId = styleId;
    }
  }

  return segments;
}

/**
 * Build CSS-friendly simplified text style
 */
function buildSimplifiedTextStyle(node: any): any {
  const style: any = {};

  if (node.style) {
    if (node.style.fontFamily) {
      style['font-family'] = node.style.fontFamily;
    }

    if (node.style.fontSize) {
      style['font-size'] = `${node.style.fontSize}px`;
    }

    if (node.style.fontWeight) {
      style['font-weight'] = node.style.fontWeight;
    }

    // Line height
    if (node.style.lineHeightPx) {
      style['line-height'] = `${node.style.lineHeightPx}px`;
    } else if (node.style.lineHeightPercent) {
      style['line-height'] = `${node.style.lineHeightPercent}%`;
    } else if (node.style.lineHeightPercentFontSize) {
      style['line-height'] = node.style.lineHeightPercentFontSize / 100;
    }

    // Letter spacing
    if (node.style.letterSpacing) {
      style['letter-spacing'] = `${node.style.letterSpacing}px`;
    }

    // Text alignment
    if (node.textAlignHorizontal) {
      const alignMap: Record<string, string> = {
        LEFT: 'left',
        CENTER: 'center',
        RIGHT: 'right',
        JUSTIFIED: 'justify',
      };
      style['text-align'] = alignMap[node.textAlignHorizontal] || 'left';
    }

    // Text decoration
    if (node.style.textDecoration && node.style.textDecoration !== 'NONE') {
      style['text-decoration'] = node.style.textDecoration.toLowerCase();
    }

    // Text transform (case)
    if (node.style.textCase && node.style.textCase !== 'ORIGINAL') {
      const caseMap: Record<string, string> = {
        UPPER: 'uppercase',
        LOWER: 'lowercase',
        TITLE: 'capitalize',
      };
      style['text-transform'] = caseMap[node.style.textCase];
    }

    // Italic
    if (node.style.italic) {
      style['font-style'] = 'italic';
    }

    // Color from fills
    if (node.style.fills && Array.isArray(node.style.fills) && node.style.fills.length > 0) {
      const fill = node.style.fills[0];
      if (fill.type === 'SOLID' && fill.color) {
        style.color = rgbaToString(fill.color);
      }
    }
  }

  // Text overflow - controls how overflowing text is displayed
  if (node.textTruncation === 'ENDING') {
    style['text-overflow'] = 'ellipsis';
  }

  // White space - controls text wrapping behavior
  // Derive from textAutoResize and maxLines properties
  if (node.textAutoResize === 'WIDTH_AND_HEIGHT' && node.maxLines === 1) {
    // Single line text that doesn't wrap
    style['white-space'] = 'nowrap';
  } else if (node.textAutoResize === 'NONE' || node.textAutoResize === 'HEIGHT') {
    // Fixed width text box - may need nowrap if maxLines is 1
    if (node.maxLines === 1) {
      style['white-space'] = 'nowrap';
    }
  }

  return style;
}

/**
 * Convert RGBA color to CSS string
 */
function rgbaToString(color: { r: number; g: number; b: number; a: number }): string {
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
 * Helper to check if a node is a text node
 */
export function isTextNode(node: any): boolean {
  return node.type === 'TEXT';
}

/**
 * Helper to get text content from a node
 */
export function getTextContent(node: any): string | null {
  if (node.type === 'TEXT' && node.characters) {
    return node.characters;
  }
  return null;
}
