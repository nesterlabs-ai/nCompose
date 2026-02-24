import { loadSystemPrompt } from './system-prompt.js';
import { loadFewShotExamples } from './few-shot-examples.js';

/**
 * Assembles the full system prompt by combining:
 * 1. The base system prompt (Mitosis rules, styling mappings, semantic mapping)
 * 2. Few-shot examples (input/output pairs)
 *
 * This is passed as the system/instruction message to the LLM.
 */
export function assembleSystemPrompt(): string {
  const base = loadSystemPrompt();
  const examples = loadFewShotExamples();

  return `${base}

## Few-Shot Examples

${examples}`;
}

/**
 * Assembles the user prompt from the simplified Figma YAML.
 * Wraps the YAML in clear delimiters so the LLM knows where
 * design data starts and ends.
 *
 * @param yamlContent - The simplified Figma design as a YAML string
 * @param componentName - Optional component name hint
 */
export function assembleUserPrompt(
  yamlContent: string,
  componentName?: string,
): string {
  const nameHint = componentName
    ? `\nComponent name: ${componentName}\n`
    : '';

  return `Convert the following Figma design to a Mitosis component (.lite.tsx):
${nameHint}
\`\`\`yaml
${yamlContent.trim()}
\`\`\``;
}
