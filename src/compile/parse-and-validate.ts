import { parseJsx } from '@builder.io/mitosis';
import type { MitosisComponent } from '@builder.io/mitosis';
import type { ParseResult } from '../types/index.js';
import { cleanLLMOutput } from './cleanup.js';

/**
 * Parses LLM-generated code through Mitosis's parseJsx().
 *
 * Steps:
 * 1. Clean the raw output (strip fences, fix imports, extract CSS, auto-fix root element)
 * 2. Parse through Mitosis's JSX parser (JSX only, no CSS)
 * 3. Return success + component + extracted CSS, or failure + error message
 *
 * @param code - Raw LLM output
 * @param expectedRootTag - If provided, auto-fixes root <div> → expected tag during cleanup
 */
export function parseMitosisCode(code: string, expectedRootTag?: string): ParseResult {
  const { jsx: cleaned, css } = cleanLLMOutput(code, expectedRootTag);

  try {
    const component = parseJsx(cleaned, { typescript: true });
    return { success: true, component, rawCode: cleaned, css };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      rawCode: cleaned,
      css,
    };
  }
}
