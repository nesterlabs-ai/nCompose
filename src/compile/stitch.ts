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
 */
export function extractJSXBody(rawCode: string): string {
  // Strategy: find the return statement's JSX content
  // Match: return ( ... ) — balanced parens
  const returnMatch = rawCode.match(/return\s*\(/);
  if (!returnMatch || returnMatch.index === undefined) {
    // Fallback: return the code as-is (might work if it's just JSX)
    return rawCode.trim();
  }

  const start = returnMatch.index + returnMatch[0].length;
  let depth = 1;
  let end = start;

  for (let i = start; i < rawCode.length; i++) {
    if (rawCode[i] === '(') depth++;
    if (rawCode[i] === ')') depth--;
    if (depth === 0) {
      end = i;
      break;
    }
  }

  let body = rawCode.substring(start, end).trim();

  // If the body is wrapped in a fragment <> ... </>, keep it unwrapped
  // so we can re-wrap in the section's semantic tag
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

  // Merge CSS: page layout first, then each section's CSS
  const cssBlocks = [pageLayoutCSS];
  for (const section of sections) {
    if (!section.failed && section.css) {
      cssBlocks.push(`/* — ${section.info.name} — */\n${section.css}`);
    }
  }
  const mergedCSS = cssBlocks.join('\n\n');

  return { mitosisSource, mergedCSS };
}
