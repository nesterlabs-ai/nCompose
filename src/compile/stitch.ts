/**
 * Stitches multiple page sections into a single Mitosis component.
 *
 * Each section's raw LLM output (JSX + CSS) is extracted and combined
 * into one page-level component with merged CSS.
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
  // Detect class-name collisions across sections so overlapping rules are visible.
  const cssBlocks = [pageLayoutCSS];
  const seenClasses = new Map<string, string>(); // className → first-seen section
  const collisions: string[] = [];

  for (const section of sections) {
    if (section.failed || !section.css) continue;

    // Extract every .class-name defined in this section's CSS
    // Match class names in all selector contexts: top-level, nested, pseudo, media queries
    const classMatches = section.css.matchAll(/\.([\w-]+)(?:\s*[{:,\s>~+])/gm);
    for (const m of classMatches) {
      const cls = m[1];
      if (seenClasses.has(cls)) {
        collisions.push(`".${cls}" defined in both "${seenClasses.get(cls)}" and "${section.info.name}"`);
      } else {
        seenClasses.set(cls, section.info.name);
      }
    }

    cssBlocks.push(`/* — ${section.info.name} — */\n${section.css}`);
  }

  if (collisions.length > 0) {
    const warning = `/* ⚠ CSS class collisions detected across sections:\n${collisions.map((c) => ` *   ${c}`).join('\n')}\n * Rename conflicting classes to avoid cascade bleed. */`;
    cssBlocks.splice(1, 0, warning); // Insert after page layout CSS
  }

  const mergedCSS = cssBlocks.join('\n\n');

  return { mitosisSource, mergedCSS };
}
