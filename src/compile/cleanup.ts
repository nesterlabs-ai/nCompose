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
 * Full cleanup pipeline: strips fences, then fixes imports.
 */
export function cleanLLMOutput(code: string): string {
  let cleaned = stripMarkdownFences(code);
  cleaned = fixMissingImports(cleaned);
  return cleaned;
}
