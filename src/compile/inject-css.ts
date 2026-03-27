/**
 * Injects deterministically-generated CSS into framework-compiled output.
 *
 * Each framework has a different way of embedding component styles:
 * - React/Solid: <style>{`css`}</style> inside a fragment
 * - Vue: <style scoped>css</style> section
 * - Svelte: <style>css</style> section
 * - Angular: added to the styles array in @Component
 */

import type { Framework } from '../types/index.js';

/**
 * Inject variant CSS into a compiled framework component.
 * Prepends a universal box-sizing reset if not already present.
 */
export function injectCSS(
  frameworkCode: string,
  css: string,
  framework: Framework,
): string {
  // Ensure box-sizing: border-box reset is present — prevents padding
  // overflow on elements with explicit width + padding.
  let cssWithReset = css;
  if (!css.includes('box-sizing')) {
    cssWithReset = '*, *::before, *::after { box-sizing: border-box; }\n' + css;
  }

  switch (framework) {
    case 'react':
      return injectReactCSS(frameworkCode, cssWithReset);
    case 'vue':
      return injectVueCSS(frameworkCode, cssWithReset);
    case 'svelte':
      return injectSvelteCSS(frameworkCode, cssWithReset);
    case 'angular':
      return injectAngularCSS(frameworkCode, cssWithReset);
    case 'solid':
      return injectSolidCSS(frameworkCode, cssWithReset);
    default:
      return frameworkCode;
  }
}

const STYLE_TAG = (css: string) => `<style>{\`\n${css}\n\`}</style>`;

function injectReactCSS(code: string, css: string): string {
  // Find the component's JSX return — the LAST return statement that contains JSX
  // (inner getters also have return but they return strings, not JSX)
  const returnPattern = /return\s*\(/g;
  let lastMatch: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = returnPattern.exec(code)) !== null) {
    lastMatch = match;
  }

  if (lastMatch) {
    const afterReturn = lastMatch.index + lastMatch[0].length;

    // Find the balanced closing ) for this return, with JSX-aware context tracking.
    // Quotes in JSX text content (e.g. apostrophes in "it's") are NOT JS strings
    // and must not trigger string mode — only quotes inside JSX tag attributes
    // or JS expressions ({...}) are string delimiters.
    let depth = 1;
    let closeIndex = afterReturn;
    let inString: string | null = null;
    let inTemplate = false;
    let escaped = false;
    let inJSXTag = false;      // true between '<tagName' and '>'
    let jsxExprDepth = 0;      // depth of { } JSX expression nesting
    for (let i = afterReturn; i < code.length; i++) {
      const ch = code[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\' && (inString || inTemplate)) { escaped = true; continue; }
      if (inString) { if (ch === inString) inString = null; continue; }
      if (inTemplate) { if (ch === '`') inTemplate = false; continue; }
      // JSX tag tracking
      if (ch === '<' && !inJSXTag && jsxExprDepth === 0) {
        const next = code[i + 1];
        if (next && (next === '/' || /[a-zA-Z]/.test(next))) inJSXTag = true;
        continue;
      }
      if (ch === '>' && inJSXTag) { inJSXTag = false; continue; }
      // JSX expression tracking
      if (ch === '{' && !inJSXTag) { jsxExprDepth++; continue; }
      if (ch === '}' && jsxExprDepth > 0) { jsxExprDepth--; continue; }
      // Only enter string mode inside JSX tag attrs or JS expressions
      if ((ch === '"' || ch === "'") && (inJSXTag || jsxExprDepth > 0)) { inString = ch; continue; }
      if (ch === '`') { inTemplate = true; continue; }
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (depth === 0) {
        closeIndex = i;
        break;
      }
    }

    const jsxContent = code.substring(afterReturn, closeIndex).trim();
    const before = code.substring(0, afterReturn);
    const after = code.substring(closeIndex);

    // Check if the JSX is already wrapped in a fragment
    if (jsxContent.startsWith('<>') && jsxContent.endsWith('</>')) {
      // Already has fragment, inject style tag before the closing </>
      // Find the LAST </> within this JSX content
      const lastFragmentClose = jsxContent.lastIndexOf('</>');
      return (
        before +
        '\n    ' +
        jsxContent.substring(0, lastFragmentClose) +
        `\n      ${STYLE_TAG(css)}\n    ` +
        jsxContent.substring(lastFragmentClose) +
        '\n  ' +
        after
      );
    } else {
      // No fragment, wrap it
      return (
        before +
        '\n    <>\n      ' +
        jsxContent +
        `\n      ${STYLE_TAG(css)}\n    </>\n  ` +
        after
      );
    }
  }

  // Fallback: append style tag after export
  return code.trimEnd() + `\n\n// Variant CSS\nconst __VARIANT_CSS = \`${css}\`;\n`;
}

function injectVueCSS(code: string, css: string): string {
  // Vue: Append to existing <style scoped> or create new one
  if (code.includes('<style scoped>')) {
    return code.replace(
      /<\/style>/,
      `\n/* — Variant CSS — */\n${css}\n</style>`,
    );
  }

  return code.trimEnd() + `\n\n<style scoped>\n${css}\n</style>\n`;
}

function injectSvelteCSS(code: string, css: string): string {
  // Svelte: Append to existing <style> or create new one
  if (code.includes('<style>')) {
    return code.replace(
      /<\/style>/,
      `\n/* — Variant CSS — */\n${css}\n</style>`,
    );
  }

  return code.trimEnd() + `\n\n<style>\n${css}\n</style>\n`;
}

function injectAngularCSS(code: string, css: string): string {
  // Angular: Replace the styles array content
  const stylesRegex = /styles:\s*\[\s*`[\s\S]*?`\s*,?\s*\]/;
  const indentedCSS = css.split('\n').map((l) => '      ' + l).join('\n');

  if (stylesRegex.test(code)) {
    return code.replace(
      stylesRegex,
      `styles: [\n    \`\n      :host {\n        display: contents;\n      }\n${indentedCSS}\n    \`,\n  ]`,
    );
  }

  // If no styles array found, try to add one before standalone
  const standaloneMatch = code.indexOf('standalone:');
  if (standaloneMatch !== -1) {
    return (
      code.substring(0, standaloneMatch) +
      `styles: [\n    \`\n      :host {\n        display: contents;\n      }\n${indentedCSS}\n    \`,\n  ],\n  ` +
      code.substring(standaloneMatch)
    );
  }

  return code;
}

function injectSolidCSS(code: string, css: string): string {
  // Solid typically has a fragment (<> ... </>), inject before the LAST </>
  if (code.includes('</>')) {
    const lastClose = code.lastIndexOf('</>');
    return (
      code.substring(0, lastClose) +
      `  ${STYLE_TAG(css)}\n    ` +
      code.substring(lastClose)
    );
  }

  // Fall back to wrapping like React
  return injectReactCSS(code, css);
}
