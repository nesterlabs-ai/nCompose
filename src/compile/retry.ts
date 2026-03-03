import type { LLMProvider } from '../llm/provider.js';
import type { ParseResult } from '../types/index.js';
import { parseMitosisCode } from './parse-and-validate.js';
import { validateAccessibility } from './a11y-validate.js';
import { validateBEMConsistency } from './bem-validate.js';
import { getExpectedElement, validateSemanticElement } from './semantic-validate.js';
import { validateLayoutFidelity } from './layout-fidelity-validate.js';
import { validateTextFidelity } from './text-fidelity-validate.js';
import { config } from '../config.js';

const MAX_RETRIES = config.generation.maxRetries;

interface ValidationSummary {
  blocking: string[];
  advisory: string[];
}

/** Rough token estimate: ~3.5 chars per token for mixed YAML/code content. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * Scale output token budget based on input complexity.
 * Large designs need more output tokens for the generated code.
 * Returns at least the provider's configured maxOutputTokens, up to a cap.
 */
function scaleOutputTokens(userPromptChars: number, baseMax: number): number {
  // Heuristic: ~1 output token per 8 input chars, minimum baseMax
  const estimated = Math.ceil(userPromptChars / 8);
  // Cap at 4x the base to stay within provider limits
  const cap = baseMax * 4;
  return Math.min(Math.max(estimated, baseMax), cap);
}

/**
 * Truncate the user prompt to fit within the LLM's context window.
 * Cuts the YAML content (the bulk of the prompt) while preserving the
 * instruction text before and after. Looks for the ```yaml fence to
 * identify where design data starts, and truncates within that block.
 */
function truncateToFit(
  userPrompt: string,
  systemPrompt: string,
  contextWindow: number,
  maxOutputTokens: number,
): string {
  const inputBudget = contextWindow - maxOutputTokens;
  const systemTokens = estimateTokens(systemPrompt);
  const userTokens = estimateTokens(userPrompt);

  if (systemTokens + userTokens <= inputBudget) {
    return userPrompt; // Fits — no truncation needed
  }

  const availableUserTokens = inputBudget - systemTokens;
  // Convert back to chars (with small safety margin)
  const maxUserChars = Math.floor(availableUserTokens * 3.5) - 200;

  if (maxUserChars <= 0) {
    return userPrompt; // System prompt alone exceeds budget — send anyway and let API error
  }

  // Try to find the yaml code fence to truncate intelligently
  const yamlStart = userPrompt.indexOf('```yaml\n');
  const yamlEnd = userPrompt.lastIndexOf('\n```');

  if (yamlStart !== -1 && yamlEnd > yamlStart) {
    // We have a yaml block — truncate within it
    const before = userPrompt.slice(0, yamlStart + '```yaml\n'.length);
    const after = userPrompt.slice(yamlEnd);
    const yamlContent = userPrompt.slice(yamlStart + '```yaml\n'.length, yamlEnd);

    const availableForYaml = maxUserChars - before.length - after.length - 100;
    if (availableForYaml > 0 && availableForYaml < yamlContent.length) {
      // Truncate YAML at the last complete line within budget
      const truncated = yamlContent.slice(0, availableForYaml);
      const lastNewline = truncated.lastIndexOf('\n');
      const cleanCut = lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated;
      return before + cleanCut + '\n# [TRUNCATED — remaining design layers omitted to fit context window]\n' + after;
    }
  }

  // Fallback: simple character truncation
  const truncated = userPrompt.slice(0, maxUserChars);
  const lastNewline = truncated.lastIndexOf('\n');
  return (lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated) +
    '\n\n[... DESIGN DATA TRUNCATED to fit context window ...]';
}

async function validateGeneratedOutput(
  code: string,
  parseResult: ParseResult,
  css?: string,
  componentCategory?: string,
  expectedTextLiterals?: string[],
  enforceLayoutFidelity?: boolean,
): Promise<ValidationSummary> {
  const blocking: string[] = [];
  const advisory: string[] = [];

  // Accessibility issues are advisory for now.
  try {
    const a11yResult = await validateAccessibility(code);
    if (!a11yResult.passed && a11yResult.summary) {
      advisory.push(a11yResult.summary);
    }
  } catch {
    // Don't block on a11y validator runtime issues
  }

  // BEM consistency directly affects style fidelity, treat as blocking.
  const cssForValidation = css || parseResult.css;
  if (cssForValidation) {
    try {
      const bemResult = validateBEMConsistency(parseResult.rawCode, cssForValidation);
      if (!bemResult.passed && bemResult.summary) {
        blocking.push(bemResult.summary);
      }
    } catch {
      // Don't fail hard if validator itself crashes
    }
  }

  // Deterministic layout fidelity: class coverage + no inline sizing overrides.
  if (enforceLayoutFidelity && cssForValidation) {
    try {
      const layoutResult = validateLayoutFidelity(parseResult.rawCode, cssForValidation, {
        minimumElementCoverage: config.fidelity.minLayoutCoverage,
        forbidInlineSizing: config.fidelity.forbidInlineSizing,
      });
      if (!layoutResult.passed && layoutResult.summary) {
        blocking.push(layoutResult.summary);
      }
    } catch {
      // Don't fail hard if validator itself crashes
    }
  }

  // Semantic element correctness is blocking.
  if (componentCategory) {
    try {
      const expected = getExpectedElement(componentCategory);
      if (expected) {
        const semanticResult = validateSemanticElement(parseResult.rawCode, expected);
        if (!semanticResult.passed && semanticResult.summary) {
          blocking.push(semanticResult.summary);
        }
      }
    } catch {
      // Don't fail hard if validator itself crashes
    }
  }

  // Text copy fidelity is blocking when expected literals are known.
  if (expectedTextLiterals && expectedTextLiterals.length > 0) {
    try {
      const textResult = validateTextFidelity(parseResult.rawCode, expectedTextLiterals);
      if (!textResult.passed && textResult.summary) {
        blocking.push(textResult.summary);
      }
    } catch {
      // Don't fail hard if validator itself crashes
    }
  }

  return { blocking, advisory };
}

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
 * @param expectedRootTag - Optional expected root HTML tag for auto-fix + validation
 * @param componentCategory - Optional component category for semantic validation
 * @param expectedTextLiterals - Optional expected text literals from Figma for placeholder checks
 * @param enforceLayoutFidelity - Enforce deterministic class coverage + no inline sizing overrides
 */
export async function generateWithRetry(
  llm: LLMProvider,
  systemPrompt: string,
  userPrompt: string,
  onAttempt?: (attempt: number, maxRetries: number, error?: string) => void,
  css?: string,
  expectedRootTag?: string,
  componentCategory?: string,
  expectedTextLiterals?: string[],
  enforceLayoutFidelity?: boolean,
): Promise<ParseResult> {
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    onAttempt?.(attempt, MAX_RETRIES);

    const rawPrompt =
      attempt === 1
        ? userPrompt
        : `${userPrompt}\n\n⚠️ Your previous output failed with this error:\n${lastError}\n\nFix the issue and regenerate the complete .lite.tsx file.`;

    // Scale output budget for complex components, then truncate input to fit
    const outputBudget = scaleOutputTokens(rawPrompt.length, llm.maxOutputTokens);
    const prompt = truncateToFit(rawPrompt, systemPrompt, llm.contextWindow, outputBudget);

    const code = await llm.generate(prompt, systemPrompt);
    const result = parseMitosisCode(code, expectedRootTag);

    if (!result.success) {
      lastError = result.error ?? 'Unknown parse error';
      onAttempt?.(attempt, MAX_RETRIES, lastError);
      continue;
    }

    const validation = await validateGeneratedOutput(
      code,
      result,
      css,
      componentCategory,
      expectedTextLiterals,
      enforceLayoutFidelity,
    );
    const allErrors = [...validation.blocking, ...validation.advisory];

    // If no validation errors, return success
    if (allErrors.length === 0) {
      return result;
    }

    // Validation failed — feed errors back for retry (but only if we have retries left)
    if (attempt < MAX_RETRIES) {
      lastError = allErrors.join('\n\n');
      onAttempt?.(
        attempt,
        MAX_RETRIES,
        `Validation: ${validation.blocking.length} blocking, ${validation.advisory.length} advisory issue(s)`,
      );
    } else {
      if (config.generation.strictValidation && validation.blocking.length > 0) {
        return {
          success: false,
          error: `Quality gates failed after ${MAX_RETRIES} attempts:\n\n${validation.blocking.join('\n\n')}`,
          rawCode: result.rawCode,
          css: result.css,
        };
      }
      return result;
    }
  }

  // Final fallback: ask for the simplest possible component
  onAttempt?.(MAX_RETRIES + 1, MAX_RETRIES, 'Final simplified attempt');

  const finalRawPrompt = `${userPrompt}\n\n⚠️ CRITICAL: All previous attempts failed to parse. Generate the SIMPLEST possible valid Mitosis component. Avoid advanced features. The last error was: ${lastError}`;
  const finalOutputBudget = scaleOutputTokens(finalRawPrompt.length, llm.maxOutputTokens);
  const finalPrompt = truncateToFit(finalRawPrompt, systemPrompt, llm.contextWindow, finalOutputBudget);
  const finalCode = await llm.generate(finalPrompt, systemPrompt);
  const finalResult = parseMitosisCode(finalCode, expectedRootTag);
  if (!finalResult.success) {
    return finalResult;
  }

  const finalValidation = await validateGeneratedOutput(
    finalCode,
    finalResult,
    css,
    componentCategory,
    expectedTextLiterals,
    enforceLayoutFidelity,
  );
  if (config.generation.strictValidation && finalValidation.blocking.length > 0) {
    return {
      success: false,
      error: `Quality gates failed on final fallback:\n\n${finalValidation.blocking.join('\n\n')}`,
      rawCode: finalResult.rawCode,
      css: finalResult.css,
    };
  }

  return finalResult;
}
