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
import { injectDataVeIds } from '../compile/element-mapping.js';
import { assembleSystemPrompt } from '../prompt/assemble.js';

export interface RefinementResult {
  mitosisSource: string;
  css: string;
  frameworkOutputs: Record<string, string>;
  assistantMessage: string;
  /** Element-to-code map for visual edit (updated after refinement) */
  elementMap?: Record<string, { path: string; tagName: string; textContent?: string; className?: string; id?: string; insideLoop?: boolean }>;
}

/** Selected element context from preview (when user clicks in visual edit mode). */
export interface SelectedElementContext {
  dataVeId?: string | null;
  tagName?: string;
  textContent?: string;
  className?: string;
  id?: string;
  /** When inside variant grid: label like "Focused / Default" */
  variantLabel?: string | null;
  /** When inside variant grid: props that identify this variant (e.g. { variant: 'focused', state: 'default' }) */
  variantProps?: Record<string, string> | null;
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
  /** When refining from visual edit click, provides element targeting context */
  selectedElement?: SelectedElementContext;
  /** Element map for resolving dataVeId to metadata (from session) */
  elementMap?: Record<string, { path: string; tagName: string; textContent?: string; className?: string; id?: string; insideLoop?: boolean }>;
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
    selectedElement,
    elementMap,
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

  // Enrich prompt with element targeting context when available (from visual edit)
  let elementContextBlock = '';
  const hasDataVeId = selectedElement?.dataVeId && elementMap?.[selectedElement.dataVeId];

  if (hasDataVeId) {
    const entry = elementMap[selectedElement.dataVeId!];
    // Prefer runtime textContent (from the actual clicked DOM element) over static elementMap text
    const displayText = selectedElement.textContent || entry.textContent;
    elementContextBlock += `

IMPORTANT - Element targeting: The user selected a specific element in the preview (data-ve-id="${selectedElement.dataVeId}").
- Tag: <${entry.tagName}>
- Path in component tree: ${entry.path}
${entry.className ? `- className: ${entry.className}` : ''}
${displayText ? `- Current text: "${displayText}"` : ''}`;

    // Sibling disambiguation — help LLM distinguish among same-tag siblings
    const parentPath = entry.path.includes('-')
      ? entry.path.substring(0, entry.path.lastIndexOf('-')) : '';
    if (parentPath && elementMap) {
      const siblings = Object.values(elementMap).filter(
        e => e.path.startsWith(parentPath + '-') &&
        e.path.split('-').length === entry.path.split('-').length &&
        e.tagName === entry.tagName
      );
      if (siblings.length > 1) {
        const position = siblings.findIndex(s => s.path === entry.path) + 1;
        elementContextBlock += `\n- Position: ${ordinal(position)} <${entry.tagName}> among ${siblings.length} sibling <${entry.tagName}> elements`;
        const sibTexts = siblings.filter(s => s.path !== entry.path && s.textContent)
          .map(s => `"${s.textContent}"`);
        if (sibTexts.length > 0) {
          elementContextBlock += ` (other siblings: ${sibTexts.join(', ')})`;
        }
      }
    }

    // Warn when element is inside a <For> loop — multiple DOM instances share the same ID
    if (entry.insideLoop) {
      elementContextBlock += `\n- NOTE: This element is inside a <For> loop. Apply the change to the loop template so ALL iterations are affected.`;
    }
  }

  // Variant-specific: user clicked inside ONE variant in the grid — change must apply ONLY to that variant
  if (selectedElement?.variantLabel && selectedElement?.variantProps && Object.keys(selectedElement.variantProps).length > 0) {
    const propsDesc = Object.entries(selectedElement.variantProps)
      .map(([k, v]) => `${k}="${v}"`)
      .join(', ');
    const normalizedHint = Object.entries(selectedElement.variantProps)
      .map(([k, v]) => {
        const norm = String(v).trim().toLowerCase().replace(/\\s+/g, '-');
        return `${k}==='${norm}'`;
      })
      .join(' && ');
    elementContextBlock += `

CRITICAL - Variant-specific change: The user selected this element inside ONE variant only (labeled "${selectedElement.variantLabel}").
The preview grid shows multiple variants. You MUST add conditional logic so the change applies ONLY when the component receives these variant props.
Props from selection: ${propsDesc}. Use normalized values for comparison (e.g. ${normalizedHint}).
Render the new content ONLY when the condition matches. For ALL other variants, keep the original content unchanged.`;
  } else if (hasDataVeId) {
    elementContextBlock += `
CRITICAL: Apply the requested change ONLY to THIS specific element (data-ve-id="${selectedElement.dataVeId}"). Do NOT modify any other elements in the component. Every other element must remain exactly as-is.`;
  }

  const isShadcn = currentMitosis.includes('shadcn/ui codegen');

  let newUserMessage = `Here is the current component code:

\`\`\`tsx
${codeContext}
\`\`\`

User request: ${userPrompt}${elementContextBlock}

`;
  if (isShadcn) {
    newUserMessage += `This is a shadcn/ui React component (NOT a Mitosis component). Output the COMPLETE updated React file. Do NOT use Mitosis syntax (like state.classes or css={{}}). Preserve the // shadcn/ui codegen comment at the top.`;
  } else {
    newUserMessage += `Output the COMPLETE updated .lite.tsx file. If the component uses a CSS section (---CSS---), include the updated CSS after the delimiter.`;
  }

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

  // --- Shadcn Fast Path ---
  if (isShadcn) {
    onStep?.('Updating shadcn/ui React code directly...');
    // Extract code block from markdown
    const codeMatch = llmOutput.match(/```(?:tsx|jsx|js|ts)?\s*([\s\S]*?)```/);
    const rawReactCode = codeMatch ? codeMatch[1].trim() : llmOutput.trim();
    
    // Ensure header is present for future refinement detection
    const mitosisSource = rawReactCode.includes('shadcn/ui codegen') 
      ? rawReactCode 
      : `// shadcn/ui codegen — see React output.\n${rawReactCode}`;

    const frameworkOutputs: Record<string, string> = {};
    for (const fw of frameworks) {
      frameworkOutputs[fw] = fw === 'react' ? rawReactCode : `// shadcn/ui component (React only).\n`;
    }

    return {
      mitosisSource,
      css: '', // shadcn components use inline tailwind, no custom css
      frameworkOutputs,
      assistantMessage: llmOutput,
      elementMap, // Preserve existing map since we bypassed Mitosis tree mapping
    };
  }
  // --- Standard Mitosis Path ---

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

  // Inject element IDs for visual edit, then generate framework code
  onStep?.('Compiling to frameworks...');
  const { component: componentWithIds, elementMap: newElementMap } = injectDataVeIds(parseResult.component);
  const frameworkOutputs = generateFrameworkCode(componentWithIds, frameworks);

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
    elementMap: newElementMap,
  };
}

/** Convert a 1-based number to its ordinal string (1st, 2nd, 3rd, …). */
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
