import { dump } from 'js-yaml';
import { parseFigmaUrl } from './utils/figma-url-parser.js';
import { FigmaClient } from './figma/fetch.js';
import { extractCompleteDesign, allExtractors } from './figma-complete/index.js';
import {
  parseComponentSet,
  buildVariantCSS,
  detectComponentCategory,
  CATEGORY_HTML_TAGS,
  CATEGORY_ARIA_ROLES,
  toKebabCase,
} from './figma/component-set-parser.js';
import type { ComponentCategory } from './figma/component-set-parser.js';
import {
  buildVariantPromptData,
  buildComponentSetUserPrompt,
  buildComponentSetSystemPrompt,
} from './figma/variant-prompt-builder.js';
import {
  collectAssetNodes,
  collectAssetNodesFromAllVariants,
  exportAssets,
  exportAssetsFromAllVariants,
  buildAssetMap,
  buildDimensionMap,
} from './figma/asset-export.js';
import { extractPageLayoutCSS } from './figma/page-layout.js';
import { injectCSS } from './compile/inject-css.js';
import { prependFontImport } from './compile/font-resolver.js';
import { stitchPageComponent } from './compile/stitch.js';
import type { SectionOutput } from './compile/stitch.js';
import { createLLMProvider } from './llm/index.js';
import {
  assembleSystemPrompt,
  assembleUserPrompt,
  assemblePageSectionSystemPrompt,
  assemblePageSectionUserPrompt,
  type PageSectionContext,
} from './prompt/index.js';
import { generateWithRetry } from './compile/retry.js';
import { generateCompoundSection, deduplicateSiblingNames } from './compile/component-gen.js';
import { parseMitosisCode } from './compile/parse-and-validate.js';
import { buildFidelityReport } from './compile/fidelity-report.js';
import { generateFrameworkCode } from './compile/generate.js';
import { config } from './config.js';
import type { ConvertOptions, ConversionResult, Framework, AssetEntry, ChartComponent } from './types/index.js';
import { isChartSection, extractChartMetadata } from './figma/chart-detection.js';
import { generateChartCode } from './compile/chart-codegen.js';

export interface ConvertCallbacks {
  onStep?: (step: string) => void;
  onAttempt?: (attempt: number, maxRetries: number, error?: string) => void;
  onDebugData?: (data: { yamlContent: string; rawLLMOutput: string }) => void;
}

/**
 * Converts HTML-style JSX attributes to valid React JSX.
 *
 * 1. `class="foo"` → `className="foo"` (skips already-correct `className=`)
 * 2. `style="prop: val; ..."` → `style={{ prop: 'val', ... }}` (object literal)
 *
 * LLM-generated section bodies often use HTML conventions; this post-processing
 * step prevents React runtime errors that would cause a blank/black render.
 */
function sanitizeJSXAttributes(jsx: string): string {
  // 1. class="..." → className="..." (skip if already className=)
  let result = jsx.replace(/\bclass(?!Name)="/g, 'className="');

  // 2. style="css string" → style={{ camelProp: 'value', ... }}
  result = result.replace(/\bstyle="([^"]*)"/g, (_match: string, cssString: string) => {
    const declarations = cssString.split(';').map((d: string) => d.trim()).filter(Boolean);
    if (declarations.length === 0) return 'style={{}}';
    const props = declarations.map((decl: string) => {
      const colonIdx = decl.indexOf(':');
      if (colonIdx === -1) return null;
      const prop = decl.slice(0, colonIdx).trim();
      const value = decl.slice(colonIdx + 1).trim();
      const camelProp = prop.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());
      const escapedValue = value.replace(/'/g, "\\'");
      return `${camelProp}: '${escapedValue}'`;
    }).filter(Boolean);
    return `style={{ ${props.join(', ')} }}`;
  });

  return result;
}

/**
 * For INPUT and TEXTAREA components, CSS is generated from Figma frame names:
 * the "Input" Figma frame gets class `{base}__input`.
 * But in HTML, that class is applied to the actual `<input>` / `<textarea>` element,
 * which cannot have flex/background/border-radius styling.
 *
 * Fix: copy visual styling from `{base}__input` → `{base}__field` (the wrapper div),
 * replace `{base}__input` rules with input-reset styles, and rename descendant
 * selectors in state modifiers to point at `{base}__field`.
 */
function fixInputFieldCSS(css: string, baseClass: string): string {
  const esc = baseClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Extract the main .{base}__input { ... } block (NOT child elements like __input__)
  const mainBlockRe = new RegExp(`\\.${esc}__input(?!__)\\s*\\{([^}]+)\\}`);
  const match = css.match(mainBlockRe);
  if (!match) return css; // Nothing to fix

  let fieldContent = match[1];

  // Ensure flex-direction: row and align-items: center are present on the field
  if (!fieldContent.includes('flex-direction')) {
    fieldContent = fieldContent.replace('display: flex;', 'display: flex;\n  flex-direction: row;\n  align-items: center;');
  } else if (!fieldContent.includes('align-items')) {
    fieldContent = fieldContent.replace('flex-direction: row;', 'flex-direction: row;\n  align-items: center;');
  }

  const fieldBlock = `.${baseClass}__field {${fieldContent}}`;

  const inputReset =
    `.${baseClass}__input {\n` +
    `  border: none;\n  outline: none;\n  background: transparent;\n` +
    `  flex: 1;\n  min-width: 0;\n  padding: 0;\n  font: inherit;\n  color: inherit;\n  cursor: text;\n}`;

  let result = css;

  // 1. Replace the main .{base}__input block with the input reset
  result = result.replace(mainBlockRe, inputReset);

  // 2. Rename all descendant selectors: .foo .{base}__input → .foo .{base}__field
  //    (handles state modifiers like .search[data-error] .search__input)
  result = result.replace(
    new RegExp(`([ \\t]+)\\.${esc}__input(?!__)`, 'g'),
    `$1.${baseClass}__field`,
  );

  // 3. Prepend the new field block
  return fieldBlock + '\n\n' + result;
}

/**
 * Detects if the simplified Figma data contains a COMPONENT_SET node.
 */
function isComponentSet(enhanced: any): boolean {
  const nodes = enhanced?.nodes;
  if (!nodes || !Array.isArray(nodes)) return false;
  return nodes[0]?.type === 'COMPONENT_SET';
}

/**
 * Detects if the Figma node is a multi-section page (PATH C).
 *
 * Detection uses three complementary signals — any one is sufficient:
 *
 * 1. **Name heuristics** — root frame name contains page-like keywords
 *    ("page", "landing", "home", "layout", "screen", "view").
 *
 * 2. **Vertical auto-layout with fill-width children** — root is a vertical
 *    auto-layout frame AND has ≥ minSections children whose horizontal sizing
 *    is FILL (span the full page width).
 *
 * 3. **Size-based threshold** (original) — ≥ minSections children each cover
 *    ≥ minChildWidthRatio of the parent width and ≥ minChildHeight px.
 *
 * All three signals also require at least one child whose name suggests a
 * semantic section role (header, hero, footer, nav, section, feature, etc.)
 * to avoid false-positives from e.g. multi-column card grids.
 */
export function isMultiSectionPage(enhanced: any): boolean {
  const root = enhanced?.nodes?.[0];
  if (!root || root.type !== 'FRAME') return false;
  const children: any[] = root.children || [];
  if (children.length < config.page.minSections) return false;

  // Helper: does any child name suggest a semantic page section?
  const SECTION_PATTERNS = /header|hero|footer|navbar|nav|section|feature|testimonial|pricing|cta|banner|content|main|intro|about|contact|faq/i;
  const hasSectionLikeChild = children.some(
    (c: any) => c.name && SECTION_PATTERNS.test(c.name),
  );
  // ── Signal 1: name-based ─────────────────────────────────────────────────
  const PAGE_NAME_PATTERNS = /page|landing|home|layout|screen|view|template|main|dashboard|create|edit|settings|form/i;
  if (PAGE_NAME_PATTERNS.test(root.name ?? '') && hasSectionLikeChild) {
    return true;
  }

  // ── Signal 2: vertical auto-layout with fill-width children ─────────────
  const layoutMode = root.layoutMode ?? root.layout?.mode;
  if ((layoutMode === 'VERTICAL' || layoutMode === 'column') && hasSectionLikeChild) {
    const fillCount = children.filter((c: any) => {
      const hSizing = c.layoutSizing?.horizontal ?? c.layoutSizingHorizontal;
      return (
        (c.type === 'FRAME' || c.type === 'COMPONENT' || c.type === 'INSTANCE') &&
        (hSizing === 'FILL' || hSizing === 'STRETCH')
      );
    }).length;
    if (fillCount >= config.page.minSections) return true;
  }

  // ── Signal 3: size-based threshold (original) ────────────────────────────
  const parentWidth =
    root.absoluteBoundingBox?.width ?? root.dimensions?.width ?? root.size?.x ?? 0;
  if (parentWidth === 0) return false;

  let sizeableCount = 0;
  for (const child of children) {
    if (child.type !== 'FRAME' && child.type !== 'COMPONENT' && child.type !== 'INSTANCE') continue;
    const w = child.absoluteBoundingBox?.width ?? child.dimensions?.width ?? child.size?.x ?? 0;
    const h = child.absoluteBoundingBox?.height ?? child.dimensions?.height ?? child.size?.y ?? 0;
    if (w >= parentWidth * config.page.minChildWidthRatio && h >= config.page.minChildHeight) {
      sizeableCount++;
    }
  }
  if (sizeableCount >= config.page.minSections && hasSectionLikeChild) return true;

  // ── Signal 4: ≥3 wide children (name-agnostic, layout-agnostic) ──
  // Catches pages with children named "Block 1", "Block 2", etc.
  // No longer requires vertical auto-layout — pages without auto-layout
  // but with wide stacked children are also pages.
  {
    let wideChildCount = 0;
    for (const child of children) {
      if (child.type !== 'FRAME' && child.type !== 'COMPONENT' && child.type !== 'INSTANCE') continue;
      const w = child.absoluteBoundingBox?.width ?? child.dimensions?.width ?? child.size?.x ?? 0;
      if (parentWidth > 0 && w >= parentWidth * 0.8) wideChildCount++;
    }
    if (wideChildCount >= 3) return true;
  }

  // ── Signal 5: any layout with ≥2 child frames that are individually chart sections ──
  // Catches horizontal/grid rows of charts (e.g. 3 pie charts side by side).
  let chartChildCount = 0;
  for (const child of children) {
    if (child.visible === false) continue; // skip hidden children
    if (child.type !== 'FRAME' && child.type !== 'COMPONENT' && child.type !== 'INSTANCE') continue;
    if (isChartSection(child)) chartChildCount++;
    if (chartChildCount >= 2) return true;
  }

  // ── Signal 6: large child contains multiple wide "card" frames ──
  // Common pattern: root → [header, breadcrumbs, content-wrapper]
  // where content-wrapper holds the actual sections (define policy card,
  // define rules card, etc.). Look one level deeper.
  for (const child of children) {
    if (child.type !== 'FRAME') continue;
    const grandchildren: any[] = child.children || [];
    if (grandchildren.length < config.page.minSections) continue;
    const childWidth = child.absoluteBoundingBox?.width ?? child.dimensions?.width ?? child.size?.x ?? 0;
    if (childWidth < parentWidth * 0.8) continue; // must be a major child
    let wideGrandchildCount = 0;
    for (const gc of grandchildren) {
      if (gc.type !== 'FRAME' && gc.type !== 'COMPONENT' && gc.type !== 'INSTANCE') continue;
      const gcw = gc.absoluteBoundingBox?.width ?? gc.dimensions?.width ?? gc.size?.x ?? 0;
      if (childWidth > 0 && gcw >= childWidth * 0.8) wideGrandchildCount++;
    }
    if (wideGrandchildCount >= config.page.minSections) return true;
  }

  return false;
}

/**
 * Extracts a CSS-friendly YAML representation of the default variant's Figma node.
 * Includes all visual/layout properties so the LLM can generate accurate code.
 */
function extractDefaultVariantYaml(node: any): string {
  if (!node) return '';
  const serialized = serializeNodeForPrompt(node);
  return dump(serialized, { lineWidth: 120, noRefs: true });
}

/**
 * Converts a Figma RGBA color {r,g,b,a} (0-1 range) to a CSS color string.
 */
function figmaColorToCSS(c: any, paintOpacity?: number): string {
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  const a = paintOpacity ?? c.a ?? 1;
  if (a >= 1) return `rgb(${r}, ${g}, ${b})`;
  return `rgba(${r}, ${g}, ${b}, ${parseFloat(a.toFixed(2))})`;
}

/**
 * Comprehensive node serializer for LLM prompts.
 *
 * Converts raw Figma/CompleteNode properties into CSS-friendly YAML that the
 * LLM can directly use to generate accurate code. Includes:
 * - Auto-layout (flex direction, gap, padding, alignment, wrap)
 * - Dimensions and sizing mode (fill / hug / fixed)
 * - Fills → CSS colors/gradients
 * - Strokes → CSS border
 * - Effects → box-shadow, filter, backdrop-filter
 * - Border radius, opacity, overflow, absolute positioning, rotation
 * - Text content and styling
 */
const MAX_SERIALIZE_DEPTH = 15;

function serializeNodeForPrompt(node: any, depth: number = 0, assetMap?: Map<string, string>, parentLayoutDirection?: 'row' | 'column'): any {
  if (!node) return null;
  if (node.name?.startsWith('_')) return null;

  // If this node is an exported SVG asset, emit a compact ICON marker
  // instead of serializing the full subtree. This tells the LLM to
  // render it as <img src="./assets/filename.svg"> at this position.
  // Check BEFORE visibility — some icon slots may be invisible in Figma
  // but we still have exported SVGs for them.
  if (assetMap && node.id && assetMap.has(node.id)) {
    const w = node.absoluteBoundingBox?.width ?? node.size?.x;
    const h = node.absoluteBoundingBox?.height ?? node.size?.y;
    return {
      name: node.name,
      type: 'ICON',
      assetFile: assetMap.get(node.id),
      ...(w ? { width: `${Math.round(w)}px` } : {}),
      ...(h ? { height: `${Math.round(h)}px` } : {}),
    };
  }

  // Prune invisible subtrees entirely — they bloat the YAML with hidden
  // error states, chip lists, descriptions etc. that are useless for static output.
  if (node.visible === false) return null;

  if (depth > MAX_SERIALIZE_DEPTH) {
    console.warn(`[serializeNodeForPrompt] Depth limit (${MAX_SERIALIZE_DEPTH}) reached at "${node.name ?? 'unknown'}" — subtree truncated`);
    return { name: node.name, type: node.type, truncated: true };
  }

  const result: any = { name: node.name, type: node.type };

  // ── Text content ────────────────────────────────────────────────────
  if (node.characters) result.text = node.characters;
  else if (node.text) result.text = node.text;

  // ── Auto-layout → CSS flex ─────────────────────────────────────────
  if (node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL') {
    const layout: any = {
      direction: node.layoutMode === 'HORIZONTAL' ? 'row' : 'column',
    };

    // Alignment
    const justifyMap: Record<string, string> = {
      MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', SPACE_BETWEEN: 'space-between',
    };
    const alignMap: Record<string, string> = {
      MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end',
    };
    if (node.primaryAxisAlignItems) {
      layout.justifyContent = justifyMap[node.primaryAxisAlignItems] || node.primaryAxisAlignItems;
    }
    if (node.counterAxisAlignItems) {
      layout.alignItems = alignMap[node.counterAxisAlignItems] || 'stretch';
    }

    // Gap
    if (node.itemSpacing) layout.gap = `${node.itemSpacing}px`;
    if (node.counterAxisSpacing) layout.rowGap = `${node.counterAxisSpacing}px`;

    // Padding (from extracted object or raw individual props)
    const pt = node.padding?.top ?? node.paddingTop ?? 0;
    const pr = node.padding?.right ?? node.paddingRight ?? 0;
    const pb = node.padding?.bottom ?? node.paddingBottom ?? 0;
    const pl = node.padding?.left ?? node.paddingLeft ?? 0;
    if (pt || pr || pb || pl) {
      if (pt === pr && pr === pb && pb === pl) {
        layout.padding = `${pt}px`;
      } else {
        layout.padding = `${pt}px ${pr}px ${pb}px ${pl}px`;
      }
    }

    // Wrap
    if (node.layoutWrap === 'WRAP') layout.wrap = true;

    result.layout = layout;
  }

  // ── Sizing ─────────────────────────────────────────────────────────
  // figma-complete extractor puts sizing in nested layoutSizing object,
  // but INSTANCE/child nodes inside auto-layout use flat properties
  // (layoutSizingHorizontal / layoutSizingVertical) from the Figma API.
  const hSizing = node.layoutSizing?.horizontal ?? node.layoutSizingHorizontal;
  const vSizing = node.layoutSizing?.vertical ?? node.layoutSizingVertical;
  if (hSizing === 'FILL') result.widthMode = 'fill';
  else if (hSizing === 'HUG') result.widthMode = 'hug';
  if (vSizing === 'FILL') result.heightMode = 'fill';
  else if (vSizing === 'HUG') result.heightMode = 'hug';
  if (node.layoutGrow) result.flexGrow = node.layoutGrow;

  // Dimensions — suppress pixel values when a sizing mode is set, because
  // the LLM should use the mode (fill → 100%, hug → auto) not a fixed value.
  // The bounding-box width is just the current rendered size in the Figma canvas,
  // not the intended CSS dimension.
  const w = node.absoluteBoundingBox?.width ?? node.size?.x;
  const h = node.absoluteBoundingBox?.height ?? node.size?.y;
  if (w && !result.widthMode) result.width = `${Math.round(w)}px`;
  if (h && !result.heightMode) result.height = `${Math.round(h)}px`;

  // ── Cross-axis self-alignment (layoutAlign) ──────────────────────────
  // Overrides the parent's counterAxisAlignItems for this specific child.
  // Critical for form fields that need to stretch to full container width.
  if (node.layoutAlign && node.layoutAlign !== 'INHERIT') {
    const alignSelfMap: Record<string, string> = {
      STRETCH: 'stretch',
      MIN: 'flex-start',
      CENTER: 'center',
      MAX: 'flex-end',
    };
    const mapped = alignSelfMap[node.layoutAlign];
    if (mapped) result.alignSelf = mapped;

    // When STRETCH, the cross-axis pixel dimension is just the rendered
    // result of the stretch, not a constraint. Suppress it to prevent the
    // LLM from emitting a fixed pixel value alongside align-self:stretch.
    // Column parent → cross-axis is horizontal → suppress width.
    // Row parent → cross-axis is vertical → suppress height.
    if (node.layoutAlign === 'STRETCH' && parentLayoutDirection) {
      if (parentLayoutDirection === 'column') {
        delete result.width;
        delete result.widthMode; // stretch handles it
      } else {
        delete result.height;
        delete result.heightMode;
      }
    }
  }

  // ── Min / max dimension constraints ──────────────────────────────────
  if (node.minWidth != null && node.minWidth > 0) result.minWidth = `${node.minWidth}px`;
  if (node.maxWidth != null && node.maxWidth > 0) result.maxWidth = `${node.maxWidth}px`;
  if (node.minHeight != null && node.minHeight > 0) result.minHeight = `${node.minHeight}px`;
  if (node.maxHeight != null && node.maxHeight > 0) result.maxHeight = `${node.maxHeight}px`;

  // ── Fills → CSS colors / gradients ─────────────────────────────────
  // Skip fills on TEXT nodes — their fills represent text color (already in textStyle.color),
  // NOT background-color. Emitting fills on TEXT causes black bars.
  if (node.type !== 'TEXT' && node.fills && Array.isArray(node.fills)) {
    const visible = node.fills.filter((f: any) => f.visible !== false);
    if (visible.length > 0) {
      result.fills = visible.map((f: any) => {
        if (f.type === 'SOLID' && f.color) {
          return figmaColorToCSS(f.color, f.opacity);
        }
        if (f.type?.startsWith('GRADIENT') && f.gradientStops) {
          const stops = f.gradientStops
            .map((s: any) => `${figmaColorToCSS(s.color)} ${Math.round(s.position * 100)}%`)
            .join(', ');
          if (f.type === 'GRADIENT_LINEAR') {
            let angle = 180;
            if (f.gradientHandlePositions?.length >= 2) {
              const [h0, h1] = f.gradientHandlePositions;
              angle = Math.round(Math.atan2(h1.x - h0.x, -(h1.y - h0.y)) * (180 / Math.PI));
            }
            return `linear-gradient(${angle}deg, ${stops})`;
          }
          if (f.type === 'GRADIENT_RADIAL') {
            if (f.gradientHandlePositions?.length >= 1) {
              const cx = Math.round(f.gradientHandlePositions[0].x * 100);
              const cy = Math.round(f.gradientHandlePositions[0].y * 100);
              return `radial-gradient(circle at ${cx}% ${cy}%, ${stops})`;
            }
            return `radial-gradient(${stops})`;
          }
          if (f.type === 'GRADIENT_ANGULAR') return `conic-gradient(from 0deg, ${stops})`;
        }
        if (f.type === 'IMAGE') {
          // Signal to the LLM that this is a background image fill so it can
          // emit the correct CSS (background-image / object-fit rules).
          return {
            type: 'image',
            scaleMode: (f.scaleMode ?? 'FILL').toLowerCase(), // fill / fit / tile / stretch
          };
        }
        return f.type; // EMOJI, VIDEO, etc.
      });
    }
  }

  // ── Strokes → CSS border ───────────────────────────────────────────
  if (node.strokes && Array.isArray(node.strokes) && node.strokes.length > 0) {
    const s = node.strokes.find((st: any) => st.visible !== false);
    if (s?.color) {
      const sw = node.strokeWeight ?? 1;
      const border: any = {
        color: figmaColorToCSS(s.color, s.opacity),
        width: `${Math.round(sw * 100) / 100}px`,
      };
      if (node.strokeAlign) border.position = node.strokeAlign.toLowerCase();
      if (node.strokeDashes?.length > 0) border.style = 'dashed';
      if (node.individualStrokeWeights) {
        const isw = node.individualStrokeWeights;
        border.widths = `${Math.round(isw.top * 100) / 100}px ${Math.round(isw.right * 100) / 100}px ${Math.round(isw.bottom * 100) / 100}px ${Math.round(isw.left * 100) / 100}px`;
      }
      result.border = border;
    }
  }

  // ── Effects → box-shadow / filter / backdrop-filter ────────────────
  if (node.effects && Array.isArray(node.effects)) {
    const visible = node.effects.filter((e: any) => e.visible !== false);
    for (const effect of visible) {
      if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
        if (!result.shadows) result.shadows = [];
        const c = effect.color;
        const color = c
          ? `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${parseFloat((c.a ?? 1).toFixed(2))})`
          : 'rgba(0,0,0,0.25)';
        const inset = effect.type === 'INNER_SHADOW' ? 'inset ' : '';
        result.shadows.push(
          `${inset}${Math.round(effect.offset?.x ?? 0)}px ${Math.round(effect.offset?.y ?? 0)}px ${Math.round(effect.radius ?? 0)}px ${Math.round(effect.spread ?? 0)}px ${color}`,
        );
      } else if (effect.type === 'LAYER_BLUR') {
        result.filter = `blur(${effect.radius}px)`;
      } else if (effect.type === 'BACKGROUND_BLUR') {
        result.backdropFilter = `blur(${effect.radius}px)`;
      }
    }
  }

  // ── Text styling → CSS font properties ─────────────────────────────
  if (node.style && node.type === 'TEXT') {
    const ts: any = {};
    if (node.style.fontFamily) ts.fontFamily = `"${node.style.fontFamily}", sans-serif`;
    if (node.style.fontSize) ts.fontSize = `${node.style.fontSize}px`;
    if (node.style.fontWeight) ts.fontWeight = node.style.fontWeight;
    if (node.style.lineHeightPx) ts.lineHeight = `${Math.round(node.style.lineHeightPx * 100) / 100}px`;
    if (node.style.letterSpacing) {
      // Figma letterSpacing can be px or percentage of font-size
      if (typeof node.style.letterSpacing === 'object' && node.style.letterSpacing.unit === 'PERCENT') {
        ts.letterSpacing = `${Math.round(node.style.letterSpacing.value * 100) / 100}em`;
      } else {
        const lsVal = typeof node.style.letterSpacing === 'object' ? node.style.letterSpacing.value : node.style.letterSpacing;
        ts.letterSpacing = `${Math.round(lsVal * 100) / 100}px`;
      }
    }
    if (node.style.italic) ts.fontStyle = 'italic';
    if (node.style.textCase && node.style.textCase !== 'ORIGINAL') {
      const caseMap: Record<string, string> = { UPPER: 'uppercase', LOWER: 'lowercase', TITLE: 'capitalize' };
      ts.textTransform = caseMap[node.style.textCase];
    }
    if (node.style.textDecoration && node.style.textDecoration !== 'NONE') {
      ts.textDecoration = node.style.textDecoration.toLowerCase();
    }
    // Horizontal text alignment (left/center/right/justify)
    if (node.style.textAlignHorizontal && node.style.textAlignHorizontal !== 'LEFT') {
      const alignMap: Record<string, string> = { CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' };
      const mapped = alignMap[node.style.textAlignHorizontal];
      if (mapped) ts.textAlign = mapped;
    }
    // Vertical text alignment
    if (node.style.textAlignVertical && node.style.textAlignVertical !== 'TOP') {
      const vAlignMap: Record<string, string> = { CENTER: 'center', BOTTOM: 'flex-end' };
      const vMapped = vAlignMap[node.style.textAlignVertical];
      if (vMapped) {
        ts.display = 'flex';
        ts.alignItems = vMapped;
      }
    }
    // Text truncation / overflow
    if (node.style.textAutoResize === 'TRUNCATE') {
      ts.overflow = 'hidden';
      ts.textOverflow = 'ellipsis';
      ts.whiteSpace = 'nowrap';
    } else if (node.style.maxLines && node.style.maxLines > 1) {
      ts.overflow = 'hidden';
      ts.display = '-webkit-box';
      ts['-webkit-line-clamp'] = node.style.maxLines;
      ts['-webkit-box-orient'] = 'vertical';
    }
    // Paragraph spacing → margin-bottom (CSS has no paragraph-spacing property)
    if (node.style.paragraphSpacing && node.style.paragraphSpacing > 0) {
      ts.marginBottom = `${node.style.paragraphSpacing}px`;
    }
    // Text color is stored in node.fills (Paint[]), NOT node.style.fills.
    // Figma's .style object contains typography only; the fill color is always
    // on the top-level node.fills array.
    const textFill = Array.isArray(node.fills)
      ? node.fills.find((f: any) => f.visible !== false && f.type === 'SOLID' && f.color)
      : null;
    if (textFill?.color) {
      ts.color = figmaColorToCSS(textFill.color, textFill.opacity);
    } else if (Array.isArray(node.style.fills) && node.style.fills[0]?.color) {
      // Fallback: Framelink-simplified nodes may embed fills inside .style
      ts.color = figmaColorToCSS(node.style.fills[0].color, node.style.fills[0].opacity);
    }
    if (Object.keys(ts).length > 0) result.textStyle = ts;
  } else if (node.textStyle && typeof node.textStyle === 'string') {
    // Keep ref-style textStyle from Framelink simplified output
    result.textStyle = node.textStyle;
  }

  // ── Border radius ──────────────────────────────────────────────────
  if (node.rectangleCornerRadii) {
    const r = node.rectangleCornerRadii;
    if (r[0] === r[1] && r[1] === r[2] && r[2] === r[3]) {
      if (r[0] > 0) result.borderRadius = `${r[0]}px`;
    } else {
      result.borderRadius = `${r[0]}px ${r[1]}px ${r[2]}px ${r[3]}px`;
    }
  } else if (node.cornerRadius && node.cornerRadius > 0) {
    result.borderRadius = `${node.cornerRadius}px`;
  } else if (node.borderRadius) {
    result.borderRadius = node.borderRadius;
  }

  // ── Opacity ────────────────────────────────────────────────────────
  if (node.opacity !== undefined && node.opacity < 1) {
    result.opacity = Math.round(node.opacity * 100) / 100;
  }

  // ── Overflow ───────────────────────────────────────────────────────
  if (node.clipsContent === true) {
    result.overflow = 'hidden';
  }

  // ── Absolute positioning ───────────────────────────────────────────
  if (node.layoutPositioning === 'ABSOLUTE') {
    result.position = 'absolute';
    if (node.relativeTransform) {
      result.left = `${Math.round(node.relativeTransform[0][2])}px`;
      result.top = `${Math.round(node.relativeTransform[1][2])}px`;
    }
  }

  // ── Rotation ───────────────────────────────────────────────────────
  if (node.rotation && node.rotation !== 0) {
    result.rotation = `${node.rotation}deg`;
  }

  // ── Blend mode ─────────────────────────────────────────────────────
  if (node.blendMode && node.blendMode !== 'PASS_THROUGH' && node.blendMode !== 'NORMAL') {
    result.blendMode = node.blendMode.toLowerCase().replace(/_/g, '-');
  }

  // ── INSTANCE variant context ────────────────────────────────────────
  // When an INSTANCE node is used inside a section or page, tell the LLM
  // which component variant was selected and what property overrides it has.
  // This prevents all instances from rendering as the default variant.
  if (node.type === 'INSTANCE') {
    if (node.mainComponent?.name) result.componentVariant = node.mainComponent.name;
    if (node.componentProperties && Object.keys(node.componentProperties).length > 0) {
      result.componentProperties = Object.fromEntries(
        Object.entries(node.componentProperties as Record<string, any>).map(([k, v]) => [
          k,
          typeof v === 'object' && v !== null ? (v.value ?? v) : v,
        ]),
      );
    } else if (node.componentPropertyValues && Object.keys(node.componentPropertyValues).length > 0) {
      result.componentProperties = node.componentPropertyValues;
    }
  }

  // ── Children (recursive) ───────────────────────────────────────────
  // Pass this node's layout direction so children can suppress cross-axis
  // pixel values when they have layoutAlign: STRETCH.
  const thisLayoutDir: 'row' | 'column' | undefined =
    node.layoutMode === 'HORIZONTAL' ? 'row'
    : node.layoutMode === 'VERTICAL' ? 'column'
    : undefined;

  if (node.children && Array.isArray(node.children)) {
    const mapped = node.children.map((c: any) => serializeNodeForPrompt(c, depth + 1, assetMap, thisLayoutDir)).filter(Boolean);
    if (mapped.length > 0) {
      // Deduplicate sibling names: same-named children with different visual
      // properties get unique suffixes so the LLM generates distinct CSS classes.
      deduplicateSiblingNames({ children: mapped });
      result.children = mapped;
    }
  }

  return result;
}

/**
 * Build human-readable asset placement hints for PATH B.
 * Walks the raw Figma node tree and for each node whose id is in the asset map,
 * emits a line describing where the icon is and what file to use.
 */
function buildPathBAssetHints(assets: AssetEntry[], rootNode: any): string {
  if (!assets.length || !rootNode) return '';
  const assetMap = buildAssetMap(assets);
  const lines: string[] = [];

  function walk(node: any, ancestors: string[]): void {
    if (!node) return;
    const path = node.name ? [...ancestors, node.name] : ancestors;
    if (node.id && assetMap.has(node.id)) {
      const w = node.absoluteBoundingBox?.width ?? node.size?.x;
      const h = node.absoluteBoundingBox?.height ?? node.size?.y;
      const dims = w && h ? ` (${Math.round(w)}×${Math.round(h)})` : '';
      const location = path.length > 1 ? path.slice(0, -1).join(' > ') : 'root';
      lines.push(`- Node "${node.name}"${dims} inside "${location}" → \`${assetMap.get(node.id)}\``);
    }
    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) walk(child, path);
    }
  }

  walk(rootNode, []);
  if (lines.length === 0) return '';

  return `\n**Icon/Asset slots in this design:**\n${lines.join('\n')}\nRender these as \`<img src="./assets/..." alt="" />\` at the matching position.\n`;
}

/**
 * Core pipeline: Figma URL → framework code.
 *
 * Two paths:
 * A) COMPONENT_SET → parse variants → LLM generates class-based Mitosis component
 *    → Mitosis compiles → inject deterministic CSS
 * B) Single component → LLM generates Mitosis with css={{}} → Mitosis compiles
 *
 * This function is decoupled from CLI/IO for testability.
 */
export async function convertFigmaToCode(
  figmaUrl: string,
  options: ConvertOptions,
  callbacks?: ConvertCallbacks,
): Promise<ConversionResult> {
  const onStep = callbacks?.onStep;

  // Step 1: Parse URL
  onStep?.('Parsing Figma URL...');
  const { fileKey, nodeId } = parseFigmaUrl(figmaUrl);

  // Step 2: Fetch from Figma API
  onStep?.(`Fetching from Figma: file=${fileKey}, node=${nodeId ?? 'root'}...`);
  const figmaToken = options.figmaToken || process.env.FIGMA_TOKEN;
  if (!figmaToken) {
    throw new Error(
      'FIGMA_TOKEN environment variable is required.\n' +
      'Generate one at: Figma → Settings → Account → Personal access tokens',
    );
  }

  const client = new FigmaClient(figmaToken);
  const rawData = nodeId
    ? await client.getNode(fileKey, nodeId, options.depth)
    : await client.getFile(fileKey, options.depth);

  // Step 3: Extract complete design data (preserves ALL properties)
  onStep?.('Extracting complete design data...');
  const enhanced = extractCompleteDesign(rawData, allExtractors, {
    maxDepth: options.depth,
    preserveHiddenNodes: config.figma.preserveHiddenNodes,
    includeAbsoluteBounds: true,
    includeRelativeTransform: true,
  });

  // Convert to YAML for diagnostics / LLM
  const yamlContent = dump(enhanced, { lineWidth: 120, noRefs: true });

  // Raw Figma document node — preserves arcData, paddingTop, etc. that
  // extractCompleteDesign strips. Used by PATH C and Recharts codegen for chart detection.
  const rawDocumentNode = nodeId
    ? (rawData as any)?.nodes?.[nodeId]?.document ?? enhanced?.nodes?.[0] ?? enhanced
    : enhanced?.nodes?.[0] ?? enhanced;

  // --- PATH A: Component Set (variant-aware) ---
  // If the default variant is a chart/graph, use Recharts codegen
  // instead of LLM-based generation so it uses Recharts, not raw SVG.
  // For chart COMPONENT_SETs, generate a chart for EACH variant.
  if (isComponentSet(enhanced)) {
    const rawChildren = rawDocumentNode?.children ?? [];
    const rawFirstVariant = rawChildren[0];
    if (rawFirstVariant && isChartSection(rawFirstVariant)) {
      // Derive component name from the COMPONENT_SET name (e.g. "_Activitiy gauge" → "ActivityGaugeChart")
      const setName = rawDocumentNode?.name ?? enhanced?.nodes?.[0]?.name ?? '';

      // Generate a chart for each variant and inline them all into one file.
      // Each variant becomes a named function (not export default) inside the file.
      // A wrapper component renders all variants in a grid.
      const allChartComponents: ChartComponent[] = [];
      const rechartsImportSet = new Set<string>();
      const chartDefinitions: string[] = [];
      const variantNames: string[] = [];
      let primaryComponentName = toPascalCase(setName) + 'Chart';
      let allCss = '';

      for (let vi = 0; vi < rawChildren.length; vi++) {
        const variantNode = rawChildren[vi];
        if (!isChartSection(variantNode)) continue;

        // Build a variant-specific name: "ActivityGauge" + variant props (e.g. "MdTrue")
        const variantLabel = variantNode.name ?? `Variant${vi}`;
        const variantSuffix = variantLabel
          .split(',')
          .map((p: string) => p.trim().split('=').pop()?.trim() ?? '')
          .map((v: string) => toPascalCase(v))
          .join('');
        const variantName = toPascalCase(setName) + variantSuffix;

        const result = await convertChart(variantNode, options, callbacks, variantName);
        const chartCode = result.frameworkOutputs?.react ?? result.mitosisSource ?? '';

        // Extract recharts imports (same pattern as PATH C)
        const rechartsMatch = chartCode.match(
          /import\s*\{([^}]+)\}\s*from\s*['"]recharts['"]/s,
        );
        if (rechartsMatch) {
          rechartsMatch[1].split(',').forEach((s: string) => {
            const name = s.trim();
            if (name) rechartsImportSet.add(name);
          });
        }

        // Strip all import statements and change export default → plain function
        const body = chartCode
          .replace(/import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]\s*;?/g, '')
          .replace(/import\s+['"][^'"]+['"]\s*;?/g, '')
          .replace(/export\s+default\s+function/, 'function')
          .trim();
        chartDefinitions.push(body);
        variantNames.push(result.componentName);

        // Merge CSS
        if (result.css) allCss += (allCss ? '\n\n' : '') + result.css;
        allChartComponents.push(...(result.chartComponents ?? []));
      }

      // Build the wrapper component that renders all variants
      const rechartsImports = rechartsImportSet.size > 0
        ? `import {\n  ${[...rechartsImportSet].join(',\n  ')}\n} from 'recharts';\n`
        : '';

      const variantTags = variantNames
        .map((n) => `        <${n} />`)
        .join('\n');

      const bemBase = toKebabCase(primaryComponentName);
      const wrapperCss =
        `\n.${bemBase}__grid {\n` +
        `  display: flex;\n` +
        `  flex-wrap: wrap;\n` +
        `  gap: 24px;\n` +
        `  align-items: flex-start;\n` +
        `}\n`;

      const reactCode =
        `import { useState, useMemo } from 'react';\n` +
        rechartsImports +
        `import './${primaryComponentName}.css';\n\n` +
        chartDefinitions.join('\n\n') + '\n\n' +
        `export default function ${primaryComponentName}() {\n` +
        `  return (\n` +
        `    <div className="${bemBase}__grid">\n` +
        variantTags + '\n' +
        `    </div>\n` +
        `  );\n` +
        `}\n`;

      const fullCss = allCss + wrapperCss;

      const placeholder = `// ${primaryComponentName} is a Recharts chart — use the React (.jsx) output.\n`;
      const frameworkOutputs: Record<string, string> = {};
      for (const fw of options.frameworks) {
        frameworkOutputs[fw] = fw === 'react' ? reactCode : placeholder;
      }

      return {
        componentName: primaryComponentName,
        mitosisSource: `// Chart component set — generated via Recharts codegen (Recharts codegen).\n${reactCode}`,
        frameworkOutputs: frameworkOutputs as Record<Framework, string>,
        assets: [],
        css: fullCss,
        chartComponents: allChartComponents,
      };
    }
    return convertComponentSet(enhanced, yamlContent, fileKey, client, options, callbacks);
  }

  // --- PATH C: Multi-section page ---
  if (isMultiSectionPage(enhanced)) {
    return convertPage(enhanced, fileKey, client, options, callbacks, rawDocumentNode);
  }

  // --- PATH B: Single Component (LLM → Mitosis → framework generators) ---
  // Charts are now discovered within PATH C's component discovery flow.
  // Standalone chart nodes that aren't part of a multi-section page
  // are handled by PATH B (single component) as a fallback.
  if (isChartSection(rawDocumentNode)) {
    return convertChart(rawDocumentNode, options, callbacks);
  }

  return convertSingleComponent(enhanced, yamlContent, fileKey, client, options, callbacks);
}

/**
 * PATH A: Component Set → LLM (class-based Mitosis) → compile → inject CSS.
 *
 * 1. Parse variant axes and styles from Figma data
 * 2. Export SVG assets for icon nodes stripped by Framelink
 * 3. Generate CSS deterministically from variant data
 * 4. LLM generates a Mitosis component using class={state.classes}
 * 5. Mitosis compiles to all target frameworks
 * 6. Inject the deterministic CSS into each framework output
 */
async function convertComponentSet(
  enhanced: any,
  yamlContent: string,
  fileKey: string,
  client: FigmaClient,
  options: ConvertOptions,
  callbacks?: ConvertCallbacks,
): Promise<ConversionResult> {
  const { onStep, onAttempt, onDebugData } = callbacks ?? {};

  onStep?.('Detected COMPONENT_SET — parsing variants...');

  const componentSetData = parseComponentSet(enhanced);
  if (!componentSetData) {
    throw new Error('Failed to parse COMPONENT_SET variant data.');
  }

  const variantCount = componentSetData.variants.length;
  const axesSummary = componentSetData.axes
    .map((a) => `${a.name}(${a.values.length})`)
    .join(' × ');
  onStep?.(`Found ${variantCount} variants: ${axesSummary}`);

  // Step A1: Collect icon nodes from ALL variants (not just default)
  // This ensures we find all unique SVGs (e.g., spinner in loading state, icons in various states)
  onStep?.('Collecting icons from all variants...');

  // Get the actual variant nodes from the root component set node
  const rootNode = enhanced?.nodes?.[0];
  const variantNodes = rootNode?.children || [];

  // Map variant nodes to their property names
  const variantContexts = collectAssetNodesFromAllVariants(
    variantNodes.map((variantNode: any) => {
      // Parse variant name to match with componentSetData
      const variantName = variantNode.name || 'unknown';
      return {
        node: variantNode,
        variantName,
      };
    })
  );

  // Debug: Log how many contexts and nodes were found
  const totalNodes = variantContexts.reduce((sum, ctx) => sum + ctx.allNodes.length, 0);
  if (variantContexts.length === 0 || totalNodes === 0) {
    onStep?.(`  No icon nodes found in any variant (checked ${componentSetData.variants.length} variants)`);
  } else {
    onStep?.(`  Found ${totalNodes} icon node(s) across ${variantContexts.length} variant(s)`);
  }


  // Export all unique SVGs with deduplication and variant tracking
  onStep?.('Exporting and deduplicating SVG assets...');
  const assets = variantContexts.length > 0
    ? await exportAssetsFromAllVariants(variantContexts, fileKey, client).catch((err) => {
        onStep?.(`  Asset export failed: ${err.message}`);
        return [];
      })
    : [];
  const assetMap = buildAssetMap(assets);
  const dimensionMap = buildDimensionMap(assets);
  if (assets.length > 0) {
    const variantInfo = assets.some(a => a.variants && a.variants.length > 0)
      ? ` (with variant tracking)`
      : '';
    onStep?.(`Exported ${assets.length} SVG asset(s)${variantInfo}: ${assets.map((a) => a.filename).join(', ')}`);

    // Log which icons appear in which variants (helpful for debugging)
    for (const asset of assets) {
      if (asset.variants && asset.variants.length > 0 && asset.variants.length < componentSetData.variants.length) {
        onStep?.(`  - ${asset.filename} appears in ${asset.variants.length}/${componentSetData.variants.length} variants`);
      }
    }
  }

  // Step A2: Generate CSS deterministically from variant data
  onStep?.('Building variant CSS from design tokens...');
  let variantCSS = buildVariantCSS(componentSetData, dimensionMap);

  // For input/textarea: move visual styling from {base}__input → {base}__field
  // so the icon + input sit side-by-side inside the styled field box.
  if (componentSetData.componentCategory === 'input' || componentSetData.componentCategory === 'textarea') {
    variantCSS = fixInputFieldCSS(variantCSS, toKebabCase(componentSetData.name));
  }

  // Step A3: Build specialized prompt for class-based component (asset hints + variant tracking included)
  const promptData = buildVariantPromptData(componentSetData, assetMap, assets);
  const systemPrompt = buildComponentSetSystemPrompt(options.templateMode);
  const defaultVariantYaml = extractDefaultVariantYaml(componentSetData.defaultVariantNode);
  const userPrompt = buildComponentSetUserPrompt(promptData, defaultVariantYaml, componentSetData, variantCSS, options.templateMode);

  // Step A4: LLM generates Mitosis component with class bindings
  const llm = createLLMProvider(options.llm);
  onStep?.(`Generating Mitosis component via ${llm.name} (class-based)...`);
  const expectedTextLiterals = collectExpectedTextsFromComponentSet(componentSetData);
  const parseResult = await generateWithRetry(
    llm, systemPrompt, userPrompt, onAttempt, variantCSS,
    promptData.elementType, promptData.componentCategory, expectedTextLiterals, true,
  );

  onDebugData?.({ yamlContent, rawLLMOutput: parseResult.rawCode });

  if (!parseResult.success || !parseResult.component) {
    throw new Error(
      `Failed to generate valid Mitosis component for variant set.\n` +
      `Last error: ${parseResult.error}\n` +
      `Raw output saved for debugging.`,
    );
  }

  const componentName = options.name ?? promptData.componentName;

  // Step A5: Compile to target frameworks via Mitosis
  onStep?.(`Compiling to: ${options.frameworks.join(', ')}...`);
  const rawFrameworkOutputs = generateFrameworkCode(parseResult.component, options.frameworks);

  // Step A6: Inject variant CSS into each framework output
  onStep?.('Injecting variant CSS...');
  const frameworkOutputs: Record<string, string> = {};
  for (const fw of options.frameworks) {
    const rawCode = rawFrameworkOutputs[fw as Framework];
    if (rawCode && !rawCode.startsWith('// Error')) {
      frameworkOutputs[fw] = injectCSS(rawCode, prependFontImport(variantCSS), fw as Framework);
    } else {
      frameworkOutputs[fw] = rawCode;
    }
  }

  // Build variant metadata for preview app
  const variantMetadata = {
    axes: [
      // Include prop axes (Style, Size, etc.)
      ...componentSetData.propAxes.map((axis) => ({
        name: axis.name,
        values: axis.values,
        default: componentSetData.defaultVariant.props[axis.name] ?? axis.values[0],
      })),
      // Include state axis if it exists
      ...(componentSetData.stateAxis ? [{
        name: componentSetData.stateAxis.name,
        values: componentSetData.stateAxis.values,
        default: componentSetData.defaultVariant.props[componentSetData.stateAxis.name] ?? componentSetData.stateAxis.values[0],
      }] : [])
    ],
    variants: componentSetData.variants.map((v) => ({
      name: componentSetData.axes
        .map((axis) => v.props[axis.name])
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .join(', '),
      props: v.props,
    })),
  };

  const fidelityReport = buildFidelityReport({
    rawCode: parseResult.rawCode,
    css: variantCSS,
    componentCategory: promptData.componentCategory,
    expectedTextLiterals,
    includeLayoutCheck: true,
  });
  if (config.fidelity.requireReportPass && !fidelityReport.overallPassed) {
    throw new Error(
      `Fidelity report failed for component set generation.\n` +
      `${formatFidelityFailures(fidelityReport)}`,
    );
  }

  return {
    componentName,
    mitosisSource: parseResult.rawCode,
    frameworkOutputs: frameworkOutputs as Record<Framework, string>,
    assets,
    componentPropertyDefinitions: componentSetData.componentPropertyDefinitions,
    variantMetadata,
    fidelityReport,
  };
}

// ── PATH B: Semantic HTML detection ──────────────────────────────────────

/**
 * Collects child node names from the enhanced design tree, limited to maxDepth
 * levels. Prevents deep-walking a large page tree and misclassifying it based
 * on deeply-nested component names (e.g. finding "Button" instances inside cards
 * and labelling the whole page as a button component).
 */
function collectChildNames(rootNode: any, maxDepth = 2): string[] {
  if (!rootNode?.children || !Array.isArray(rootNode.children)) return [];
  const names: string[] = [];
  const walk = (node: any, depth: number) => {
    if (node.name) names.push(node.name);
    if (depth < maxDepth && node.children && Array.isArray(node.children)) {
      for (const child of node.children) walk(child, depth + 1);
    }
  };
  for (const child of rootNode.children) walk(child, 1);
  return names;
}

/**
 * Counts total descendants in a node tree.
 */
function countDescendants(node: any): number {
  if (!node?.children || !Array.isArray(node.children)) return 0;
  let count = node.children.length;
  for (const child of node.children) count += countDescendants(child);
  return count;
}

/**
 * Collect expected text literals from PATH A component set data.
 * Used by retry quality-gates to reject generic placeholder copy.
 */
function collectExpectedTextsFromComponentSet(componentSetData: any): string[] {
  const seen = new Set<string>();

  for (const prop of componentSetData?.textContentProperties ?? []) {
    const value = typeof prop?.defaultValue === 'string' ? prop.defaultValue.trim() : '';
    if (value) seen.add(value);
  }

  for (const layer of componentSetData?.childLayers ?? []) {
    if (!layer?.isText) continue;
    const value = typeof layer?.characters === 'string' ? layer.characters.trim() : '';
    if (value) seen.add(value);
  }

  return [...seen];
}

/**
 * Collect expected text literals from a generic design tree (PATH B/C).
 */
function collectExpectedTextsFromNode(rootNode: any): string[] {
  const seen = new Set<string>();

  const walk = (node: any) => {
    if (!node) return;
    const textValue =
      typeof node.characters === 'string' ? node.characters.trim()
      : typeof node.text === 'string' ? node.text.trim()
      : '';
    if (textValue) seen.add(textValue);

    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  };

  walk(rootNode);
  return [...seen];
}

function formatFidelityFailures(report: any): string {
  const failed: string[] = [];
  for (const [name, check] of Object.entries(report?.checks ?? {})) {
    if (check && typeof check === 'object' && (check as any).passed === false) {
      const summary = typeof (check as any).summary === 'string' ? (check as any).summary : '';
      failed.push(`[${name}] ${summary || 'failed'}`);
    }
  }
  return failed.join('\n\n');
}

/**
 * Detects component category from the root node name and child names,
 * then builds a semantic HTML hint string for the LLM user prompt.
 * Returns null if category is 'unknown'.
 *
 * Skips child-name-based heuristics for large trees (>20 descendants)
 * to avoid misclassifying page-level layout frames as specific component
 * types (e.g. labelling a card grid page as "button" because it contains
 * button instances deep inside).
 */
function buildSemanticHint(rootNode: any): string | null {
  const name = rootNode?.name ?? '';

  // Try name-based detection first
  let category: ComponentCategory = detectComponentCategory(name);

  // Only scan child names for small trees — large trees are likely page layouts,
  // not individual components, so child-name heuristics would misfire.
  if (category === 'unknown') {
    const descendantCount = countDescendants(rootNode);
    if (descendantCount <= 20) {
      const childNames = collectChildNames(rootNode);
      if (childNames.length > 0) {
        const lower = childNames.map((n) => n.toLowerCase());
        const childHints: Array<[RegExp, ComponentCategory]> = [
          [/checkbox|check[-\s]?box|check[-\s]?mark/, 'checkbox'],
          [/radio|radio[-\s]?button/, 'radio'],
          [/toggle|switch|thumb|track/, 'toggle'],
          [/\binput\b|text[-\s]?field/, 'input'],
          [/\bslider\b|range/, 'slider'],
          [/\bnav\b|navigation/, 'navigation'],
          [/\bbutton\b|\bbtn\b/, 'button'],
        ];
        for (const [pattern, cat] of childHints) {
          if (lower.some((c) => pattern.test(c))) {
            category = cat;
            break;
          }
        }
      }
    }
  }

  // Category-specific guidance — used for both root and nested hints
  const guidance: Partial<Record<ComponentCategory, string>> = {
    'button': 'Use `<button type="button">`. Include `<span>` for label text. Add `disabled` attribute support.',
    'icon-button': 'Use `<button type="button">` with `aria-label`. Place icon inside `<span>`.',
    'input': 'Wrapper `<div>` is OK, but MUST contain a real `<input>` element — never a contenteditable div.',
    'textarea': 'Wrapper `<div>` is OK, but MUST contain a real `<textarea>` element.',
    'select': 'Wrapper `<div>` is OK, but MUST contain a real `<select>` element.',
    'checkbox': 'MUST be `<label>` wrapping `<input type="checkbox">` + visual `<span>` for the box.',
    'radio': 'MUST be `<label>` wrapping `<input type="radio">` + visual `<span>` for the circle.',
    'toggle': 'Use `<button role="switch">`. Include track `<span>` and thumb `<span>`.',
    'switch': 'Use `<button role="switch">`. Include track `<span>` and thumb `<span>`.',
    'link': 'Use `<a href="...">` — never a `<div>` or `<button>`.',
    'navigation': 'Use `<nav>`. Wrap links in `<ul>` > `<li>` > `<a>` structure.',
    'card': 'Use `<article>`. Use semantic children: `<h2>`/`<h3>` for title, `<p>` for description.',
    'dialog': 'Use `<dialog>`.',
    'tab': 'Use `<button role="tab">` with `aria-selected` attribute.',
    'menu': 'Use `<ul role="menu">` with `<li role="menuitem">` children.',
    'menu-item': 'Use `<li role="menuitem">`.',
    'header': 'Use `<header>`.',
    'footer': 'Use `<footer>`.',
    'sidebar': 'Use `<aside>`.',
    'badge': 'Use `<span>` — keep it simple.',
    'chip': 'Use `<button>` — NOT `<div>`. Include label `<span>` and optional remove icon.',
    'slider': 'Wrapper `<div>` MUST contain `<input type="range">` — never a custom slider div.',
    'accordion': 'Use `<details>` / `<summary>` or `<div>` with `aria-expanded` toggle.',
    'breadcrumb': 'Use `<nav aria-label="breadcrumb">` with `<ol>` > `<li>` > `<a>` structure.',
    'divider': 'Use `<hr>` — no extra divs.',
    'list': 'Use `<ul>` or `<ol>` with `<li>` children.',
    'list-item': 'Use `<li>`.',
    'table': 'Use `<table>` with `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>`.',
  };

  // Build root hint (if category known)
  let hint = '';
  if (category !== 'unknown') {
    const htmlTag = CATEGORY_HTML_TAGS[category] ?? 'div';
    const ariaRole = CATEGORY_ARIA_ROLES[category] ?? '';
    hint += `## Semantic HTML Hint\n`;
    hint += `Detected component category: **${category}**\n`;
    hint += `Root element: \`<${htmlTag}>\``;
    if (ariaRole) hint += ` with \`role="${ariaRole}"\``;
    hint += `\n`;
    if (guidance[category]) {
      hint += `\n**Required structure:** ${guidance[category]}`;
    }
  }

  // Scan for nested component instances and add hints for each —
  // this works even when the root category is 'unknown' (large layout trees).
  const nestedHints = collectNestedSemanticHints(rootNode, guidance);
  if (nestedHints) {
    hint += nestedHints;
  }

  return hint || null;
}

/**
 * Recursively scans a Figma node tree for child nodes whose names match
 * known component categories (chip, checkbox, radio, search, button, etc.).
 * Returns a prompt section with semantic HTML guidance for each.
 *
 * This is the PATH B equivalent of PATH A's nested instance blueprints.
 * Works generically for any component — no per-component special-casing.
 */
function collectNestedSemanticHints(
  rootNode: any,
  guidance: Partial<Record<ComponentCategory, string>>,
): string | null {
  const seen = new Set<ComponentCategory>();
  const hints: string[] = [];

  function walk(node: any) {
    if (!node?.children) return;
    for (const child of node.children) {
      if (!child?.name) continue;
      const cat = detectComponentCategory(child.name);
      if (cat !== 'unknown' && !seen.has(cat)) {
        seen.add(cat);
        const tag = CATEGORY_HTML_TAGS[cat] ?? 'div';
        let line = `- **"${child.name}"** → \`<${tag}>\``;
        if (guidance[cat]) line += ` — ${guidance[cat]}`;
        hints.push(line);
      }
      walk(child);
    }
  }
  walk(rootNode);

  if (hints.length === 0) return null;
  return `\n\n## Nested Component HTML Rules\n` +
    `The design contains these nested components. You MUST use semantic HTML for each — do NOT render as \`<div>\` or \`<span>\`:\n` +
    hints.join('\n');
}

/**
 * PATH B: Single Component → LLM → Mitosis → framework generators.
 */
async function convertSingleComponent(
  enhanced: any,
  yamlContent: string,
  fileKey: string,
  client: FigmaClient,
  options: ConvertOptions,
  callbacks?: ConvertCallbacks,
): Promise<ConversionResult> {
  const { onStep, onAttempt, onDebugData } = callbacks ?? {};

  // Export SVG assets for any icon nodes stripped by Framelink
  onStep?.('Exporting SVG assets...');
  const iconNodes = collectAssetNodes(enhanced?.nodes?.[0]);
  const assets = iconNodes.length > 0
    ? await exportAssets(iconNodes, fileKey, client).catch(() => [])
    : [];
  if (assets.length > 0) {
    onStep?.(`Exported ${assets.length} SVG asset(s): ${assets.map((a) => a.filename).join(', ')}`);
  }

  // Detect semantic category for better HTML output
  const rootNode = enhanced?.nodes?.[0];
  const semanticHint = rootNode ? buildSemanticHint(rootNode) : null;
  const hintedCategory = semanticHint
    ? (semanticHint.match(/category: \*\*(.+?)\*\*/)?.[1] as ComponentCategory | undefined)
    : undefined;
  if (semanticHint) {
    const category = hintedCategory ?? 'unknown';
    onStep?.(`Detected component category: ${category}`);
  }

  // Assemble prompts
  onStep?.('Assembling prompts...');
  const systemPrompt = assembleSystemPrompt(options.templateMode);
  // Build asset map so serialization can annotate icon nodes with their SVG filenames.
  // This embeds `type: ICON, assetFile: "./assets/foo.svg"` directly in the YAML,
  // giving the LLM clear context to generate <img> tags at the right positions.
  const pathBAssetMap = buildAssetMap(assets);
  // Serialize root node to CSS-ready YAML so the LLM receives colors as CSS strings
  // (hex / rgba) rather than raw Figma Paint objects with 0-1 component values.
  const cssReadyNode = rootNode ? serializeNodeForPrompt(rootNode, 0, pathBAssetMap) : null;
  const llmYaml = cssReadyNode
    ? dump(cssReadyNode, { lineWidth: 120, noRefs: true })
    : dump(rootNode ? serializeNodeForPrompt(rootNode, 0, pathBAssetMap) : enhanced, { lineWidth: 120, noRefs: true });
  const assetHints = buildPathBAssetHints(assets, rootNode);
  const userPrompt = assembleUserPrompt(llmYaml, options.name, semanticHint ?? undefined, options.templateMode, assetHints);

  // Generate Mitosis code via LLM with retry
  const llm = createLLMProvider(options.llm);
  onStep?.(`Generating Mitosis code via ${llm.name}...`);

  // Extract category + expected tag for semantic validation.
  // Only apply semantic enforcement for actual components (small trees).
  // Large layout frames (>20 descendants) should not get root-tag auto-fix
  // or semantic validation — they're page layouts, not individual components.
  const descendantCount = rootNode ? countDescendants(rootNode) : 0;
  const pathBCategory = descendantCount <= 20
    ? (hintedCategory ?? detectComponentCategory(rootNode?.name ?? ''))
    : 'unknown' as ComponentCategory;
  const pathBExpectedTag = pathBCategory !== 'unknown'
    ? CATEGORY_HTML_TAGS[pathBCategory] : undefined;
  const expectedTextLiterals = rootNode ? collectExpectedTextsFromNode(rootNode) : [];

  const parseResult = await generateWithRetry(
    llm, systemPrompt, userPrompt, onAttempt, undefined,
    pathBExpectedTag, pathBCategory !== 'unknown' ? pathBCategory : undefined, expectedTextLiterals,
    undefined, llmYaml,
  );

  onDebugData?.({ yamlContent, rawLLMOutput: parseResult.rawCode });

  if (!parseResult.success || !parseResult.component) {
    throw new Error(
      `Failed to generate valid Mitosis code after retries.\n` +
      `Last error: ${parseResult.error}\n` +
      `Raw output saved for debugging.`,
    );
  }

  const componentName = options.name ?? parseResult.component.name ?? 'Component';

  // Compile to target frameworks
  onStep?.(`Compiling to: ${options.frameworks.join(', ')}...`);
  const frameworkOutputs = generateFrameworkCode(parseResult.component, options.frameworks);

  // Inject extracted CSS into each framework output (same as PATH A)
  if (parseResult.css) {
    for (const fw of options.frameworks) {
      if (frameworkOutputs[fw]) {
        frameworkOutputs[fw] = injectCSS(frameworkOutputs[fw], prependFontImport(parseResult.css), fw);
      }
    }
  }

  const fidelityReport = buildFidelityReport({
    rawCode: parseResult.rawCode,
    css: parseResult.css,
    componentCategory: pathBCategory !== 'unknown' ? pathBCategory : undefined,
    expectedTextLiterals,
    includeLayoutCheck: false,
  });
  if (config.fidelity.requireReportPass && !fidelityReport.overallPassed) {
    throw new Error(
      `Fidelity report failed for single component generation.\n` +
      `${formatFidelityFailures(fidelityReport)}`,
    );
  }

  return {
    componentName,
    mitosisSource: parseResult.rawCode,
    frameworkOutputs: frameworkOutputs as Record<Framework, string>,
    assets,
    fidelityReport,
  };
}

// ── PATH C: Multi-section page ──────────────────────────────────────────

/**
 * Build a mini CompleteFigmaDesign wrapping a single child section.
 * Preserves parent-level metadata (globalVars, components, styles) while
 * substituting the nodes array with just the one child.
 */
function buildSectionDesign(parentDesign: any, child: any): any {
  return {
    ...parentDesign,
    nodes: [child],
  };
}

/**
 * Convert a Figma node name to PascalCase for use as a component name.
 */
function toPascalCase(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s-_]/g, '')
    .split(/[\s\-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

/**
 * Recharts codegen: Chart node → Recharts codegen (no LLM).
 *
 * When the user points directly at a chart/graph Figma node, skip the LLM
 * entirely and generate a Recharts component deterministically from the tree.
 *
 * The generated React file IS the primary output; other frameworks get a
 * placeholder comment directing devs to use the React version with Recharts.
 */
async function convertChart(
  rawNode: any,
  options: ConvertOptions,
  callbacks?: ConvertCallbacks,
  overrideName?: string,
): Promise<ConversionResult> {
  const { onStep } = callbacks ?? {};

  const llm = createLLMProvider(options.llm);
  onStep?.('Detected chart node → extracting chart metadata...');

  const meta = await extractChartMetadata(rawNode, llm);
  const componentName = overrideName
    ? toPascalCase(overrideName) + (overrideName.toLowerCase().endsWith('chart') ? '' : 'Chart')
    : options.name
      ? toPascalCase(options.name) + (options.name.toLowerCase().endsWith('chart') ? '' : 'Chart')
      : meta.componentName;

  const metaWithName = { ...meta, componentName, bemBase: toKebabCase(componentName) };
  const { reactCode, css } = generateChartCode(metaWithName);

  onStep?.(`Chart component "${componentName}" generated (${meta.chartType}, ${meta.dataPointCount} data points).`);

  const placeholder = (fw: string) =>
    `// ${componentName} is a Recharts chart — use the React (.jsx) output.\n` +
    `// Install recharts: npm install recharts\n` +
    `// Framework: ${fw} — port the React implementation to your framework.\n`;

  const frameworkOutputs: Record<string, string> = {};
  for (const fw of options.frameworks) {
    frameworkOutputs[fw] = fw === 'react' ? reactCode : placeholder(fw);
  }

  return {
    componentName,
    mitosisSource: `// Chart component — generated via Recharts codegen (Recharts codegen), bypasses Mitosis.\n${reactCode}`,
    frameworkOutputs: frameworkOutputs as Record<Framework, string>,
    assets: [],
    css,
    chartComponents: [{ name: componentName, reactCode, css }],
  };
}

/**
 * Flatten "wrapper frames" — plain container FRAMEs with no visual identity
 * whose children are all wide layout sections. These are layout-only wrappers
 * that should be unwrapped so each inner section gets its own LLM call.
 *
 * E.g.: root → [header, breadcrumbs, content-wrapper]
 *   where content-wrapper has no fills/border and contains [card1, card2, card3]
 *   → flattened: [header, breadcrumbs, card1, card2, card3]
 */
function flattenWrapperFrames(children: any[], parentWidth: number): any[] {
  const result: any[] = [];
  for (const child of children) {
    if (child.type !== 'FRAME' || !child.children || child.children.length < 2) {
      result.push(child);
      continue;
    }
    // Check if this frame is a "plain wrapper" — no visual properties
    const hasFills = Array.isArray(child.fills)
      && child.fills.some((f: any) => f.visible !== false && f.type === 'SOLID' && f.color);
    const hasStrokes = Array.isArray(child.strokes) && child.strokes.length > 0;
    const hasBorderRadius = (child.cornerRadius ?? 0) > 0;
    const hasShadows = Array.isArray(child.effects)
      && child.effects.some((e: any) => e.visible !== false && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'));
    if (hasFills || hasStrokes || hasBorderRadius || hasShadows) {
      result.push(child);
      continue;
    }
    // Check if children are wide (≥80% of this frame's width)
    const frameWidth = child.absoluteBoundingBox?.width ?? child.dimensions?.width ?? child.size?.x ?? parentWidth;
    let wideCount = 0;
    for (const gc of child.children) {
      if (gc.type !== 'FRAME' && gc.type !== 'COMPONENT' && gc.type !== 'INSTANCE') continue;
      const gcw = gc.absoluteBoundingBox?.width ?? gc.dimensions?.width ?? gc.size?.x ?? 0;
      if (frameWidth > 0 && gcw >= frameWidth * 0.8) wideCount++;
    }
    if (wideCount >= 2) {
      // Unwrap: use this frame's children directly
      result.push(...child.children);
    } else {
      result.push(child);
    }
  }
  return result;
}

/**
 * PATH C: Multi-section page → per-section LLM calls → stitch → compile.
 *
 * 1. Extract deterministic page layout CSS from Figma auto-layout data
 * 2. For each child section: build section-specific prompt → LLM → collect raw output
 * 3. Stitch all section JSX + CSS into one Mitosis page component
 * 4. Parse + compile the stitched component through Mitosis
 * 5. Inject merged CSS into each framework output
 */
async function convertPage(
  enhanced: any,
  fileKey: string,
  client: FigmaClient,
  options: ConvertOptions,
  callbacks?: ConvertCallbacks,
  rawDocumentNode?: any,
): Promise<ConversionResult> {
  const { onStep, onAttempt } = callbacks ?? {};
  const rootNode = enhanced.nodes[0];
  let children: any[] = rootNode.children || [];
  // Raw Figma children for chart detection (preserves arcData, padding, etc.)
  const rawChildren: any[] = rawDocumentNode?.children ?? children;

  // Flatten wrapper frames: when a direct child is a plain container frame
  // (no fills, no border — purely layout) with ≥2 wide children, "unwrap" it
  // and use its children as direct sections. This handles patterns like:
  //   root → [header, breadcrumbs, content-wrapper]
  //   where content-wrapper holds the actual form cards/sections.
  const parentWidth =
    rootNode.absoluteBoundingBox?.width ?? rootNode.dimensions?.width ?? rootNode.size?.x ?? 0;
  children = flattenWrapperFrames(children, parentWidth);

  // Step C1: Extract page layout CSS
  onStep?.('Detected multi-section page — extracting layout...');
  const layoutResult = extractPageLayoutCSS(rootNode, children);
  const { sections, pageBaseClass } = layoutResult;
  const pageName = toPascalCase(rootNode.name || 'Page');

  onStep?.(`Page "${pageName}" with ${sections.length} sections: ${sections.map((s) => s.displayName ?? s.name).join(', ')}`);

  // Step C2: Generate all sections via LLM (in parallel for speed)
  const llm = createLLMProvider(options.llm);
  const sectionSystemPrompt = assemblePageSectionSystemPrompt(options.templateMode);
  const allAssets: AssetEntry[] = [];
  const allChartComponents: ChartComponent[] = [];
  const usedChartNames = new Set<string>();

  // Compute page-level context once — passed to every section prompt so the
  // LLM knows the canvas width, section gap, page padding, and neighbor names.
  const _rootFill = (rootNode.fills ?? [])[0];
  const pageBackground = _rootFill?.type === 'SOLID' && _rootFill.color
    ? figmaColorToCSS(_rootFill.color, _rootFill.opacity)
    : undefined;
  const basePageCtx: Omit<PageSectionContext, 'prevSectionName' | 'nextSectionName'> = {
    pageWidth:
      rootNode.absoluteBoundingBox?.width ??
      rootNode.dimensions?.width ??
      rootNode.size?.x ??
      undefined,
    sectionGap: rootNode.itemSpacing ?? rootNode.layout?.gap ?? 0,
    pagePadding: {
      top: rootNode.paddingTop ?? rootNode.layout?.padding?.top ?? 0,
      right: rootNode.paddingRight ?? rootNode.layout?.padding?.right ?? 0,
      bottom: rootNode.paddingBottom ?? rootNode.layout?.padding?.bottom ?? 0,
      left: rootNode.paddingLeft ?? rootNode.layout?.padding?.left ?? 0,
    },
    pageBackground,
  };

  // Build a list of visible children to match the sections array (which also skips hidden)
  const visibleChildren: Array<{ child: any; rawChild: any }> = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.visible === false) continue;
    visibleChildren.push({ child, rawChild: rawChildren[i] ?? child });
  }

  // Generate all sections in parallel — each section is independent
  const sectionPromises = visibleChildren.map(async ({ child, rawChild }, i) => {
    const sectionInfo = sections[i];
    if (!sectionInfo) return null;
    const sectionDisplayName = sectionInfo.displayName ?? sectionInfo.name;

    onStep?.(`[${i + 1}/${visibleChildren.length}] Generating section "${sectionDisplayName}"...`);

    try {
      // Check if section is a COMPONENT_SET (use PATH A prompt chain)
      if (child.type === 'COMPONENT_SET') {
        const sectionDesign = buildSectionDesign(enhanced, child);
        const componentSetData = parseComponentSet(sectionDesign);
        if (!componentSetData) throw new Error('Failed to parse COMPONENT_SET');

        const variantNodes = child.children || [];
        const variantContexts = collectAssetNodesFromAllVariants(
          variantNodes.map((vn: any) => ({ node: vn, variantName: vn.name || 'unknown' }))
        );
        const totalNodes = variantContexts.reduce((sum: number, ctx: any) => sum + ctx.allNodes.length, 0);
        const assets = totalNodes > 0
          ? await exportAssetsFromAllVariants(variantContexts, fileKey, client).catch(() => [])
          : [];
        const assetMap = buildAssetMap(assets);
        const dimensionMap = buildDimensionMap(assets);
        let variantCSS = buildVariantCSS(componentSetData, dimensionMap);
        if (componentSetData.componentCategory === 'input' || componentSetData.componentCategory === 'textarea') {
          variantCSS = fixInputFieldCSS(variantCSS, toKebabCase(componentSetData.name));
        }
        const promptData = buildVariantPromptData(componentSetData, assetMap, assets);
        const defaultVariantYaml = extractDefaultVariantYaml(componentSetData.defaultVariantNode);
        const userPrompt = buildComponentSetUserPrompt(promptData, defaultVariantYaml, componentSetData, variantCSS, options.templateMode);
        const systemPrompt = buildComponentSetSystemPrompt(options.templateMode);

        const parseResult = await generateWithRetry(
          llm, systemPrompt, userPrompt, onAttempt, variantCSS,
          promptData.elementType, promptData.componentCategory,
          collectExpectedTextsFromComponentSet(componentSetData),
          true,
        );
        return {
          output: {
            info: sectionInfo,
            rawCode: parseResult.rawCode,
            css: variantCSS,
            failed: !parseResult.success,
          } as SectionOutput,
          assets,
        };
      } else {
        // Regular section: use hierarchical component-first generation.
        // PATH 2 discovers UI components (dropdowns, inputs, buttons),
        // generates each via PATH 1, then assembles the section layout.

        // Export any SVG assets from this section
        const iconNodes = collectAssetNodes(child);
        const sectionAssets = iconNodes.length > 0
          ? await exportAssets(iconNodes, fileKey, client).catch((err) => {
              console.warn(`[exportAssets] Failed for section "${sectionInfo.name}": ${err instanceof Error ? err.message : err}`);
              return [] as AssetEntry[];
            })
          : [];

        const hSizing = child.layoutSizing?.horizontal ?? child.layoutSizingHorizontal;
        const vSizing = child.layoutSizing?.vertical ?? child.layoutSizingVertical;
        const sectionCtx: PageSectionContext = {
          ...basePageCtx,
          prevSectionName: i > 0 ? (sections[i - 1]?.name ?? null) : null,
          nextSectionName: i < sections.length - 1 ? (sections[i + 1]?.name ?? null) : null,
          sectionWidth: child.absoluteBoundingBox?.width ?? child.dimensions?.width ?? child.size?.x ?? undefined,
          sectionHeight: child.absoluteBoundingBox?.height ?? child.dimensions?.height ?? child.size?.y ?? undefined,
          sectionPositioning: child.layoutPositioning === 'ABSOLUTE' ? 'absolute' : 'flex',
          sectionWidthMode: hSizing === 'FILL' ? 'fill' : hSizing === 'HUG' ? 'hug' : 'fixed',
          sectionHeightMode: vSizing === 'FILL' ? 'fill' : vSizing === 'HUG' ? 'hug' : 'fixed',
          pageLayoutDirection: rootNode.layoutMode === 'HORIZONTAL' ? 'row'
            : rootNode.layoutMode === 'VERTICAL' ? 'column' : 'none',
        };

        // Build asset map so serialization annotates icon nodes with SVG filenames.
        // Creates an asset-aware serializer that embeds `type: ICON, assetFile` directly
        // in the YAML, giving the LLM structural context to place <img> tags.
        const sectionAssetMap = buildAssetMap(sectionAssets);
        const assetAwareSerializer = (node: any) => serializeNodeForPrompt(node, 0, sectionAssetMap);

        // Also keep text-based hints as supplementary guidance
        const sectionAssetHints = buildPathBAssetHints(sectionAssets, child);

        const compoundResult = await generateCompoundSection(
          child,
          sectionInfo.name,
          i + 1,
          children.length,
          assetAwareSerializer,
          llm,
          sectionCtx,
          onStep,
          onAttempt,
          options.templateMode,
          rawChild,
          usedChartNames,
          sectionAssetHints,
        );

        // Store chart components directly on the section output for reliable mapping.
        // (allChartComponents will be rebuilt from sections after dedup.)
        const sectionCharts = compoundResult.chartComponents.length > 0
          ? compoundResult.chartComponents : undefined;

        // If section root itself is a chart (discovered at depth 0 with no UI components),
        // treat it as chart-only — bypass the LLM's PATH 2 output (which may hallucinate
        // duplicate placeholders) and let stitch emit a single clean placeholder.
        const isChartOnlySection = compoundResult.chartComponents.length === 1
          && compoundResult.discovery.components.length === 1
          && compoundResult.discovery.components[0].formRole === 'chart';

        if (isChartOnlySection) {
          return {
            output: {
              info: sectionInfo,
              rawCode: '',
              css: '',
              failed: false,
              isChart: true,
              chartComponentName: compoundResult.chartComponents[0].name,
              sectionChartComponents: sectionCharts,
            } as SectionOutput,
            assets: sectionAssets,
          };
        } else {
          return {
            output: {
              info: sectionInfo,
              rawCode: compoundResult.rawCode,
              css: compoundResult.css,
              failed: !compoundResult.success,
              sectionChartComponents: sectionCharts,
            } as SectionOutput,
            assets: sectionAssets,
          };
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onStep?.(`  Section "${sectionDisplayName}" failed: ${msg}`);
      return {
        output: {
          info: sectionInfo,
          rawCode: '',
          css: '',
          failed: true,
        } as SectionOutput,
        assets: [] as AssetEntry[],
      };
    }
  });

  const sectionResults = await Promise.all(sectionPromises);

  // Collect outputs in order (matching original section indices)
  const sectionOutputs: SectionOutput[] = [];
  for (const result of sectionResults) {
    if (!result) continue;
    sectionOutputs.push(result.output);
    allAssets.push(...result.assets);
  }

  // Post-parallel chart name deduplication.
  // Sections ran in parallel so multiple sections may have generated charts with
  // the same name (e.g. all named "WidgetChart"). The shared allChartComponents
  // array has unpredictable ordering relative to sectionOutputs.
  //
  // Strategy: iterate sectionOutputs (which IS in order), dedup chart names,
  // rename charts and section references, then rebuild allChartComponents.
  allChartComponents.length = 0; // clear — will rebuild from sections
  const finalChartNames = new Set<string>();

  for (const section of sectionOutputs) {
    const charts = section.sectionChartComponents;
    if (!charts || charts.length === 0) continue;

    for (const chart of charts) {
      const oldName = chart.name;

      if (!finalChartNames.has(oldName)) {
        // Name is unique — keep as-is
        finalChartNames.add(oldName);
      } else {
        // Duplicate — pick unique name
        let suffix = 2;
        while (finalChartNames.has(`${oldName}${suffix}`)) suffix++;
        const newName = `${oldName}${suffix}`;

        // Rename in chart's generated code and CSS
        chart.reactCode = chart.reactCode.replace(new RegExp(oldName, 'g'), newName);
        const oldBem = oldName.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9-]/g, '');
        const newBem = newName.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9-]/g, '');
        chart.css = chart.css.replace(new RegExp(oldBem, 'g'), newBem);

        // Update section's chartComponentName (for chart-only sections used by stitch.ts)
        if (section.chartComponentName === oldName) {
          section.chartComponentName = newName;
        }
        // Update rawCode placeholder (for mixed sections)
        if (section.rawCode && section.rawCode.includes(`chart-section-${oldName}`)) {
          section.rawCode = section.rawCode.replace(
            new RegExp(`chart-section-${oldName}`, 'g'),
            `chart-section-${newName}`,
          );
        }

        chart.name = newName;
        finalChartNames.add(newName);
      }

      allChartComponents.push(chart);
    }
  }

  const successCount = sectionOutputs.filter((s) => !s.failed).length;
  onStep?.(`Generated ${successCount}/${sections.length} sections successfully.`);

  // Step C3: Stitch into one page component
  onStep?.('Stitching sections into page component...');
  let { mitosisSource, mergedCSS } = stitchPageComponent(
    pageName,
    pageBaseClass,
    layoutResult.css,
    sectionOutputs,
  );

  // Step C4: Parse the stitched component through Mitosis
  onStep?.('Parsing stitched page component...');
  const pageParseResult = parseMitosisCode(mitosisSource);
  if (!pageParseResult.success || !pageParseResult.component) {
    throw new Error(
      `Failed to parse stitched page component.\n` +
      `Error: ${pageParseResult.error}\n` +
      `Source:\n${mitosisSource.substring(0, 500)}...`,
    );
  }

  // Step C5: Compile to target frameworks
  const componentName = options.name ?? pageName;
  onStep?.(`Compiling page to: ${options.frameworks.join(', ')}...`);
  const rawFrameworkOutputs = generateFrameworkCode(pageParseResult.component, options.frameworks);

  // Step C6: Inject merged CSS into each framework output
  onStep?.('Injecting page CSS...');
  const frameworkOutputs: Record<string, string> = {};
  const hasCharts = allChartComponents.length > 0;
  for (const fw of options.frameworks) {
    let rawCode = rawFrameworkOutputs[fw as Framework];
    if (rawCode && !rawCode.startsWith('// Error')) {
      // Sanitize HTML-style attributes (class→className, style string→object) that
      // survive Mitosis compilation and would cause React runtime errors.
      if (fw === 'react') rawCode = sanitizeJSXAttributes(rawCode);

      // For React: inline chart component code + CSS directly into the main file
      // (no separate import — avoids WebContainer/preview dependency issues)
      if (fw === 'react' && hasCharts) {
        const rechartsImportSet = new Set<string>();
        const chartDefinitions: string[] = [];

        for (const chart of allChartComponents) {
          const { name, reactCode, css: chartCss } = chart;

          // Replace placeholder with the chart component tag
          const placeholderRe = new RegExp(
            `<div\\s+className="chart-section-${name}"\\s*/>`,
            'g',
          );
          rawCode = rawCode.replace(placeholderRe, `<${name} />`);

          // Extract recharts imports from the chart code (handles multi-line imports)
          const rechartsMatch = reactCode.match(
            /import\s*\{([^}]+)\}\s*from\s*['"]recharts['"]/s,
          );
          if (rechartsMatch) {
            rechartsMatch[1].split(',').forEach((s: string) => {
              const name = s.trim();
              if (name) rechartsImportSet.add(name);
            });
          }

          // Strip all import statements (including multi-line imports like
          // `import {\n  LineChart,\n  ...\n} from 'recharts';`)
          // and CSS side-effect imports (`import './Foo.css';`).
          const body = reactCode
            .replace(/import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]\s*;?/g, '')
            .replace(/import\s+['"][^'"]+['"]\s*;?/g, '')
            .replace(/export\s+default\s+function/, 'function')
            .trim();
          chartDefinitions.push(body);

          // Merge chart CSS into page CSS
          if (chartCss) {
            mergedCSS += '\n' + chartCss;
          }
        }

        // Add recharts import + { useState, useMemo } at the top
        const rechartsImports =
          rechartsImportSet.size > 0
            ? `import { ${[...rechartsImportSet].join(', ')} } from 'recharts';\n`
            : '';
        const hooksImport = `import { useState, useMemo } from 'react';\n`;

        // Strip existing React imports from rawCode to avoid duplicates
        // (Mitosis may have emitted `import * as React from "react"` or named imports)
        rawCode = rawCode
          .replace(/import\s+\*\s+as\s+React\s+from\s+['"]react['"]\s*;?\n?/g, '')
          .replace(/import\s*\{[^}]*\}\s*from\s*['"]react['"]\s*;?\n?/g, '');

        // Prepend: hooks import, recharts import, then chart definitions, then main code
        rawCode =
          hooksImport +
          rechartsImports +
          '\n' +
          chartDefinitions.join('\n\n') +
          '\n\n' +
          rawCode;
      }

      frameworkOutputs[fw] = injectCSS(rawCode, prependFontImport(mergedCSS), fw as Framework);
    } else {
      frameworkOutputs[fw] = rawCode;
    }
  }

  // Deduplicate assets by nodeId
  const seenNodeIds = new Set<string>();
  const dedupedAssets = allAssets.filter((a) => {
    if (seenNodeIds.has(a.nodeId)) return false;
    seenNodeIds.add(a.nodeId);
    return true;
  });

  const fidelityReport = buildFidelityReport({
    rawCode: mitosisSource,
    css: mergedCSS,
    expectedTextLiterals: collectExpectedTextsFromNode(rootNode),
    includeLayoutCheck: false,
  });
  if (config.fidelity.requireReportPass && !fidelityReport.overallPassed) {
    throw new Error(
      `Fidelity report failed for page generation.\n` +
      `${formatFidelityFailures(fidelityReport)}`,
    );
  }

  return {
    componentName,
    mitosisSource,
    frameworkOutputs: frameworkOutputs as Record<Framework, string>,
    assets: dedupedAssets,
    css: mergedCSS,
    fidelityReport,
    chartComponents: allChartComponents.length > 0 ? allChartComponents : undefined,
  };
}
