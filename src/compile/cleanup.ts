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
 * Full cleanup pipeline: extracts CSS block, strips fences, fixes imports.
 * Returns both the cleaned JSX and extracted CSS.
 */
export function cleanLLMOutput(code: string): { jsx: string; css: string } {
  let cleaned = stripMarkdownFences(code);
  const { jsx, css } = extractStyleBlock(cleaned);
  const fixedJsx = fixMissingImports(jsx.trim());
  return { jsx: fixedJsx, css };
}
