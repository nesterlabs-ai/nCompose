/**
 * Stitches multiple page sections into a single Mitosis component.
 *
 * Each section's raw LLM output (JSX + CSS) is extracted and combined
 * into one page-level component with merged CSS.
 *
 * All section CSS is scoped under the section's wrapper class to prevent
 * cross-section class name collisions (e.g. two sections both defining
 * `.card` with different properties).
 */

import type { SectionInfo } from '../figma/page-layout.js';

export interface SectionOutput {
  /** Section metadata from page layout analysis */
  info: SectionInfo;
  /** Raw Mitosis JSX source from LLM (the .lite.tsx body) */
  rawCode: string;
  /** Extracted CSS for this section */
  css: string;
  /** Whether this section's LLM call failed */
  failed?: boolean;
}

export interface StitchedPage {
  /** Complete Mitosis .lite.tsx source for the full page */
  mitosisSource: string;
  /** Merged CSS: page layout + all section CSS blocks */
  mergedCSS: string;
}

/**
 * Extract the inner JSX body from a Mitosis component source.
 *
 * Strips the `export default function ...() { return ( ... ); }` wrapper
 * and returns just the inner JSX content.
 *
 * Uses string-context-aware parenthesis depth tracking so that parens inside
 * string literals — e.g. `className="Button (primary)"` or backtick template
 * literals — do not corrupt the depth counter.
 */
export function extractJSXBody(rawCode: string): string {
  // Find the return statement belonging to the export default function.
  // First try to locate `export default function`, then find its return.
  const exportDefaultMatch = rawCode.match(/export\s+default\s+function\s+\w+[^{]*\{/);
  const searchStart = exportDefaultMatch
    ? (exportDefaultMatch.index! + exportDefaultMatch[0].length)
    : 0;
  const searchCode = rawCode.slice(searchStart);
  const matches = [...searchCode.matchAll(/return\s*\(/g)];
  if (matches.length === 0) return rawCode.trim();

  // Use the first return inside the export default function (not the last global one)
  const returnMatch = { ...matches[0], index: matches[0].index! + searchStart } as RegExpMatchArray & { index: number };
  const start = returnMatch.index! + returnMatch[0].length;

  let depth = 1;
  let end = start;
  let i = start;

  // String tracking: quoteChar is set while inside a ' or " string.
  let quoteChar: string | null = null;
  // Template literal tracking: inTemplate is true between backticks.
  // templateExprDepth counts nested ${...} expression braces inside a template.
  let inTemplate = false;
  let templateExprDepth = 0;
  let escaped = false;

  while (i < rawCode.length && depth > 0) {
    const ch = rawCode[i];

    // Handle backslash escaping inside strings / templates
    if (escaped) {
      escaped = false;
      i++;
      continue;
    }
    if (ch === '\\' && (quoteChar !== null || inTemplate)) {
      escaped = true;
      i++;
      continue;
    }

    // ── Inside a regular ' or " string ────────────────────────────────────
    if (quoteChar !== null) {
      if (ch === quoteChar) quoteChar = null;
      i++;
      continue;
    }

    // ── Inside a template literal (outside a ${...} expression) ───────────
    if (inTemplate && templateExprDepth === 0) {
      if (ch === '`') {
        inTemplate = false;
      } else if (ch === '$' && rawCode[i + 1] === '{') {
        templateExprDepth++;
        i += 2; // consume both $ and {
        continue;
      }
      i++;
      continue;
    }

    // ── Inside a ${...} expression within a template literal ───────────────
    if (inTemplate && templateExprDepth > 0) {
      // Track { } depth so a nested object literal doesn't close the expression
      if (ch === '{') { templateExprDepth++; i++; continue; }
      if (ch === '}') {
        templateExprDepth--;
        i++;
        continue;
      }
      // Fall through: still handle string/template starts and paren counting
      // inside the expression (they are real expression characters).
    }

    // ── Expression context: detect string / template literal starts ────────
    if (ch === '"' || ch === "'") {
      quoteChar = ch;
      i++;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      i++;
      continue;
    }

    // ── Parenthesis depth counting (only in expression context) ───────────
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }

    i++;
  }

  let body = rawCode.substring(start, end).trim();

  // Strip outer React.Fragment <> ... </> wrapper so the caller can re-wrap
  // the body in the section's semantic HTML tag.
  if (body.startsWith('<>') && body.endsWith('</>')) {
    body = body.slice(2, -3).trim();
  }

  return body;
}

// ── CSS Scoping ──────────────────────────────────────────────────────────────

/**
 * Checks whether a CSS selector is already scoped under the given scope
 * (i.e. IS the scope class or starts with it followed by a combinator).
 */
function isAlreadyScoped(selector: string, scope: string): boolean {
  return (
    selector === scope ||
    selector.startsWith(scope + ' ') ||
    selector.startsWith(scope + ':') ||
    selector.startsWith(scope + '[') ||
    selector.startsWith(scope + '.')
  );
}

/**
 * Scopes all CSS class selectors under a wrapper class to prevent
 * class name collisions when multiple CSS blocks are merged.
 *
 * Examples:
 *   `.card { }`         → `.wrapper .card { }`
 *   `.card:hover { }`   → `.wrapper .card:hover { }`
 *   `.card, .title { }` → `.wrapper .card, .wrapper .title { }`
 *
 * `@keyframes` blocks are left unchanged (they are global by nature).
 *
 * @param css - The CSS string to scope
 * @param scopeClass - The wrapper class name (without leading dot)
 * @param options.skipSelfScoping - When true, selectors that already start
 *   with the scope class are left unchanged (prevents `.root .root { }` nesting)
 */
export function scopeSectionCSS(
  css: string,
  scopeClass: string,
  options?: { skipSelfScoping?: boolean },
): string {
  if (!css.trim()) return css;

  const scope = `.${scopeClass}`;

  // Normalize multi-line comma-separated selectors into single lines
  const normalized = css.replace(/,\s*\n\s*(?=\.)/g, ', ');

  const lines = normalized.split('\n');
  const output: string[] = [];
  let inKeyframes = false;
  let kfBraceDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Track @keyframes blocks — don't scope their internal selectors (from, to, %)
    if (/^@keyframes\b/.test(trimmed)) {
      inKeyframes = true;
      kfBraceDepth = 0;
    }

    if (inKeyframes) {
      for (const ch of trimmed) {
        if (ch === '{') kfBraceDepth++;
        else if (ch === '}') kfBraceDepth--;
      }
      output.push(line);
      if (kfBraceDepth <= 0) inKeyframes = false;
      continue;
    }

    // Skip CSS comment lines
    if (trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      output.push(line);
      continue;
    }

    // Match a CSS selector line: starts with . and contains {
    const selectorMatch = trimmed.match(/^(\.[^{]+)\{(.*)$/);
    if (selectorMatch) {
      const [, selectorPart, afterBrace] = selectorMatch;
      const indent = line.match(/^(\s*)/)?.[1] ?? '';

      // Scope each comma-separated selector
      const scoped = selectorPart
        .split(',')
        .map((s) => {
          const sel = s.trim();
          // When skipSelfScoping is set, don't double-nest selectors that
          // already start with the scope class (e.g. .root:hover stays as-is)
          if (options?.skipSelfScoping && isAlreadyScoped(sel, scope)) {
            return sel;
          }
          return `${scope} ${sel}`;
        })
        .join(', ');

      output.push(`${indent}${scoped} {${afterBrace}`);
      continue;
    }

    // Everything else (properties, closing braces, @media, etc.) passes through
    output.push(line);
  }

  return output.join('\n');
}

/**
 * Stitch section outputs into a single page component.
 *
 * @param pageName - PascalCase component name (e.g. "LandingPage")
 * @param pageBaseClass - Kebab-case BEM base class (e.g. "landing-page")
 * @param pageLayoutCSS - Deterministic CSS from extractPageLayoutCSS()
 * @param sections - Ordered section outputs from LLM calls
 */
export function stitchPageComponent(
  pageName: string,
  pageBaseClass: string,
  pageLayoutCSS: string,
  sections: SectionOutput[],
): StitchedPage {
  const sectionJSXParts: string[] = [];

  for (const section of sections) {
    if (section.failed) {
      sectionJSXParts.push(
        `      {/* Section "${section.info.name}" failed to generate */}`
      );
      continue;
    }

    const body = extractJSXBody(section.rawCode);
    const tag = section.info.semanticTag;
    const cls = section.info.baseClass;

    // If JSX body is empty the LLM generated CSS-only output.
    // Emit a visible placeholder so the developer knows exactly which
    // section is missing instead of getting a silent empty tag.
    if (!body.trim()) {
      sectionJSXParts.push(
        `      {/* ⚠ Section "${section.info.name}" — LLM generated empty JSX.\n` +
        `         CSS rules are present in the merged stylesheet (class: .${section.info.baseClass}).\n` +
        `         Re-run or manually fill this section. */}`
      );
      continue;
    }

    // Wrap the section body in its semantic tag with the page-level BEM class
    sectionJSXParts.push(
      `      <${tag} class="${cls}">\n        ${body.split('\n').join('\n        ')}\n      </${tag}>`
    );
  }

  const jsxBody = sectionJSXParts.join('\n');

  // Build the full Mitosis component — purely static, no useStore/Show/For
  const mitosisSource = `export default function ${pageName}(props) {
  return (
    <div class="${pageBaseClass}">
${jsxBody}
    </div>
  );
}`;

  // Merge CSS: page layout first, then each section's CSS.
  // Scope each section's CSS under its wrapper class (e.g. .landing-page__hero)
  // to prevent cross-section class name collisions.
  const cssBlocks = [pageLayoutCSS];

  for (const section of sections) {
    if (section.failed || !section.css) continue;

    // Scope all selectors under the section's unique wrapper class.
    // This guarantees .card in "hero" won't affect .card in "features"
    // because they become .landing-page__hero .card and .landing-page__features .card.
    const scopedCSS = scopeSectionCSS(section.css, section.info.baseClass);
    cssBlocks.push(`/* — ${section.info.name} — */\n${scopedCSS}`);
  }

  const mergedCSS = cssBlocks.join('\n\n');

  return { mitosisSource, mergedCSS };
}
