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

export interface IconAssetInfo {
  filename: string;
  parentName?: string;
  variants?: string[];
  dimensions?: { width: number; height: number };
  /** SVG markup with currentColor (for inline rendering) */
  svgContent?: string;
}

export interface ShadcnPromptContext {
  componentName: string;
  shadcnType: string;
  baseShadcnSource: string;
  variantStyles: VariantStyles;
  content: ExtractedContent;
  axes: Array<{ name: string; values: string[] }>;
  booleanProps?: Record<string, boolean>;
  assets?: IconAssetInfo[];
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

5. **Component structure from Figma**: The style data includes a \`structure:\` field showing the actual Figma component tree — which elements are children of which containers, and what traits each container has (border, bg, rounded, padding, flex direction).
   - **Replicate this exact nesting in your JSX output.** If Figma shows an icon and text INSIDE a bordered frame, your JSX must also put the icon and input inside a bordered wrapper div.
   - Apply inner-* styles (inner-background, inner-border, inner-border-radius, inner-padding) on the wrapper div that matches the Figma frame with those traits.
   - The actual \`<input>\` element should be unstyled (transparent bg, no border) and fill the remaining space.
   - Elements outside the inner frame in Figma (e.g. error text) should also be outside the bordered wrapper in JSX.

6. **Named text colors**: When Figma data includes label-color, placeholder-color, or error-color:
   - Use label-color for the label text styling
   - Use placeholder-color for placeholder/description text
   - Use error-color for error message text

7. **Inline SVG icons**: When SVG markup is provided for icons:
   - Inline the SVG directly in JSX (convert attributes to camelCase: stroke-width → strokeWidth, stroke-linecap → strokeLinecap, stroke-linejoin → strokeLinejoin, fill-rule → fillRule, clip-rule → clipRule, xmlns → xmlns)
   - The SVGs use \`currentColor\` for stroke/fill — they inherit color from the parent
   - Wrap each icon in \`<span style={{ color: iconColor }} className="size-4">\` where iconColor is the correct color for that variant×state
   - **Use the \`icon-color\` value from Figma styles for iconColor** — do NOT copy the text-color. If Figma data shows icon-color is the same across all states, use a single constant color
   - Only swap icons between states if the Figma data explicitly shows DIFFERENT icons per state (different variant associations). Do NOT replace icons with cursor lines or other made-up elements
   - For boolean show/hide props (e.g. showLeftIcon, showRightIcon), conditionally render the icon wrapper

8. **Consumer component**: The .jsx file should:
   - Import the shadcn component from \`@/components/ui/{type}\`
   - Accept props: variant, size, state, label, disabled, and any boolean visibility props
   - Pass all props through to the shadcn component
   - Use default export

9. **Preserve imports**: Keep all original imports (React, Slot, cva, cn) from the base source.
   Make sure the updated component also exports the variants function (e.g. \`buttonVariants\`).

10. **No extra explanations** — just the two code blocks.
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

  // Include icon asset information with inline SVG content
  if (ctx.assets && ctx.assets.length > 0) {
    parts.push('## Icon Assets (from Figma — inline these as SVG in JSX)');
    parts.push('');

    for (const asset of ctx.assets) {
      const dims = asset.dimensions ? ` (${asset.dimensions.width}×${asset.dimensions.height})` : '';
      const variants = asset.variants && asset.variants.length > 0
        ? ` — appears in variants: ${asset.variants.join(', ')}`
        : '';
      const position = asset.parentName ? ` [position: ${asset.parentName}]` : '';
      parts.push(`### \`${asset.filename}\`${dims}${position}${variants}`);
      if (asset.svgContent) {
        parts.push('SVG markup (uses currentColor — inherits from parent color):');
        parts.push('```svg');
        parts.push(asset.svgContent.trim());
        parts.push('```');
      }
      parts.push('');
    }

    // Group by position to help LLM understand icon slots
    const byPosition = new Map<string, IconAssetInfo[]>();
    for (const asset of ctx.assets) {
      const pos = asset.parentName || 'icon';
      if (!byPosition.has(pos)) byPosition.set(pos, []);
      byPosition.get(pos)!.push(asset);
    }

    if (byPosition.size > 0) {
      parts.push('### Icon Slot Mapping');
      parts.push('Wrap each icon slot in `<span style={{ color: iconColor }}>` — the SVG inherits color via currentColor.');
      parts.push('Use the `icon-color` from the Figma style data for each state. If icon-color is the same across all states, use that constant color.');
      parts.push('');
      for (const [position, posAssets] of byPosition) {
        if (posAssets.length === 1) {
          parts.push(`- **${position}**: Always show the \`${posAssets[0].filename}\` SVG inline`);
        } else {
          const sorted = [...posAssets].sort((a, b) => (b.variants?.length ?? 0) - (a.variants?.length ?? 0));
          const defaultIcon = sorted[0];
          const stateIcons = sorted.slice(1);
          parts.push(`- **${position}**:`);
          parts.push(`  - Default: inline \`${defaultIcon.filename}\` SVG${defaultIcon.variants ? ` (${defaultIcon.variants.join(', ')})` : ''}`);
          for (const si of stateIcons) {
            const stateHints = si.variants?.map((v: string) => {
              const vParts = v.split('/');
              return vParts.length > 1 ? vParts[1] : v;
            }).filter((v: string, i: number, arr: string[]) => arr.indexOf(v) === i) ?? [];
            parts.push(`  - When state is ${stateHints.join(' or ')}: swap to \`${si.filename}\` SVG${si.variants ? ` (${si.variants.join(', ')})` : ''}`);
          }
        }
      }
      parts.push('');
    }
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
  if (ctx.assets && ctx.assets.length > 0) {
    parts.push('- Inline SVG markup directly in JSX — do NOT use <img> tags');
    parts.push('- Wrap icons in <span style={{ color: iconColor }}> so currentColor works');
    parts.push('- Use the icon-color from Figma style data for iconColor (NOT text-color). If icon-color is the same across all states, use a constant');
    parts.push('- Only swap icons between states if Figma data shows different icons per state — do NOT invent cursor lines or other replacements');
  }

  return parts.join('\n');
}
