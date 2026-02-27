import type { LLMProvider } from '../llm/provider.js';
import type { ParseResult } from '../types/index.js';
import { parseMitosisCode } from './parse-and-validate.js';
import { validateAccessibility } from './a11y-validate.js';
import { validateBEMConsistency } from './bem-validate.js';

const MAX_RETRIES = 3;

/**
 * Generate-parse-retry loop with accessibility and BEM validation.
 *
 * 1. Call LLM with the assembled prompt
 * 2. Parse the output through Mitosis parseJsx()
 * 3. Run axe-core accessibility validation on the parsed output
 * 4. Run BEM class name consistency check
 * 5. If any check fails, feed errors back to the LLM and retry
 * 6. After MAX_RETRIES failures, attempt one final simplified generation
 *
 * @param llm - The LLM provider to call
 * @param systemPrompt - The assembled system prompt (rules + examples)
 * @param userPrompt - The user prompt (YAML design data)
 * @param onAttempt - Optional callback for progress reporting
 * @param css - Optional CSS string for BEM validation
 */
export async function generateWithRetry(
  llm: LLMProvider,
  systemPrompt: string,
  userPrompt: string,
  onAttempt?: (attempt: number, maxRetries: number, error?: string) => void,
  css?: string,
): Promise<ParseResult> {
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    onAttempt?.(attempt, MAX_RETRIES);

    const prompt =
      attempt === 1
        ? userPrompt
        : `${userPrompt}\n\n⚠️ Your previous output failed with this error:\n${lastError}\n\nFix the issue and regenerate the complete .lite.tsx file.`;

    const code = await llm.generate(prompt, systemPrompt);
    const result = parseMitosisCode(code);

    if (!result.success) {
      lastError = result.error ?? 'Unknown parse error';
      onAttempt?.(attempt, MAX_RETRIES, lastError);
      continue;
    }

    // Mitosis parse succeeded — now run post-generation validation
    const validationErrors: string[] = [];

    // Accessibility validation (axe-core)
    try {
      const a11yResult = await validateAccessibility(code);
      if (!a11yResult.passed && a11yResult.summary) {
        validationErrors.push(a11yResult.summary);
      }
    } catch {
      // Don't block on a11y validation failures
    }

    // BEM class name consistency validation
    // Use provided CSS (PATH A) or extracted CSS from LLM output (PATH B)
    const cssForValidation = css || result.css;
    if (cssForValidation) {
      try {
        const bemResult = validateBEMConsistency(result.rawCode, cssForValidation);
        if (!bemResult.passed && bemResult.summary) {
          validationErrors.push(bemResult.summary);
        }
      } catch {
        // Don't block on BEM validation failures
      }
    }

    // If no validation errors, return success
    if (validationErrors.length === 0) {
      return result;
    }

    // Validation failed — feed errors back for retry (but only if we have retries left)
    if (attempt < MAX_RETRIES) {
      lastError = validationErrors.join('\n\n');
      onAttempt?.(attempt, MAX_RETRIES, `Validation: ${validationErrors.length} issue(s)`);
    } else {
      // On the last attempt, return the result even with validation warnings
      // (better to have a working component with a11y issues than no component)
      return result;
    }
  }

  // Final fallback: ask for the simplest possible component
  onAttempt?.(MAX_RETRIES + 1, MAX_RETRIES, 'Final simplified attempt');

  const finalCode = await llm.generate(
    `${userPrompt}\n\n⚠️ CRITICAL: All previous attempts failed to parse. Generate the SIMPLEST possible valid Mitosis component. Avoid advanced features. The last error was: ${lastError}`,
    systemPrompt,
  );

  return parseMitosisCode(finalCode);
}
