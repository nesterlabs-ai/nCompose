/**
 * Utilities for cleaning LLM-generated code before parsing.
 *
 * LLMs commonly wrap code in markdown fences and sometimes
 * miss imports — these functions fix that before parseJsx().
 */

/**
 * Strips markdown code fences from LLM output.
 * Handles ```tsx, ```typescript, ```jsx, ```ts, and plain ```.
 */
export function stripMarkdownFences(code: string): string {
  let cleaned = code.trim();

  // Remove opening fence with optional language tag
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:tsx?|jsx?|typescript)?\s*\n?/, '');
  }

  // Remove closing fence
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.replace(/\n?```\s*$/, '');
  }

  return cleaned.trim();
}

/**
 * Ensures required Mitosis imports are present based on code usage.
 * Fixes the common LLM mistake of using <Show>/<For>/useStore without importing them.
 */
export function fixMissingImports(code: string): string {
  const usedSymbols: string[] = [];

  if (/useStore\s*\(/.test(code)) usedSymbols.push('useStore');
  if (/<Show[\s>]/.test(code)) usedSymbols.push('Show');
  if (/<For[\s>]/.test(code)) usedSymbols.push('For');

  if (usedSymbols.length === 0) return code;

  // Check if there's already a mitosis import
  const importRegex = /import\s*\{([^}]+)\}\s*from\s*['"]@builder\.io\/mitosis['"]/;
  const match = code.match(importRegex);

  if (match) {
    // Parse existing imports
    const existingImports = match[1].split(',').map((s) => s.trim()).filter(Boolean);
    const missing = usedSymbols.filter((s) => !existingImports.includes(s));

    if (missing.length === 0) return code;

    // Add missing imports to existing import statement
    const allImports = [...existingImports, ...missing].join(', ');
    return code.replace(importRegex, `import { ${allImports} } from '@builder.io/mitosis'`);
  }

  // No mitosis import found — add one at the top
  const importLine = `import { ${usedSymbols.join(', ')} } from '@builder.io/mitosis';\n`;
  return importLine + code;
}

/**
 * Extracts a CSS style block from LLM output that contains both
 * JSX and CSS separated by a `---CSS---` delimiter.
 *
 * Falls back to detecting a trailing `<style>` block if no delimiter found.
 */
export function extractStyleBlock(code: string): { jsx: string; css: string } {
  // Primary: split on ---CSS--- delimiter
  const delimiterIndex = code.indexOf('---CSS---');
  if (delimiterIndex !== -1) {
    const jsx = code.substring(0, delimiterIndex).trim();
    let css = code.substring(delimiterIndex + '---CSS---'.length).trim();
    // Strip markdown fences around CSS if present
    css = stripMarkdownFences(css);
    return { jsx, css };
  }

  // Fallback: look for <style>...</style> at the end of the output
  const styleMatch = code.match(/<style>([\s\S]*?)<\/style>\s*$/);
  if (styleMatch) {
    const jsx = code.replace(/<style>[\s\S]*?<\/style>\s*$/, '').trim();
    return { jsx, css: styleMatch[1].trim() };
  }

  // No CSS found — return as-is
  return { jsx: code, css: '' };
}

/**
 * Finds the index after the matching closing bracket for an opening `[`, `{`, or `(`.
 * Handles nested brackets and string literals.
 */
function findBalancedEnd(code: string, startIndex: number): number {
  const openChar = code[startIndex];
  const closeMap: Record<string, string> = { '[': ']', '{': '}', '(': ')' };
  const closeChar = closeMap[openChar];
  if (!closeChar) return -1;

  let depth = 1;
  let i = startIndex + 1;
  let inString: string | null = null;

  while (i < code.length && depth > 0) {
    const ch = code[i];

    if (inString) {
      if (ch === '\\') {
        i++; // skip escaped character
      } else if (ch === inString) {
        inString = null;
      }
    } else {
      if (ch === '"' || ch === "'" || ch === '`') {
        inString = ch;
      } else if (ch === openChar) {
        depth++;
      } else if (ch === closeChar) {
        depth--;
      }
    }
    i++;
  }

  return depth === 0 ? i : -1;
}

/**
 * Hoists local `const` declarations (array/object literals) into `useStore()`.
 *
 * Mitosis's parseJsx() silently drops const declarations that aren't recognized
 * hooks (useStore, useState, useRef, useContext). This causes blank output when
 * the LLM generates `const items = [...]` for use in `<For each={items}>`.
 *
 * This function detects such declarations, wraps them in useStore(), and updates
 * references in JSX to use `state.X`.
 */
export function hoistLocalConsts(code: string): string {
  const funcMatch = code.match(/export\s+default\s+function\s+\w+\s*\([^)]*\)\s*\{/);
  if (!funcMatch) return code;

  const funcBodyStart = funcMatch.index! + funcMatch[0].length;
  const returnIndex = code.indexOf('return', funcBodyStart);
  if (returnIndex === -1) return code;

  const constPattern = /^[ \t]*const\s+(\w+)\s*=\s*([[{])/gm;
  const declarations: Array<{
    name: string;
    initializer: string;
    start: number;
    end: number;
  }> = [];

  constPattern.lastIndex = funcBodyStart;
  let match;
  while ((match = constPattern.exec(code)) !== null) {
    if (match.index >= returnIndex) break;

    const name = match[1];
    if (name === 'state') continue;

    // Only process top-level declarations (brace depth 0 relative to function body)
    let braceDepth = 0;
    for (let j = funcBodyStart; j < match.index; j++) {
      if (code[j] === '{') braceDepth++;
      if (code[j] === '}') braceDepth--;
    }
    if (braceDepth > 0) continue;

    const bracketStart = match.index + match[0].length - 1;
    const bracketEnd = findBalancedEnd(code, bracketStart);
    if (bracketEnd === -1) continue;

    // Skip chained expressions (e.g. [...].map())
    const restOfLine = code.substring(bracketEnd).split('\n')[0];
    if (!/^\s*;?\s*(\/\/.*)?$/.test(restOfLine)) continue;

    const initializer = code.substring(bracketStart, bracketEnd);
    const lineEnd = code.indexOf('\n', bracketEnd);
    const stmtEnd = lineEnd === -1 ? code.length : lineEnd + 1;

    declarations.push({ name, initializer, start: match.index, end: stmtEnd });
  }

  if (declarations.length === 0) return code;

  let result = code;

  // Remove original declarations (reverse order to preserve indices)
  for (let i = declarations.length - 1; i >= 0; i--) {
    const decl = declarations[i];
    result = result.substring(0, decl.start) + result.substring(decl.end);
  }

  // Build useStore entries
  const entries = declarations.map(d => `    ${d.name}: ${d.initializer}`).join(',\n');

  // Merge into existing useStore or create new one
  const useStoreMatch = result.match(/const\s+state\s*=\s*useStore\(\{/);
  if (useStoreMatch) {
    const insertPoint = useStoreMatch.index! + useStoreMatch[0].length;
    result = result.substring(0, insertPoint) + '\n' + entries + ',\n' + result.substring(insertPoint);
  } else {
    const funcMatch2 = result.match(/export\s+default\s+function\s+\w+\s*\([^)]*\)\s*\{/);
    if (funcMatch2) {
      const insertPoint = funcMatch2.index! + funcMatch2[0].length;
      result = result.substring(0, insertPoint) +
        '\n  const state = useStore({\n' + entries + '\n  });\n' +
        result.substring(insertPoint);
    }
  }

  // Replace bare variable references in the JSX return block
  const newReturnIndex = result.indexOf('return');
  if (newReturnIndex !== -1) {
    const beforeReturn = result.substring(0, newReturnIndex);
    let afterReturn = result.substring(newReturnIndex);

    for (const decl of declarations) {
      // Replace name → state.name:
      // - Negative lookbehind: not preceded by . (property access)
      // - Word boundary on both sides
      // - Negative lookahead: not followed by : (object key)
      const regex = new RegExp(`(?<!\\.)\\b${decl.name}\\b(?!\\s*:)`, 'g');
      afterReturn = afterReturn.replace(regex, `state.${decl.name}`);
    }

    result = beforeReturn + afterReturn;
  }

  return result;
}

/**
 * Replaces React-style `className` with Mitosis-required `class`.
 * LLMs trained on React frequently emit className out of habit.
 */
function fixClassNameAttribute(code: string): string {
  return code.replace(/\bclassName=/g, 'class=');
}

/**
 * Normalizes SVG presentation attributes from kebab-case to camelCase
 * so they are valid in JSX (both Mitosis and React).
 *
 * Only replaces attribute-position occurrences (`attr=`) to avoid
 * touching valid kebab-case CSS property names inside string literals.
 */
function fixSVGAttributes(code: string): string {
  return code
    .replace(/\bstroke-width=/g, 'strokeWidth=')
    .replace(/\bstroke-linecap=/g, 'strokeLinecap=')
    .replace(/\bstroke-linejoin=/g, 'strokeLinejoin=')
    .replace(/\bstroke-dasharray=/g, 'strokeDasharray=')
    .replace(/\bstroke-dashoffset=/g, 'strokeDashoffset=')
    .replace(/\bstroke-miterlimit=/g, 'strokeMiterlimit=')
    .replace(/\bstroke-opacity=/g, 'strokeOpacity=')
    .replace(/\bfill-opacity=/g, 'fillOpacity=')
    .replace(/\bfill-rule=/g, 'fillRule=')
    .replace(/\bclip-path=/g, 'clipPath=')
    .replace(/\bclip-rule=/g, 'clipRule=')
    .replace(/\bshape-rendering=/g, 'shapeRendering=')
    .replace(/\bcolor-interpolation-filters=/g, 'colorInterpolationFilters=');
}

/**
 * Strips hallucinated `margin-bottom` values from CSS rule blocks.
 *
 * LLMs (especially DeepSeek) systematically add `margin-bottom: Xpx` equal to
 * `font-size: Xpx` on text elements. This is a known hallucination — the Figma
 * data has no paragraph spacing for these nodes. Real paragraph spacing from
 * Figma comes through as `textStyle.marginBottom` and wouldn't match font-size.
 */
function stripHallucinatedMargins(css: string): string {
  // For each CSS rule block, if margin-bottom equals font-size, remove it.
  return css.replace(
    /(\{[^}]*?)font-size:\s*(\d+(?:\.\d+)?px)\s*;([^}]*?)margin-bottom:\s*\2\s*;/g,
    '$1font-size: $2;$3'
  ).replace(
    // Also handle reverse order: margin-bottom before font-size
    /(\{[^}]*?)margin-bottom:\s*(\d+(?:\.\d+)?px)\s*;([^}]*?)font-size:\s*\2\s*;/g,
    '$1$3font-size: $2;'
  );
}

/**
 * Fixes invalid CSS values that LLMs sometimes hallucinate.
 * Applied to the extracted CSS block, not the JSX.
 */
function fixInvalidCSSValues(css: string): string {
  // `background-size: stretch` is not a valid CSS value.
  // The closest valid equivalent that preserves the "fill the area" intent is `cover`.
  return css.replace(/\bbackground-size\s*:\s*stretch\b/gi, 'background-size: cover');
}

/**
 * Repairs truncated CSS that occurs when LLM output hits the token limit.
 *
 * Common truncation patterns:
 * - Property name without value:  `height` (no colon)
 * - Property with colon but no value: `height:` or `height: `
 * - Unclosed rule blocks (missing closing `}`)
 *
 * PostCSS/Vite will fail to parse these, so we remove them.
 */
function repairTruncatedCSS(css: string): string {
  if (!css) return css;

  let result = css.trimEnd();

  // Remove trailing incomplete declaration: a line that is just a property name
  // (word chars / hyphens) with optional colon and optional partial value, no semicolon
  // e.g. "    height" or "    height:" or "    height: 20"
  result = result.replace(/\n[ \t]*[a-zA-Z-]+[ \t]*:?[^;{}]*$/, '');

  // Ensure all opened braces are closed
  let openBraces = 0;
  for (const ch of result) {
    if (ch === '{') openBraces++;
    else if (ch === '}') openBraces--;
  }
  while (openBraces > 0) {
    result += '\n}';
    openBraces--;
  }

  return result;
}

/**
 * Auto-fixes the root element when the LLM outputs `<div>` but the expected
 * tag is something else (e.g. `<button>`, `<nav>`, `<label>`).
 *
 * Only swaps `<div>` → target tag. Arbitrary tag mismatches (e.g. `<span>` → `<button>`)
 * are left for the semantic validator to catch and feed back to the LLM.
 *
 * Tracks JSX brace/tag depth to find the exact matching closing `</div>`.
 * Special-cases `<hr>` as self-closing.
 */
export function fixRootElement(code: string, expectedRootTag?: string): string {
  if (!expectedRootTag) return code;

  // Find the root <div in the return statement
  const openStart = findRootDivIndex(code);
  if (openStart === -1) return code; // root is not <div>, nothing to fix

  const tag = expectedRootTag;

  // Special case: <hr> is self-closing — replace <div .../> or <div>...</div> with <hr ... />
  if (tag === 'hr') {
    return fixRootToSelfClosing(code, openStart);
  }

  // Find the matching closing </div> BEFORE modifying the string
  const tagEndIdx = code.indexOf('>', openStart);
  if (tagEndIdx === -1) return code;

  // Check if opening tag is self-closing: <div ... /> — can't swap to non-void tag easily
  if (code[tagEndIdx - 1] === '/') return code;

  const closingIdx = findMatchingClose(code, tagEndIdx + 1, 'div');
  if (closingIdx === -1) return code;

  // Replace closing tag first (right to left preserves indices)
  let result = code.substring(0, closingIdx) + `</${tag}>` + code.substring(closingIdx + 6);
  // Then replace opening tag
  result = result.substring(0, openStart) + `<${tag}` + result.substring(openStart + 4);

  return result;
}

/**
 * Finds the index of the root `<div` tag in the JSX return statement.
 * Returns -1 if no root <div> is found.
 */
function findRootDivIndex(code: string): number {
  // Try return with parens: return (\n  <div
  const returnParenMatch = code.match(/\breturn\s*\(/);
  if (returnParenMatch) {
    const afterIdx = returnParenMatch.index! + returnParenMatch[0].length;
    const afterReturn = code.substring(afterIdx);
    const tagMatch = afterReturn.match(/^\s*<div([\s>\/])/);
    if (tagMatch) {
      return afterIdx + afterReturn.indexOf('<div');
    }
  }

  // Try return without parens: return <div
  const directMatch = code.match(/\breturn\s+<div([\s>\/])/);
  if (directMatch) {
    return directMatch.index! + directMatch[0].indexOf('<div');
  }

  return -1;
}

/**
 * Replace root <div ...>...</div> with <hr ... /> (self-closing).
 */
function fixRootToSelfClosing(code: string, openStart: number): string {
  // Check if it's already self-closing: <div ... />
  const selfCloseMatch = code.substring(openStart).match(/^<div\s*([^>]*?)\s*\/>/);
  if (selfCloseMatch) {
    const attrs = selfCloseMatch[1].trim();
    const hrTag = attrs ? `<hr ${attrs} />` : `<hr />`;
    return code.substring(0, openStart) + hrTag + code.substring(openStart + selfCloseMatch[0].length);
  }

  // Find opening tag end
  const tagEndIdx = code.indexOf('>', openStart);
  if (tagEndIdx === -1) return code;

  // Find matching </div>
  const closingIdx = findMatchingClose(code, tagEndIdx + 1, 'div');
  if (closingIdx === -1) return code;

  // Extract attributes from the opening tag
  const attrs = code.substring(openStart + 4, tagEndIdx).trim();
  const hrTag = attrs ? `<hr ${attrs} />` : `<hr />`;
  return code.substring(0, openStart) + hrTag + code.substring(closingIdx + 6);
}

/**
 * Finds the index of the matching closing tag `</tagName>` starting from searchStart.
 * Tracks nested open/close tags of the same name.
 */
function findMatchingClose(code: string, searchStart: number, tagName: string): number {
  const openPattern = new RegExp(`<${tagName}[\\s>]`, 'g');
  const closePattern = new RegExp(`</${tagName}>`, 'g');

  let depth = 1;
  let pos = searchStart;

  while (pos < code.length && depth > 0) {
    openPattern.lastIndex = pos;
    closePattern.lastIndex = pos;

    const nextOpen = openPattern.exec(code);
    const nextClose = closePattern.exec(code);

    if (!nextClose) return -1; // no more closing tags

    if (nextOpen && nextOpen.index < nextClose.index) {
      // Check it's not a self-closing tag
      const afterTag = code.substring(nextOpen.index);
      const selfClose = afterTag.match(/^<\w+[^>]*\/>/);
      if (selfClose) {
        pos = nextOpen.index + selfClose[0].length;
      } else {
        depth++;
        pos = nextOpen.index + nextOpen[0].length;
      }
    } else {
      depth--;
      if (depth === 0) return nextClose.index;
      pos = nextClose.index + nextClose[0].length;
    }
  }

  return -1;
}

/**
 * Converts `.map()` calls in JSX to Mitosis `<For>` components.
 *
 * LLMs frequently emit `{items.map((item) => (...))}` which works in React
 * but fails Mitosis compilation for Vue/Svelte/Angular targets. This
 * transforms them to `<For each={items}>{(item) => (...)}</For>`.
 *
 * Only processes `.map()` calls within the JSX return block.
 */
export function fixMapToFor(code: string): string {
  const returnIdx = code.search(/\breturn\s*[\(<]/);
  if (returnIdx === -1) return code;

  let result = code;
  let searchFrom = returnIdx;

  while (searchFrom < result.length) {
    // Find .map( pattern (with or without optional chaining)
    const mapIdx = result.indexOf('.map(', searchFrom);
    if (mapIdx === -1 || mapIdx < returnIdx) break;

    // Find the { that opens this JSX expression by scanning backward
    // Skip over the expression (word chars, dots, brackets, question marks)
    let braceIdx = -1;
    let depth = 0;
    for (let i = mapIdx - 1; i >= returnIdx; i--) {
      const ch = result[i];
      if (ch === '}' || ch === ')' || ch === ']') depth++;
      else if (ch === ')') depth++; // already covered but belt-and-suspenders
      else if (ch === '(' || ch === '[') depth--;
      else if (ch === '{') {
        if (depth === 0) { braceIdx = i; break; }
        depth--;
      }
    }

    if (braceIdx === -1) {
      searchFrom = mapIdx + 5;
      continue;
    }

    // Expression between { and .map(  — strip trailing ?. from optional chaining
    const expr = result.substring(braceIdx + 1, mapIdx).trim().replace(/\?\s*$/, '');
    if (!expr) {
      searchFrom = mapIdx + 5;
      continue;
    }

    // Find the opening ( of .map(
    const mapParenIdx = mapIdx + 4; // index of ( in ".map("
    const mapEndIdx = findBalancedEnd(result, mapParenIdx);
    if (mapEndIdx === -1) {
      searchFrom = mapIdx + 5;
      continue;
    }

    // Verify there's a } closing the JSX expression right after
    const afterMap = result.substring(mapEndIdx);
    const closingMatch = afterMap.match(/^\s*\}/);
    if (!closingMatch) {
      searchFrom = mapIdx + 5;
      continue;
    }

    const closeBraceIdx = mapEndIdx + closingMatch[0].indexOf('}');

    // Extract callback content: everything inside .map( ... )
    const callback = result.substring(mapParenIdx + 1, mapEndIdx - 1);

    // Build: <For each={expr}>{callback}</For>
    const forElement = `<For each={${expr}}>{${callback}}</For>`;

    result = result.substring(0, braceIdx) + forElement + result.substring(closeBraceIdx + 1);
    searchFrom = braceIdx + forElement.length;
  }

  return result;
}

/**
 * Wraps bare JSX (no `export default function`) in a Mitosis component.
 *
 * Some LLMs (e.g. DeepSeek) output raw HTML/JSX without the
 * `export default function` wrapper that Mitosis `parseJsx()` requires.
 * This detects that case and wraps the JSX into a valid component.
 */
export function wrapBareJSX(code: string): string {
  const trimmed = code.trim();

  // Already has an export default function — nothing to do
  if (/export\s+default\s+function\s/.test(trimmed)) return trimmed;

  // If the code starts with a JSX tag (< not followed by another <, i.e. not a comparison)
  // and does NOT have an export default, wrap it.
  if (!trimmed.startsWith('<')) return trimmed;

  // Derive a component name from the root element's class attribute
  let componentName = 'Section';
  const classMatch = trimmed.match(/^<\w+[^>]*\bclass="([^"]+)"/);
  if (classMatch) {
    // "hero-section" → "HeroSection"
    componentName = classMatch[1]
      .split(/[-_]+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join('');
  }

  return `export default function ${componentName}(props) {\n  return (\n    ${trimmed}\n  );\n}`;
}

/**
 * Removes redundant SVG background fill paths from SVGs where the parent
 * element already handles the background via CSS (background-color + border-radius).
 *
 * Pattern detected: an SVG has both a `<path fill="currentColor" .../>` that
 * starts at the origin (M0 — a full-area background shape) and other paths
 * (the actual icon strokes). The fill path duplicates the CSS background and
 * renders as black (since `currentColor` has no explicit CSS `color` ancestor).
 *
 * Fix: remove the fill path. The CSS background-color + border-radius handles
 * the visual circle/shape, and the stroke paths render the icon content.
 */
export function stripRedundantSVGFills(jsx: string): string {
  // Match SVGs that contain multiple paths where the first uses fill="currentColor"
  return jsx.replace(
    /(<svg\b[^>]*>)([\s\S]*?)(<\/svg>)/g,
    (_match, open: string, content: string, close: string) => {
      // Count paths: need at least 2 (one fill background + one stroke icon)
      const pathMatches = [...content.matchAll(/<path\b[^>]*\/>/g)];
      if (pathMatches.length < 2) return _match;

      // Check if the first path is a background fill (starts at origin with fill="currentColor")
      const firstPath = pathMatches[0][0];
      const isFillPath = /\bfill="currentColor"/.test(firstPath);
      const startsAtOrigin = /\bd="M0[\s,]/.test(firstPath);

      // Check if there's at least one stroke path (the actual icon)
      const hasStrokePath = pathMatches.some(
        (m, i) => i > 0 && /\bstroke="currentColor"/.test(m[0]),
      );

      if (isFillPath && startsAtOrigin && hasStrokePath) {
        // Remove the background fill path
        const cleaned = content.replace(firstPath, '');
        return open + cleaned + close;
      }

      return _match;
    },
  );
}

/**
 * Converts HTML-style `style="prop: val; prop: val;"` attributes to
 * Mitosis-compatible `css={{prop: 'val', prop: 'val'}}` objects.
 *
 * LLMs sometimes emit HTML-style inline style strings which are invalid
 * in both Mitosis (.lite.tsx) and React JSX (which expects style objects).
 * In Mitosis, inline styles should use the `css={{}}` prop.
 */
export function fixInlineStyleStrings(code: string): string {
  // Match style="..." attributes (not inside SVG tags where style is valid HTML)
  return code.replace(
    /\bstyle="([^"]+)"/g,
    (_match, styleStr: string) => {
      const props = styleStr
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((decl) => {
          const colonIdx = decl.indexOf(':');
          if (colonIdx === -1) return null;
          const prop = decl.substring(0, colonIdx).trim();
          const val = decl.substring(colonIdx + 1).trim();
          // Convert kebab-case to camelCase
          const camelProp = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          return `${camelProp}: '${val}'`;
        })
        .filter(Boolean);

      return `css={{${props.join(', ')}}}`;
    },
  );
}

/**
 * Strips `css={{...}}` inline style props from Mitosis JSX source.
 *
 * LLMs sometimes emit inline `css={{}}` props instead of using class-based CSS.
 * After Mitosis compilation, these become auto-generated class names with only
 * width/height — losing all other styling context. This function removes them
 * so styling comes exclusively from the CSS stylesheet.
 *
 * Handles:
 * - `css={{key: 'value', key2: 'value2'}}` (Mitosis inline style objects)
 * - `css={{ key: "value" }}` (double quotes, whitespace variants)
 *
 * Does NOT strip `class=` or `className=` attributes.
 */
export function stripInlineCSS(code: string): string {
  // Match css={{ ... }} props, handling nested braces carefully.
  // The outer pair is {{...}} — we need to balance the inner braces.
  return code.replace(
    /\s*css=\{\{[^}]*\}\}/g,
    '',
  );
}

/**
 * Ensures the root CSS rule has a max-width constraint for PATH B outputs.
 * The LLM often omits max-width, causing the layout to stretch to fill
 * the entire viewport. We inject max-width and centering if not present.
 *
 * @param css - The extracted CSS
 * @param rootWidth - The root node's width from Figma (e.g. 1440)
 */
function ensureRootMaxWidth(css: string, rootWidth?: number): string {
  if (!css || !rootWidth || rootWidth < 200) return css;
  // Find the first CSS rule (should be the root element)
  const firstRuleMatch = css.match(/^([^{]*\{)([^}]*)(\})/);
  if (!firstRuleMatch) return css;
  const [fullMatch, selector, body, close] = firstRuleMatch;
  // Already has max-width? Skip
  if (body.includes('max-width')) return css;
  // Inject max-width + centering
  const injection = `\n  max-width: ${Math.round(rootWidth)}px;\n  width: 100%;\n  margin-left: auto;\n  margin-right: auto;`;
  return css.replace(fullMatch, `${selector}${body}${injection}\n${close}`);
}

/**
 * Replaces hardcoded design-canvas-width values (e.g. `width: 1440px`) with
 * `width: 100%` on non-root CSS rules. Inner elements matching the design
 * canvas width are almost certainly meant to fill their container — hardcoded
 * pixel values cause horizontal overflow at smaller viewports.
 *
 * Skips the very first rule (root element, handled by ensureRootMaxWidth)
 * and rules for `img` / image-related selectors where the width may be intentional.
 */
export function replaceDesignWidthInCSS(css: string, rootWidth?: number): string {
  if (!css || !rootWidth || rootWidth < 200) return css;
  const widthPx = `${Math.round(rootWidth)}px`;
  let isFirst = true;
  return css.replace(
    /([^}]*?\{)([^}]*)(\})/g,
    (match, selector: string, body: string, close: string) => {
      // Skip the first rule (root element)
      if (isFirst) { isFirst = false; return match; }
      // Skip actual image selectors where pixel width may be intentional.
      // Match `img` tags and class names ending with `__image` (not `__image-wrap`, etc.)
      if (/\bimg\b|__image(?:\s|,|\{|$)/i.test(selector)) return match;
      // Replace width: <rootWidth>px → width: 100%
      const newBody = body.replace(
        new RegExp(`(\\bwidth:\\s*)${Math.round(rootWidth)}px`, 'g'),
        '$1100%',
      );
      return `${selector}${newBody}${close}`;
    },
  );
}

/**
 * Full cleanup pipeline: extracts CSS block, strips fences, fixes Mitosis
 * compliance issues, auto-fixes root element, hoists consts, and fixes imports.
 * Returns both the cleaned JSX and extracted CSS.
 *
 * @param code - Raw LLM output
 * @param expectedRootTag - If provided, auto-fixes root <div> → expected tag
 * @param rootWidth - Optional root node width for max-width injection
 */
export function cleanLLMOutput(code: string, expectedRootTag?: string, rootWidth?: number): { jsx: string; css: string } {
  let cleaned = stripMarkdownFences(code);
  cleaned = stripInlineCSS(cleaned); // Remove css={{}} before Mitosis sees them
  const { jsx, css } = extractStyleBlock(cleaned);
  const fixedClassName = fixClassNameAttribute(jsx.trim());
  const fixedSVG = fixSVGAttributes(fixedClassName);
  const fixedStyles = stripInlineCSS(fixInlineStyleStrings(fixedSVG)); // strip any new css={{}} created by fixInlineStyleStrings
  const strippedSVG = stripRedundantSVGFills(fixedStyles);
  const wrapped = wrapBareJSX(strippedSVG);
  const fixedRoot = fixRootElement(wrapped, expectedRootTag);
  const fixedMap = fixMapToFor(fixedRoot);
  const hoisted = hoistLocalConsts(fixedMap);
  const fixedJsx = fixMissingImports(hoisted);
  let fixedCSS = repairTruncatedCSS(fixInvalidCSSValues(stripHallucinatedMargins(css)));
  fixedCSS = ensureRootMaxWidth(fixedCSS, rootWidth);
  fixedCSS = replaceDesignWidthInCSS(fixedCSS, rootWidth);
  return { jsx: fixedJsx, css: fixedCSS };
}
