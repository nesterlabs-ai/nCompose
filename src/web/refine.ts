/**
 * Refinement engine — iterative chat-based component refinement.
 *
 * Takes the current Mitosis source + CSS, a user prompt describing changes,
 * and the conversation history. Calls the LLM with multi-turn context,
 * then parses/validates and recompiles to all target frameworks.
 */

import type { LLMProvider, LLMMessage } from '../llm/provider.js';
import type { Framework } from '../types/index.js';
import { parseMitosisCode } from '../compile/parse-and-validate.js';
import { generateFrameworkCode } from '../compile/generate.js';
import { injectCSS } from '../compile/inject-css.js';
import { assembleSystemPrompt } from '../prompt/assemble.js';

export interface RefinementResult {
  mitosisSource: string;
  css: string;
  frameworkOutputs: Record<string, string>;
  assistantMessage: string;
}

const REFINEMENT_ADDENDUM = `
You are refining an existing Mitosis component based on user instructions.

RULES:
1. Output the COMPLETE updated .lite.tsx file — not a diff or partial snippet.
2. Preserve all existing functionality unless the user asks to change it.
3. Follow all Mitosis rules (use \`class\` not \`className\`, \`css={{}}\` values must be plain string literals, etc.).
4. If the component has a CSS section (delimited by \`---CSS---\`), output the updated CSS after the delimiter.
5. Keep the same component name and export structure.
6. Only make changes that the user explicitly requested.
`.trim();

/**
 * Refine a component based on user instructions.
 *
 * @param options.currentMitosis - Current .lite.tsx source code
 * @param options.currentCSS - Current extracted CSS (may be empty)
 * @param options.userPrompt - User's refinement instruction
 * @param options.conversation - Prior conversation messages (for multi-turn context)
 * @param options.llmProvider - LLM provider to use
 * @param options.frameworks - Target frameworks to compile to
 * @param options.componentName - Component name
 * @param options.onStep - Progress callback
 */
export async function refineComponent(options: {
  currentMitosis: string;
  currentCSS: string;
  userPrompt: string;
  conversation: LLMMessage[];
  llmProvider: LLMProvider;
  frameworks: Framework[];
  componentName: string;
  onStep?: (step: string) => void;
}): Promise<RefinementResult> {
  const {
    currentMitosis,
    currentCSS,
    userPrompt,
    conversation,
    llmProvider,
    frameworks,
    componentName,
    onStep,
  } = options;

  // Build the system prompt: base Mitosis rules + refinement addendum
  const baseSystem = assembleSystemPrompt();
  const systemPrompt = `${baseSystem}\n\n## Refinement Mode\n\n${REFINEMENT_ADDENDUM}`;

  // Build messages array for multi-turn call
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
  ];

  // Include prior conversation turns (skip any system messages from history)
  for (const msg of conversation) {
    if (msg.role !== 'system') {
      messages.push(msg);
    }
  }

  // Build the new user message with current code context
  const codeContext = currentCSS
    ? `${currentMitosis}\n---CSS---\n${currentCSS}`
    : currentMitosis;

  const newUserMessage = `Here is the current component code:

\`\`\`tsx
${codeContext}
\`\`\`

User request: ${userPrompt}

Output the COMPLETE updated .lite.tsx file. If the component uses a CSS section (---CSS---), include the updated CSS after the delimiter.`;

  messages.push({ role: 'user', content: newUserMessage });

  // Call LLM
  onStep?.('Sending refinement to LLM...');
  let llmOutput: string;
  try {
    llmOutput = await llmProvider.generateMultiTurn(messages);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`LLM refinement failed: ${msg}`);
  }

  // Parse through Mitosis
  onStep?.('Parsing updated component...');
  let parseResult = parseMitosisCode(llmOutput);

  // Lightweight retry: if parse fails, feed error back and retry once
  if (!parseResult.success && parseResult.error) {
    onStep?.('Parse failed, retrying with error feedback...');
    const retryMessages: LLMMessage[] = [
      ...messages,
      { role: 'assistant', content: llmOutput },
      {
        role: 'user',
        content: `The code you generated failed to parse with this error:\n\n${parseResult.error}\n\nPlease fix the issue and output the COMPLETE corrected .lite.tsx file.`,
      },
    ];

    try {
      llmOutput = await llmProvider.generateMultiTurn(retryMessages);
      parseResult = parseMitosisCode(llmOutput);
    } catch {
      // Keep original parse failure
    }
  }

  if (!parseResult.success || !parseResult.component) {
    throw new Error(`Failed to parse refined component: ${parseResult.error || 'Unknown parse error'}`);
  }

  // Generate framework code
  onStep?.('Compiling to frameworks...');
  const frameworkOutputs = generateFrameworkCode(parseResult.component, frameworks);

  // Inject CSS if present
  const css = parseResult.css || '';
  if (css) {
    for (const fw of frameworks) {
      if (frameworkOutputs[fw] && !frameworkOutputs[fw].startsWith('// Error')) {
        frameworkOutputs[fw] = injectCSS(frameworkOutputs[fw], css, fw);
      }
    }
  }

  // Build the final Mitosis source (JSX + CSS if any)
  const mitosisSource = css
    ? `${parseResult.rawCode}\n---CSS---\n${css}`
    : parseResult.rawCode;

  return {
    mitosisSource,
    css,
    frameworkOutputs,
    assistantMessage: llmOutput,
  };
}
