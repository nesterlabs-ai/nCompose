import { parseJsx } from '@builder.io/mitosis';
import type { MitosisComponent } from '@builder.io/mitosis';
import type { ParseResult } from '../types/index.js';
import { cleanLLMOutput } from './cleanup.js';

/**
 * Parses LLM-generated code through Mitosis's parseJsx().
 *
 * Steps:
 * 1. Clean the raw output (strip fences, fix imports)
 * 2. Parse through Mitosis's JSX parser
 * 3. Return success + component, or failure + error message
 */
export function parseMitosisCode(code: string): ParseResult {
  const cleaned = cleanLLMOutput(code);

  try {
    const component = parseJsx(cleaned, { typescript: true });
    return { success: true, component, rawCode: cleaned };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      rawCode: cleaned,
    };
  }
}
