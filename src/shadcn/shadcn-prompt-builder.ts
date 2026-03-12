/**
 * shadcn/ui Prompt Builder
 *
 * Builds system + user prompts for the LLM to customize a shadcn component
 * with Figma variant styles.
 */

import type { VariantStyles } from './style-extractor.js';
import { formatStylesForPrompt } from './style-extractor.js';
import type { ExtractedContent } from './content-extractor.js';
import { formatContentForPrompt } from './content-extractor.js';

export interface ShadcnPromptContext {
  componentName: string;
  shadcnType: string;
  baseShadcnSource: string;
  variantStyles: VariantStyles;
  content: ExtractedContent;
  axes: Array<{ name: string; values: string[] }>;
  booleanProps?: Record<string, boolean>;
}

export function buildShadcnSystemPrompt(): string {
  return `You are a React component expert specializing in shadcn/ui and class-variance-authority (CVA).

Your task: Take a base shadcn component source and customize it with design data from Figma.

## Rules

1. **Output exactly TWO fenced code blocks** — no other code blocks:
   - Block 1: Updated shadcn component (\`.tsx\`) with CVA variants matching Figma styles
   - Block 2: Consumer component (\`.jsx\`) that imports and uses the shadcn component

2. **CVA Variants**: Add new CVA variant values for each Figma style axis value.
   - Use exact hex colors as Tailwind arbitrary values (e.g. \`bg-[#F04E4C]\`, \`text-[#FDE9E9]\`)
   - Keep all existing shadcn default variants intact
   - Add Figma variants as NEW entries in the variants object

3. **Size as CVA variant**: Add each Figma size as a CVA \`size\` variant.
   - Use exact padding, height, font-size, border-radius from Figma

4. **State as CVA variant**: Add a \`state\` variant axis with values: default, hover, focus, disabled, loading, etc.
   - Use \`compoundVariants\` to define exact colors for each style×state combination
   - Do NOT use CSS pseudo-classes (\`hover:\`, \`focus:\`) — all states must be explicit for static preview
   - Each state variant should contain the exact colors from Figma for that state
   - State names are kebab-case: "filled-in", "filled-in-hover" (not "filled in")

5. **Inner element styles**: When Figma data includes \`inner-*\` properties (inner-background, inner-border, inner-border-radius, inner-height, inner-padding-horizontal, inner-padding-vertical, inner-box-shadow), these describe the ACTUAL interactive element (e.g. input box) inside a wrapper.
   - Apply inner-background as \`bg-[#HEX]\` on the actual input/button element
   - Apply inner-border as \`border border-[#HEX]\` on the actual element
   - Apply inner-border-radius as \`rounded-[Npx]\` on the actual element
   - Apply inner-height as \`h-[Npx]\` on the actual element
   - The outer wrapper styles (background, gap, padding) go on the wrapping container

6. **Named text colors**: When Figma data includes label-color, placeholder-color, or error-color:
   - Use label-color for the label text styling
   - Use placeholder-color for placeholder/description text
   - Use error-color for error message text

7. **Consumer component**: The .jsx file should:
   - Import the shadcn component from \`@/components/ui/{type}\`
   - Accept props: variant, size, state, label, disabled, and any boolean visibility props
   - Pass all props through to the shadcn component
   - Use default export

8. **Preserve imports**: Keep all original imports (React, Slot, cva, cn) from the base source.
   Make sure the updated component also exports the variants function (e.g. \`buttonVariants\`).

9. **No extra explanations** — just the two code blocks.
`;
}

export function buildShadcnUserPrompt(ctx: ShadcnPromptContext): string {
  const parts: string[] = [];

  parts.push(`# Component: ${ctx.componentName}`);
  parts.push(`# shadcn type: ${ctx.shadcnType}`);
  parts.push('');

  parts.push('## Figma Variant Axes');
  for (const axis of ctx.axes) {
    parts.push(`- **${axis.name}**: ${axis.values.join(', ')}`);
  }
  parts.push('');

  parts.push(formatStylesForPrompt(ctx.variantStyles));
  parts.push(formatContentForPrompt(ctx.content));
  parts.push('');

  if (ctx.booleanProps && Object.keys(ctx.booleanProps).length > 0) {
    parts.push('## Boolean Properties');
    for (const [name, val] of Object.entries(ctx.booleanProps)) {
      parts.push(`- ${name}: default ${val}`);
    }
    parts.push('');
  }

  parts.push('## Base shadcn Component Source (customize this)');
  parts.push('');
  parts.push('```tsx');
  parts.push(ctx.baseShadcnSource);
  parts.push('```');
  parts.push('');

  parts.push('## Output Instructions');
  parts.push(`1. First code block: Updated \`${ctx.shadcnType}.tsx\` with CVA variants matching the Figma styles above`);
  parts.push(`2. Second code block: Consumer \`${ctx.componentName}.jsx\` that imports from \`@/components/ui/${ctx.shadcnType}\``);
  parts.push('');
  parts.push('Remember:');
  parts.push('- Use exact hex colors from the Figma data as Tailwind arbitrary values');
  parts.push('- States must be explicit CVA variants with compoundVariants, NOT CSS pseudo-classes');
  parts.push('- The consumer component must use default export');
  parts.push(`- The consumer component name is: ${ctx.componentName}`);

  return parts.join('\n');
}
