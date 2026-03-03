/**
 * Visuals Extractor - Extracts visual properties from Figma nodes
 *
 * Preserves complete visual data including:
 * - Fills (solid, gradient, image) with variable bindings
 * - Strokes with variable bindings
 * - Effects (shadows, blurs) with variable bindings
 * - Opacity
 * - Blend modes
 * - Masks
 * - Border radius and corner smoothing
 */

import type { ExtractorFn, Paint, Stroke, Effect } from '../types.js';
import { addToGlobalVars, hasValue } from '../node-walker.js';

export const visualsExtractor: ExtractorFn = (node, result, context) => {
  // Fills
  if (node.fills && Array.isArray(node.fills) && node.fills.length > 0) {
    result.fills = node.fills.map((fill: any) => extractPaint(fill));

    // Store reference to named fill style
    if (node.styles?.fill) {
      result.namedFillStyle = node.styles.fill;
    }

    // Store variable bindings
    if (node.fillVariableIds) {
      result.fillVariableIds = { ...node.fillVariableIds };
    }

    // Add to globalVars for deduplication
    const simplifiedFills = buildSimplifiedFills(node.fills);
    if (simplifiedFills.length > 0) {
      const fillsRef = addToGlobalVars(
        context.globalVars.fills,
        simplifiedFills,
        'fills'
      );
      result.fillsRef = fillsRef;
    }
  }

  // Backgrounds (for frames)
  if (node.backgrounds && Array.isArray(node.backgrounds) && node.backgrounds.length > 0) {
    result.backgrounds = node.backgrounds.map((bg: any) => extractPaint(bg));

    if (node.backgroundVariableIds) {
      result.backgroundVariableIds = { ...node.backgroundVariableIds };
    }
  }

  // Strokes
  if (node.strokes && Array.isArray(node.strokes) && node.strokes.length > 0) {
    result.strokes = node.strokes.map((stroke: any) => extractPaint(stroke) as Stroke);

    // Store reference to named stroke style
    if (node.styles?.stroke) {
      result.namedStrokeStyle = node.styles.stroke;
    }

    // Store variable bindings
    if (node.strokeVariableIds) {
      result.strokeVariableIds = { ...node.strokeVariableIds };
    }

    // Stroke properties
    if (node.strokeWeight !== undefined) {
      result.strokeWeight = node.strokeWeight;
    }

    if (node.individualStrokeWeights) {
      result.individualStrokeWeights = {
        top: node.individualStrokeWeights.top,
        right: node.individualStrokeWeights.right,
        bottom: node.individualStrokeWeights.bottom,
        left: node.individualStrokeWeights.left,
      };
    }

    if (node.strokeCap) {
      result.strokeCap = node.strokeCap;
    }

    if (node.strokeJoin) {
      result.strokeJoin = node.strokeJoin;
    }

    if (node.strokeDashes && node.strokeDashes.length > 0) {
      result.strokeDashes = [...node.strokeDashes];
    }

    if (node.strokeMiterAngle !== undefined) {
      result.strokeMiterAngle = node.strokeMiterAngle;
    }

    if (node.strokeAlign) {
      result.strokeAlign = node.strokeAlign;
    }

    // Add to globalVars
    const simplifiedStroke = buildSimplifiedStroke(node);
    if (simplifiedStroke && Object.keys(simplifiedStroke).length > 0) {
      const strokeRef = addToGlobalVars(
        context.globalVars.strokes,
        simplifiedStroke,
        'stroke'
      );
      result.strokesRef = strokeRef;
    }
  }

  // Effects (shadows, blurs)
  if (node.effects && Array.isArray(node.effects) && node.effects.length > 0) {
    result.effects = node.effects
      .filter((effect: any) => effect.visible !== false)
      .map((effect: any) => extractEffect(effect));

    // Store reference to named effect style
    if (node.styles?.effect) {
      result.namedEffectStyle = node.styles.effect;
    }

    // Store variable bindings
    if (node.effectVariableIds) {
      result.effectVariableIds = { ...node.effectVariableIds };
    }

    // Add to globalVars
    const simplifiedEffects = buildSimplifiedEffects(node.effects);
    if (simplifiedEffects && Object.keys(simplifiedEffects).length > 0) {
      const effectsRef = addToGlobalVars(
        context.globalVars.effects,
        simplifiedEffects,
        'effects'
      );
      result.effectsRef = effectsRef;
    }
  }

  // Opacity
  if (node.opacity !== undefined && node.opacity !== 1) {
    result.opacity = node.opacity;
  }

  if (node.opacityVariableId) {
    result.opacityVariableId = node.opacityVariableId;
  }

  // Blend mode
  if (node.blendMode && node.blendMode !== 'NORMAL') {
    result.blendMode = node.blendMode;
  }

  // Mask
  if (node.isMask) {
    result.isMask = node.isMask;
  }

  if (node.isMaskOutline) {
    result.isMaskOutline = node.isMaskOutline;
  }

  if (node.maskType) {
    result.maskType = node.maskType;
  }

  // Border radius
  if (node.cornerRadius !== undefined && node.cornerRadius !== 0) {
    result.cornerRadius = node.cornerRadius;
  }

  if (node.rectangleCornerRadii) {
    result.rectangleCornerRadii = [
      node.rectangleCornerRadii[0],
      node.rectangleCornerRadii[1],
      node.rectangleCornerRadii[2],
      node.rectangleCornerRadii[3],
    ];
  }

  if (node.cornerSmoothing !== undefined && node.cornerSmoothing !== 0) {
    result.cornerSmoothing = node.cornerSmoothing;
  }

  // Layout grids
  if (node.layoutGrids && Array.isArray(node.layoutGrids) && node.layoutGrids.length > 0) {
    result.layoutGrids = node.layoutGrids;
  }

  if (node.gridStyleId) {
    result.gridStyleId = node.gridStyleId;
  }

  // Export settings
  if (node.exportSettings && Array.isArray(node.exportSettings)) {
    result.exportSettings = node.exportSettings;
  }
};

/**
 * Extract paint (fill or stroke)
 */
function extractPaint(paint: any): Paint {
  const extracted: Paint = {
    type: paint.type,
    visible: paint.visible !== false,
  };

  if (paint.opacity !== undefined) {
    extracted.opacity = paint.opacity;
  }

  if (paint.color) {
    extracted.color = {
      r: paint.color.r,
      g: paint.color.g,
      b: paint.color.b,
      a: paint.color.a,
    };
  }

  if (paint.blendMode) {
    extracted.blendMode = paint.blendMode;
  }

  // Gradient properties
  if (paint.gradientHandlePositions) {
    extracted.gradientHandlePositions = paint.gradientHandlePositions;
  }

  if (paint.gradientStops) {
    extracted.gradientStops = paint.gradientStops;
  }

  // Image properties
  if (paint.scaleMode) {
    extracted.scaleMode = paint.scaleMode;
  }

  if (paint.imageTransform) {
    extracted.imageTransform = paint.imageTransform;
  }

  if (paint.scalingFactor) {
    extracted.scalingFactor = paint.scalingFactor;
  }

  if (paint.rotation) {
    extracted.rotation = paint.rotation;
  }

  if (paint.imageRef) {
    extracted.imageRef = paint.imageRef;
  }

  if (paint.filters) {
    extracted.filters = paint.filters;
  }

  // Variable binding
  if (paint.boundVariables) {
    extracted.boundVariables = paint.boundVariables;
  }

  return extracted;
}

/**
 * Extract effect (shadow or blur)
 */
function extractEffect(effect: any): Effect {
  const extracted: Effect = {
    type: effect.type,
    visible: effect.visible !== false,
    radius: effect.radius || 0,
  };

  if (effect.color) {
    extracted.color = {
      r: effect.color.r,
      g: effect.color.g,
      b: effect.color.b,
      a: effect.color.a,
    };
  }

  if (effect.blendMode) {
    extracted.blendMode = effect.blendMode;
  }

  if (effect.offset) {
    extracted.offset = {
      x: effect.offset.x,
      y: effect.offset.y,
    };
  }

  if (effect.spread !== undefined) {
    extracted.spread = effect.spread;
  }

  if (effect.showShadowBehindNode !== undefined) {
    extracted.showShadowBehindNode = effect.showShadowBehindNode;
  }

  if (effect.boundVariables) {
    extracted.boundVariables = effect.boundVariables;
  }

  return extracted;
}

/**
 * Build simplified fills for CSS
 */
function buildSimplifiedFills(fills: any[]): any[] {
  return fills
    .filter((fill) => fill.visible !== false)
    .map((fill) => {
      const simplified: any = {
        type: fill.type,
      };

      if (fill.opacity !== undefined && fill.opacity !== 1) {
        simplified.opacity = fill.opacity;
      }

      if (fill.blendMode && fill.blendMode !== 'NORMAL') {
        simplified.blendMode = fill.blendMode;
      }

      if (fill.type === 'SOLID' && fill.color) {
        simplified.color = rgbaToString(fill.color);
      } else if (fill.type.startsWith('GRADIENT') && fill.gradientStops) {
        simplified.gradient = buildGradientString(fill);
      } else if (fill.type === 'IMAGE' && fill.imageRef) {
        simplified.imageUrl = fill.imageRef;
      }

      return simplified;
    });
}

/**
 * Build simplified stroke for CSS
 */
function buildSimplifiedStroke(node: any): any {
  if (!node.strokes || node.strokes.length === 0) {
    return {};
  }

  const stroke = node.strokes[0]; // Use first stroke
  const simplified: any = {};

  if (stroke.type === 'SOLID' && stroke.color) {
    simplified.color = rgbaToString(stroke.color);
  }

  if (node.strokeWeight !== undefined) {
    simplified.width = node.strokeWeight;
  }

  if (node.strokeDashes && node.strokeDashes.length > 0) {
    simplified.style = 'dashed';
  }

  if (node.strokeAlign) {
    simplified.position = node.strokeAlign;
  }

  return simplified;
}

/**
 * Build simplified effects for CSS
 */
function buildSimplifiedEffects(effects: any[]): any {
  const boxShadows: string[] = [];
  const filters: string[] = [];
  const backdropFilters: string[] = [];

  for (const effect of effects) {
    if (effect.visible === false) continue;

    if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
      const offsetX = effect.offset?.x || 0;
      const offsetY = effect.offset?.y || 0;
      const blur = effect.radius || 0;
      const spread = effect.spread || 0;
      const color = effect.color ? rgbaToString(effect.color) : 'rgba(0,0,0,0.25)';
      const inner = effect.type === 'INNER_SHADOW' ? 'inset ' : '';

      boxShadows.push(`${inner}${offsetX}px ${offsetY}px ${blur}px ${spread}px ${color}`);
    } else if (effect.type === 'LAYER_BLUR') {
      filters.push(`blur(${effect.radius}px)`);
    } else if (effect.type === 'BACKGROUND_BLUR') {
      backdropFilters.push(`blur(${effect.radius}px)`);
    }
  }

  const result: any = {};

  if (boxShadows.length > 0) {
    result.boxShadow = boxShadows;
  }

  if (filters.length > 0) {
    result.filter = filters;
  }

  if (backdropFilters.length > 0) {
    result.backdropFilter = backdropFilters;
  }

  return result;
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
 * Build CSS gradient string
 */
function buildGradientString(fill: any): string {
  if (!fill.gradientStops) return '';

  const stops = fill.gradientStops
    .map((stop: any) => {
      const color = rgbaToString(stop.color);
      const position = Math.round(stop.position * 100);
      return `${color} ${position}%`;
    })
    .join(', ');

  switch (fill.type) {
    case 'GRADIENT_LINEAR': {
      let angle = 180;
      if (fill.gradientHandlePositions?.length >= 2) {
        const [h0, h1] = fill.gradientHandlePositions;
        angle = Math.round(Math.atan2(h1.x - h0.x, -(h1.y - h0.y)) * (180 / Math.PI));
      }
      return `linear-gradient(${angle}deg, ${stops})`;
    }
    case 'GRADIENT_RADIAL': {
      if (fill.gradientHandlePositions?.length >= 1) {
        const cx = Math.round(fill.gradientHandlePositions[0].x * 100);
        const cy = Math.round(fill.gradientHandlePositions[0].y * 100);
        return `radial-gradient(circle at ${cx}% ${cy}%, ${stops})`;
      }
      return `radial-gradient(${stops})`;
    }
    case 'GRADIENT_ANGULAR':
      return `conic-gradient(from 0deg, ${stops})`;
    default:
      return `linear-gradient(${stops})`;
  }
}
