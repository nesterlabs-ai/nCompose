/**
 * React Direct Generation — LLM → React + Tailwind (no Mitosis)
 *
 * Bypasses Mitosis parseJsx() and framework compilation entirely.
 * Used when templateMode is on for PATH B (single component) and PATH C (page sections).
 */

import type { LLMProvider } from '../llm/provider.js';

export interface ReactDirectResult {
  /** Full React component source (with className, Tailwind) */
  reactCode: string;
  /** Any additional CSS that couldn't be expressed as Tailwind */
  css: string;
}

/**
 * Generate a React + Tailwind component by calling the LLM and extracting
 * the code block. No Mitosis parsing — simpler than generateWithRetry().
 *
 * Retries once on extraction failure.
 */
export async function generateReactDirect(
  llm: LLMProvider,
  systemPrompt: string,
  userPrompt: string,
): Promise<ReactDirectResult> {
  let rawResponse = await llm.generate(userPrompt, systemPrompt);
  let parsed = extractReactAndCSS(rawResponse);

  if (!parsed) {
    // Retry once with a nudge
    const retryPrompt = userPrompt +
      '\n\nIMPORTANT: Output the React component code directly (no markdown fences), followed by ---CSS--- and any additional CSS.';
    rawResponse = await llm.generate(retryPrompt, systemPrompt);
    parsed = extractReactAndCSS(rawResponse);
  }

  if (!parsed) {
    // Last resort: treat the whole response as React code
    return { reactCode: rawResponse.trim(), css: '' };
  }

  return parsed;
}

/**
 * Extract React code and CSS from LLM output.
 *
 * Handles two formats:
 * 1. Raw output with ---CSS--- delimiter (preferred — matches system prompt)
 * 2. Fenced code blocks (fallback if LLM wraps in markdown)
 */
function extractReactAndCSS(raw: string): ReactDirectResult | null {
  // Format 1: ---CSS--- delimiter (same as Mitosis pipeline)
  const cssSplit = raw.split('---CSS---');
  if (cssSplit.length >= 2) {
    const reactCode = stripMarkdownFences(cssSplit[0]).trim();
    const css = stripMarkdownFences(cssSplit.slice(1).join('---CSS---')).trim();
    if (reactCode.length > 20) {
      return { reactCode, css };
    }
  }

  // Format 2: Fenced code blocks
  const codeBlockRegex = /```(?:tsx?|jsx?|typescript|javascript)?\s*\n([\s\S]*?)```/g;
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(raw)) !== null) {
    const content = match[1].trim();
    if (content.length > 0) blocks.push(content);
  }

  if (blocks.length >= 1) {
    const reactCode = blocks[0];
    const css = blocks.length >= 2 ? blocks[1] : '';
    return { reactCode, css };
  }

  return null;
}

/**
 * Strip markdown code fences from a string.
 */
function stripMarkdownFences(code: string): string {
  return code
    .replace(/^```(?:tsx?|jsx?|typescript|javascript|css)?\s*\n?/gm, '')
    .replace(/```\s*$/gm, '')
    .trim();
}
