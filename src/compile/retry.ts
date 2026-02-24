import type { LLMProvider } from '../llm/provider.js';
import type { ParseResult } from '../types/index.js';
import { parseMitosisCode } from './parse-and-validate.js';

const MAX_RETRIES = 3;

/**
 * Generate-parse-retry loop.
 *
 * 1. Call LLM with the assembled prompt
 * 2. Parse the output through Mitosis parseJsx()
 * 3. If parsing fails, feed the error back to the LLM and retry
 * 4. After MAX_RETRIES failures, attempt one final simplified generation
 *
 * @param llm - The LLM provider to call
 * @param systemPrompt - The assembled system prompt (rules + examples)
 * @param userPrompt - The user prompt (YAML design data)
 * @param onAttempt - Optional callback for progress reporting
 */
export async function generateWithRetry(
  llm: LLMProvider,
  systemPrompt: string,
  userPrompt: string,
  onAttempt?: (attempt: number, maxRetries: number, error?: string) => void,
): Promise<ParseResult> {
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    onAttempt?.(attempt, MAX_RETRIES);

    const prompt =
      attempt === 1
        ? userPrompt
        : `${userPrompt}\n\n⚠️ Your previous output failed to compile with this error:\n${lastError}\n\nFix the issue and regenerate the complete .lite.tsx file.`;

    const code = await llm.generate(prompt, systemPrompt);
    const result = parseMitosisCode(code);

    if (result.success) {
      return result;
    }

    lastError = result.error ?? 'Unknown parse error';
    onAttempt?.(attempt, MAX_RETRIES, lastError);
  }

  // Final fallback: ask for the simplest possible component
  onAttempt?.(MAX_RETRIES + 1, MAX_RETRIES, 'Final simplified attempt');

  const finalCode = await llm.generate(
    `${userPrompt}\n\n⚠️ CRITICAL: All previous attempts failed to parse. Generate the SIMPLEST possible valid Mitosis component. Avoid advanced features. The last error was: ${lastError}`,
    systemPrompt,
  );

  return parseMitosisCode(finalCode);
}
