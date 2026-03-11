/**
 * Deterministic page layout CSS extracted from Figma auto-layout data.
 *
 * Reads layoutMode, itemSpacing, padding, fills, sizing from the root node
 * and its children. Outputs BEM CSS for the page wrapper and section slots.
 */

export interface SectionInfo {
  /** Kebab-case BEM element name, e.g. "hero" */
  name: string;
  /** BEM class name, e.g. "landing-page__hero" */
  baseClass: string;
  /** Inferred HTML tag */
  semanticTag: 'header' | 'footer' | 'nav' | 'main' | 'section';
  /** Descriptive display name resolved from heading text (when frame name is generic) */
  displayName?: string;
}

export interface PageLayoutResult {
  /** Generated CSS for the page wrapper + section slots */
  css: string;
  /** Ordered list of section info */
  sections: SectionInfo[];
  /** Kebab-case page base class, e.g. "landing-page" */
  pageBaseClass: string;
}

/**
 * Infer a semantic HTML tag from a Figma section name.
 */
function inferSemanticTag(name: string, index?: number, totalChildren?: number): SectionInfo['semanticTag'] {
  const lower = name.toLowerCase();
  if (/^(header|nav(bar|igation)?|top[-_ ]?bar|app[-_ ]?bar)$/i.test(lower) || lower.startsWith('header') || lower.startsWith('nav')) {
    return 'header';
  }
  if (/^footer/i.test(lower) || lower === 'footer') {
    return 'footer';
  }
  if (/^nav/i.test(lower)) {
    return 'nav';
  }
  // Position-based fallback: first child → header, last child → footer
  if (index !== undefined && totalChildren !== undefined) {
    if (index === 0) return 'header';
    if (index === totalChildren - 1) return 'footer';
  }
  return 'section';
}

/**
 * Convert a Figma node name to a kebab-case CSS class segment.
 */
function toKebab(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s-_]/g, '')       // strip unsafe chars
    .replace(/([a-z])([A-Z])/g, '$1-$2')     // camelCase → kebab
    .replace(/[\s_]+/g, '-')                  // spaces/underscores → hyphens
    .replace(/-+/g, '-')                      // collapse multiple hyphens
    .replace(/^-|-$/g, '')                    // trim leading/trailing hyphens
    .toLowerCase();
}

/**
 * Extract a background-color CSS declaration from Figma fills.
 */
function extractBackground(node: any): string {
  const fills = node.fills ?? node.background;
  if (!fills) return '';
  // fills can be a string (style reference) or array
  if (typeof fills === 'string') return '';
  if (!Array.isArray(fills) || fills.length === 0) return '';
  const fill = fills[0];
  if (!fill || fill.visible === false) return '';

  if (fill.type === 'SOLID' && fill.color) {
    const { r, g, b } = fill.color;
    const a = fill.opacity ?? fill.color.a ?? 1;
    const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
    if (a < 1) {
      return `  background-color: rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a});\n`;
    }
    return `  background-color: #${toHex(r)}${toHex(g)}${toHex(b)};\n`;
  }
  if (fill.type === 'GRADIENT_LINEAR' && fill.gradient) {
    return `  background: ${fill.gradient};\n`;
  }
  return '';
}

/**
 * Read padding from a Figma node (supports paddingTop/Right/Bottom/Left or padding shorthand).
 */
function extractPadding(node: any): string {
  const t = node.paddingTop ?? 0;
  const r = node.paddingRight ?? 0;
  const b = node.paddingBottom ?? 0;
  const l = node.paddingLeft ?? 0;
  if (t === 0 && r === 0 && b === 0 && l === 0) return '';
  if (t === b && l === r && t === l) return `  padding: ${t}px;\n`;
  if (t === b && l === r) return `  padding: ${t}px ${r}px;\n`;
  return `  padding: ${t}px ${r}px ${b}px ${l}px;\n`;
}

/**
 * Finds the first prominent heading TEXT node in a section frame.
 * Looks at the first 2 levels of children for a TEXT node with short,
 * descriptive content (likely a title/heading).
 * Returns null if no suitable heading text is found.
 */
function findHeadingText(node: any): string | null {
  if (!node?.children) return null;
  for (const child of node.children) {
    if (child.visible === false) continue;
    // Direct TEXT child — likely a title
    if (child.type === 'TEXT' && child.characters) {
      const text = child.characters.trim();
      if (text.length > 0 && text.length <= 60) return text;
    }
    // Check one level deeper (e.g., "Heading" frame containing TEXT)
    if (child.children) {
      for (const gc of child.children) {
        if (gc.visible === false) continue;
        if (gc.type === 'TEXT' && gc.characters) {
          const text = gc.characters.trim();
          if (text.length > 0 && text.length <= 60) return text;
        }
      }
    }
  }
  return null;
}

/**
 * Resolves section names for a list of children.
 * When multiple children share the same Figma frame name, attempts to
 * disambiguate by looking for heading text inside each section.
 */
function resolveSectionNames(children: any[]): string[] {
  // Count name occurrences
  const nameCounts = new Map<string, number>();
  const rawNames = children.map((child) => child.name || '');
  for (const name of rawNames) {
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }

  return children.map((child, i) => {
    const rawName = rawNames[i];
    // If this name is unique, use it as-is
    if ((nameCounts.get(rawName) ?? 0) <= 1) return rawName;
    // Name is repeated — try to find a heading text to use instead
    const heading = findHeadingText(child);
    if (heading) return heading;
    // Fallback: append index to disambiguate
    return `${rawName} ${i + 1}`;
  });
}

/**
 * Extract deterministic page layout CSS from a Figma root frame and its children.
 *
 * @param rootNode - The top-level Figma FRAME node
 * @param children - The direct children of rootNode
 */
export function extractPageLayoutCSS(rootNode: any, children: any[]): PageLayoutResult {
  const pageName = toKebab(rootNode.name || 'page') || 'page';

  // Root dimensions
  const rootBounds = rootNode.absoluteBoundingBox;
  const width = rootBounds?.width ?? rootNode.dimensions?.width ?? rootNode.size?.x;
  const rootHeight = rootBounds?.height ?? rootNode.dimensions?.height ?? rootNode.size?.y;

  // Clips content
  const overflow = rootNode.clipsContent ? '  overflow: hidden;\n' : '';

  // Determine layout mode
  const layoutMode = rootNode.layoutMode ?? rootNode.layout?.mode;
  const hasAutoLayout = layoutMode && layoutMode !== 'NONE';

  const sections: SectionInfo[] = [];
  let sectionCSS = '';

  // Resolve section names: disambiguate repeated Figma frame names
  // by looking for heading text inside each section.
  const resolvedNames = resolveSectionNames(children);

  let rootCSS: string;

  if (hasAutoLayout) {
    // ── Auto-layout: flex-based stacking ─────────────────────────────────
    const isHorizontal = layoutMode === 'HORIZONTAL' || layoutMode === 'row';
    const flexDir = isHorizontal ? 'row' : 'column';
    const isWrapping = rootNode.layoutWrap === 'WRAP';
    const counterAxisSpacing = rootNode.counterAxisSpacing ?? 0;
    const gap = rootNode.itemSpacing ?? rootNode.layout?.gap ?? 0;

    const counterAlign = rootNode.counterAxisAlignItems ?? rootNode.layout?.alignItems;
    let alignItems = '';
    if (counterAlign === 'CENTER') alignItems = '  align-items: center;\n';
    else if (counterAlign === 'MAX') alignItems = '  align-items: flex-end;\n';

    rootCSS = `.${pageName} {\n`;
    rootCSS += `  display: flex;\n`;
    rootCSS += `  flex-direction: ${flexDir};\n`;
    if (isWrapping) rootCSS += `  flex-wrap: wrap;\n`;
    if (width) rootCSS += `  max-width: ${width}px;\n  width: 100%;\n  margin-left: auto;\n  margin-right: auto;\n`;
    if (rootHeight) rootCSS += `  min-height: ${rootHeight}px;\n`;
    if (gap) rootCSS += `  gap: ${gap}px;\n`;
    if (isWrapping && counterAxisSpacing) rootCSS += `  row-gap: ${counterAxisSpacing}px;\n`;
    rootCSS += alignItems;
    rootCSS += extractPadding(rootNode);
    rootCSS += extractBackground(rootNode);
    rootCSS += overflow;

    // If any explicitly-absolute children exist, root needs relative context
    const hasExplicitAbsolute = children.some(
      (c) => c.layoutPositioning === 'ABSOLUTE' || c.constraints?.layoutPositioning === 'ABSOLUTE'
    );
    if (hasExplicitAbsolute) rootCSS += `  position: relative;\n`;
    rootCSS += '}\n';

    for (let ci = 0; ci < children.length; ci++) {
      const child = children[ci];

      // Skip hidden children — they should not become layout sections
      if (child.visible === false) continue;

      const rawName = child.name || `section-${sections.length + 1}`;
      const kebabName = toKebab(rawName) || `section-${sections.length + 1}`;
      const baseClass = `${pageName}__${kebabName}`;
      const resolved = resolvedNames[ci];
      const displayName = resolved !== rawName ? resolved : undefined;
      sections.push({ name: kebabName, baseClass, semanticTag: inferSemanticTag(rawName, ci, children.length), displayName });

      // Explicit absolute child inside an auto-layout frame
      if (child.layoutPositioning === 'ABSOLUTE' || child.constraints?.layoutPositioning === 'ABSOLUTE') {
        const bounds = child.absoluteBoundingBox;
        const parentBounds = rootNode.absoluteBoundingBox;
        if (bounds && parentBounds) {
          sectionCSS += `.${baseClass} {\n`;
          sectionCSS += `  position: absolute;\n`;
          sectionCSS += `  left: ${Math.round(bounds.x - parentBounds.x)}px;\n`;
          sectionCSS += `  top: ${Math.round(bounds.y - parentBounds.y)}px;\n`;
          sectionCSS += `  width: ${Math.round(bounds.width)}px;\n`;
          sectionCSS += `  height: ${Math.round(bounds.height)}px;\n`;
          sectionCSS += '}\n';
          continue;
        }
      }

      let css = `.${baseClass} {\n`;
      const childWidth = child.absoluteBoundingBox?.width ?? child.dimensions?.width ?? child.size?.x;
      if (childWidth) css += `  width: ${childWidth}px;\n`;
      else css += `  width: 100%;\n`;

      const childHeight = child.absoluteBoundingBox?.height ?? child.dimensions?.height ?? child.size?.y;
      const verticalSizing = child.layoutSizingVertical ?? child.sizing?.vertical;
      if (verticalSizing === 'FIXED' && childHeight) css += `  height: ${childHeight}px;\n`;

      const layoutGrow = child.layoutGrow ?? child.layoutAlign;
      if (layoutGrow === 1 || layoutGrow === 'STRETCH') css += `  flex: 1;\n`;
      css += '}\n';
      sectionCSS += css;
    }

  } else {
    // ── No auto-layout: children are absolutely positioned ────────────────
    // Root is a positioning context; each child gets explicit top/left from bounds.
    rootCSS = `.${pageName} {\n`;
    rootCSS += `  position: relative;\n`;
    if (width) rootCSS += `  max-width: ${width}px;\n  width: 100%;\n  margin-left: auto;\n  margin-right: auto;\n`;
    if (rootHeight) rootCSS += `  height: ${rootHeight}px;\n`;
    rootCSS += extractPadding(rootNode);
    rootCSS += extractBackground(rootNode);
    rootCSS += overflow;
    rootCSS += '}\n';

    for (let ci = 0; ci < children.length; ci++) {
      const child = children[ci];

      // Skip hidden children — they should not become layout sections
      if (child.visible === false) continue;

      const rawName = child.name || `section-${sections.length + 1}`;
      const kebabName = toKebab(rawName) || `section-${sections.length + 1}`;
      const baseClass = `${pageName}__${kebabName}`;
      const resolved = resolvedNames[ci];
      const displayName = resolved !== rawName ? resolved : undefined;
      sections.push({ name: kebabName, baseClass, semanticTag: inferSemanticTag(rawName, ci, children.length), displayName });

      const bounds = child.absoluteBoundingBox;
      let css = `.${baseClass} {\n`;
      if (bounds && rootBounds) {
        css += `  position: absolute;\n`;
        css += `  left: ${Math.round(bounds.x - rootBounds.x)}px;\n`;
        css += `  top: ${Math.round(bounds.y - rootBounds.y)}px;\n`;
        css += `  width: ${Math.round(bounds.width)}px;\n`;
        css += `  height: ${Math.round(bounds.height)}px;\n`;
      } else {
        // No bounding box — fallback to full-width flow
        const childWidth = child.dimensions?.width ?? child.size?.x;
        css += childWidth ? `  width: ${childWidth}px;\n` : `  width: 100%;\n`;
      }
      css += '}\n';
      sectionCSS += css;
    }
  }

  return {
    css: rootCSS + '\n' + sectionCSS,
    sections,
    pageBaseClass: pageName,
  };
}
