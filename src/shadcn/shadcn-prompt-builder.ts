/**
 * shadcn/ui Prompt Builder
 *
 * Builds system + user prompts for the LLM to customize a shadcn component
 * with Figma variant styles.
 */

import type { VariantStyles, ExtractedStyle } from './style-extractor.js';
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
   - **CRITICAL: Cover ALL axis combinations.** If there are N variant values × M sizes × S states, you need compoundVariants for every combination that exists in the Figma data. Missing combinations will render with no styles. When two combinations share the same styles (e.g. all colors have the same bg/border for a given state), use an ARRAY value for that axis (e.g. \`color: ["green", "yellow", "red", "blue"]\`) to avoid duplication — but make sure every size×state is covered for each.

5. **Component structure from Figma (SOURCE OF TRUTH)**: The style data includes a \`COMPONENT TREE\` section showing the FULL Figma node tree with ACTUAL VALUES — exact colors, sizes, gaps, padding, border-radius, font sizes, icon stroke colors, etc.
   - **This tree IS the design spec. Use the exact values from it. Do NOT guess or approximate.**
   - Every node shows: \`Name(type)[dimensions, bg:#hex, border:Npx #hex, radius:Npx, pad:T/R/B/L, gap:Npx, flex-row/col]\`
   - TEXT nodes show: \`"text content" Npx weight:N font:Family color:#hex\`
   - VECTOR nodes show: \`stroke:#hex\` — this is the icon color, use it directly
   - **Replicate this exact nesting in your JSX output.** Match every container, gap, padding, and color.
   - **Alignment is in the tree**: \`items-center\`, \`justify-center\`, \`items-end\`, \`self-stretch\`, \`text-center\` etc. come directly from Figma layout data. Apply them exactly as shown.
   - **Dimensions are bounding boxes, NOT fixed sizes**: The \`WxH\` values in the tree are Figma's measured bounding box. Do NOT hardcode them as \`w-[Npx] h-[Npx]\` on every element. Use flex layout (\`flex-row\`, \`flex-col\`, \`gap-[Npx]\`, \`self-stretch\`) to let content flow naturally. Only set explicit width/height on: (1) the root component container if it has a deliberate fixed size, (2) icon/image frames that need exact dimensions, (3) elements that are clearly fixed-size (circles, avatars, toggles). For text, labels, descriptions — let them size naturally.
   - For nested sub-components (e.g. buttons inside a modal): read their bg, radius, padding, gap, shadow from the tree — do NOT use default/generic styles.
   - Elements outside the inner frame in Figma should also be outside the wrapper in JSX.
   - **Dialog/Modal/Toast**: Do NOT use \`position: fixed\` or overlay backdrop. Render as a normal inline block element so it displays correctly in a variant grid preview. Use a simple wrapper div with the exact Figma dimensions, background, border, radius, and shadow.

6. **Named text colors**: When Figma data includes label-color, placeholder-color, or error-color:
   - Use label-color for the label text styling
   - Use placeholder-color for placeholder/description text
   - Use error-color for error message text

7. **Inline SVG icons**: When SVG markup is provided for icons:
   - Inline the SVG directly in JSX (convert attributes to camelCase: stroke-width → strokeWidth, stroke-linecap → strokeLinecap, stroke-linejoin → strokeLinejoin, fill-rule → fillRule, clip-rule → clipRule, xmlns → xmlns)
   - The SVGs use \`currentColor\` for stroke/fill — they inherit color from the parent
   - Wrap each icon in \`<span style={{ color: iconColor }} className="size-4">\` where iconColor is the correct color for that variant×state
   - **Use the \`icon-color\` value from Figma styles for iconColor** — do NOT copy the text-color. If Figma data shows icon-color is the same across all states, use a single constant color
   - **Every SVG that uses \`currentColor\` MUST have a parent element with \`style={{ color: theCorrectColor }}\`**. Read the stroke/fill color from the structure tree's VECTOR node (e.g. \`stroke:#E7F7EF\`) and apply it to the wrapper. Do NOT define a color variable and then forget to use it.
   - Only swap icons between states if the Figma data explicitly shows DIFFERENT icons per state (different variant associations). Do NOT replace icons with cursor lines or other made-up elements
   - For boolean show/hide props (e.g. showLeftIcon, showRightIcon), conditionally render the icon wrapper
   - **If an icon slot/frame exists in the structure tree but NO matching exported SVG asset is listed for it, leave that slot EMPTY — do NOT fill it with an unrelated icon.** Only render an SVG in a slot if a matching asset was explicitly provided for that position. Never reuse icons from other slots (e.g. do not put a close/X icon in a button's icon slot just because it's available).

8. **Consumer component**: The .jsx file MUST:
   - Import the shadcn component from \`@/components/ui/{type}\`
   - Accept ALL CVA variant axis names as props (e.g. type, variant, size, state) plus label, title, description, disabled, onClose, and any boolean visibility props
   - **Render exactly ONE instance** of the shadcn component, passing all props through
   - **NEVER hardcode multiple instances** showing different variants — the preview system handles variant iteration externally
   - Use default export
   - Always pass onClose through (so close/dismiss buttons are visible in preview)

   Example pattern:
   \`\`\`jsx
   export default function MyComponent({ type = "default", state = "default", title, description, onClose, ...props }) {
     return <ShadcnComponent type={type} state={state} title={title} description={description} onClose={onClose} {...props} />;
   }
   \`\`\`

9. **Preserve imports**: Keep all original imports (React, Slot, cva, cn) from the base source.
   Make sure the updated component also exports the variants function (e.g. \`buttonVariants\`).

10. **Exact typography from Figma**: Use the exact font-size from Figma for EACH text element.
   - The structure tree shows distinct text nodes — each may have a different font size.
   - Title/heading text and description/body text are often different sizes (e.g. title 16px, description 14px).
   - Use Tailwind arbitrary values like \`text-[16px]\` and \`text-[14px]\` to match Figma exactly.
   - Do NOT use the same font size for all text elements unless Figma data confirms they are identical.

11. **Each variant must look visually distinct**: When the Figma component has multiple variant values (e.g. Success, Warning, Danger), each MUST render with different colors/icons as shown in the Figma data. If the background, border, or icon colors differ across variants, those differences must be reflected in CVA variant styles or compoundVariants — NOT collapsed into a single shared style.

12. **Pixel dimensions → Tailwind arbitrary values**: All dimensions in the structure tree are in \`px\`. Convert them to Tailwind arbitrary values: \`16px×16px\` → \`h-[16px] w-[16px]\`, \`gap:12px\` → \`gap-[12px]\`, \`pad:8px/16px/8px/16px\` → \`py-[8px] px-[16px]\`, \`radius:4px\` → \`rounded-[4px]\`. Do NOT drop the \`px\` unit — \`h-16\` in Tailwind means 64px, not 16px.

13. **No extra explanations** — just the two code blocks.
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
      parts.push('**IMPORTANT: Only the icon slots listed below have exported assets. If the structure tree shows additional icon frames that are NOT listed here, leave them empty — do NOT reuse icons from other slots.**');
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

// ── Single-component prompt builders (PATH B + PATH C inline) ────────────────

export interface ShadcnSingleComponentPromptContext {
  componentName: string;
  shadcnType: string;
  baseShadcnSource: string;
  style: ExtractedStyle;
  content: ExtractedContent;
  booleanProps?: Record<string, boolean>;
  assets?: IconAssetInfo[];
  nodeYaml?: string;
}

/**
 * System prompt for shadcn single-component generation (no CVA variants).
 * Simplified from the COMPONENT_SET version — no variant axis mapping.
 */
export function buildShadcnSingleComponentSystemPrompt(): string {
  return `You are a React component expert specializing in shadcn/ui.

Your task: Take a base shadcn component source and customize it with design data from a single Figma component.

## Rules

1. **Output exactly TWO fenced code blocks** — no other code blocks:
   - Block 1: Updated shadcn component (\`.tsx\`) customized with the Figma styles
   - Block 2: Consumer component (\`.jsx\`) that imports and uses the shadcn component

2. **Apply Figma styles as Tailwind arbitrary values**: Use exact hex colors, padding, font sizes, border-radius from the Figma data. E.g. \`bg-[#F04E4C]\`, \`text-[14px]\`, \`rounded-[8px]\`, \`px-[16px]\`.

3. **No CVA variants needed** — this is a single component instance, not a variant set. Keep the component simple with hardcoded Tailwind classes matching the Figma design exactly.

4. **Component structure from Figma**: Match the exact nesting, gaps, padding, colors, and typography from the design data.

5. **Preserve imports**: Keep all original imports from the base source. The updated component should export the same interface.

6. **Consumer component**: The .jsx file MUST:
   - Import the shadcn component from \`@/components/ui/{type}\`
   - Render exactly ONE instance with the appropriate props
   - Use default export

7. **Pixel dimensions → Tailwind arbitrary values**: \`16px\` → \`h-[16px]\`, \`gap:12px\` → \`gap-[12px]\`, \`pad:8px/16px\` → \`py-[8px] px-[16px]\`, \`radius:4px\` → \`rounded-[4px]\`.

8. **No extra explanations** — just the two code blocks.
`;
}

/**
 * User prompt for shadcn single-component generation.
 */
export function buildShadcnSingleComponentUserPrompt(ctx: ShadcnSingleComponentPromptContext): string {
  const parts: string[] = [];

  parts.push(`# Component: ${ctx.componentName}`);
  parts.push(`# shadcn type: ${ctx.shadcnType}`);
  parts.push('');

  // Style info
  parts.push('## Figma Styles');
  const style = ctx.style;
  const styleLines: string[] = [];
  if (style.bg) styleLines.push(`- Background: ${style.bg}`);
  if (style.textColor) styleLines.push(`- Text color: ${style.textColor}`);
  if (style.borderColor) styleLines.push(`- Border color: ${style.borderColor}`);
  if (style.borderWidth) styleLines.push(`- Border width: ${style.borderWidth}px`);
  if (style.borderRadius) styleLines.push(`- Border radius: ${style.borderRadius}px`);
  if (style.paddingTop || style.paddingRight || style.paddingBottom || style.paddingLeft) {
    styleLines.push(`- Padding: ${style.paddingTop ?? 0}px ${style.paddingRight ?? 0}px ${style.paddingBottom ?? 0}px ${style.paddingLeft ?? 0}px`);
  }
  if (style.fontSize) styleLines.push(`- Font size: ${style.fontSize}px`);
  if (style.fontWeight) styleLines.push(`- Font weight: ${style.fontWeight}`);
  if (style.gap) styleLines.push(`- Gap: ${style.gap}px`);
  if (style.width) styleLines.push(`- Width: ${style.width}px`);
  if (style.height) styleLines.push(`- Height: ${style.height}px`);
  if (style.shadow) styleLines.push(`- Shadow: ${style.shadow}`);
  if (style.opacity) styleLines.push(`- Opacity: ${style.opacity}`);
  if (style.labelColor) styleLines.push(`- Label color: ${style.labelColor}`);
  if (style.placeholderColor) styleLines.push(`- Placeholder color: ${style.placeholderColor}`);
  if (style.errorColor) styleLines.push(`- Error color: ${style.errorColor}`);
  if (style.iconColor) styleLines.push(`- Icon color: ${style.iconColor}`);
  if (style.structure) {
    styleLines.push('');
    styleLines.push('COMPONENT TREE:');
    styleLines.push(style.structure);
  }
  parts.push(styleLines.join('\n'));
  parts.push('');

  // Content
  parts.push(formatContentForPrompt(ctx.content));
  parts.push('');

  if (ctx.booleanProps && Object.keys(ctx.booleanProps).length > 0) {
    parts.push('## Boolean Properties');
    for (const [name, val] of Object.entries(ctx.booleanProps)) {
      parts.push(`- ${name}: default ${val}`);
    }
    parts.push('');
  }

  // Assets
  if (ctx.assets && ctx.assets.length > 0) {
    parts.push('## Icon Assets (inline as SVG in JSX)');
    for (const asset of ctx.assets) {
      const dims = asset.dimensions ? ` (${asset.dimensions.width}x${asset.dimensions.height})` : '';
      parts.push(`### \`${asset.filename}\`${dims}`);
      if (asset.svgContent) {
        parts.push('```svg');
        parts.push(asset.svgContent.trim());
        parts.push('```');
      }
      parts.push('');
    }
  }

  // Node YAML for structural context
  if (ctx.nodeYaml) {
    parts.push('## Node Structure (YAML)');
    parts.push('```yaml');
    parts.push(ctx.nodeYaml.trim());
    parts.push('```');
    parts.push('');
  }

  // Base source
  parts.push('## Base shadcn Component Source (customize this)');
  parts.push('```tsx');
  parts.push(ctx.baseShadcnSource);
  parts.push('```');
  parts.push('');

  parts.push('## Output Instructions');
  parts.push(`1. First code block: Updated \`${ctx.shadcnType}.tsx\` with the exact Figma styles above`);
  parts.push(`2. Second code block: Consumer \`${ctx.componentName}.jsx\` that imports from \`@/components/ui/${ctx.shadcnType}\``);
  parts.push('');
  parts.push('Remember:');
  parts.push('- Use exact hex colors from the Figma data as Tailwind arbitrary values');
  parts.push('- The consumer component must use default export');
  parts.push(`- The consumer component name is: ${ctx.componentName}`);

  return parts.join('\n');
}

/**
 * System prompt for shadcn inline-component generation (PATH C sub-components).
 * Outputs a single self-contained React JSX block (not two files).
 */
export function buildShadcnInlineComponentSystemPrompt(): string {
  return `You are a React component expert specializing in shadcn/ui patterns.

Your task: Generate a self-contained React JSX fragment for a UI component, using the shadcn template as structural guidance.

## Rules

1. **Output exactly ONE fenced code block** containing the JSX body (no export, no function wrapper).
2. **Use Tailwind arbitrary values** for exact Figma styling: \`bg-[#hex]\`, \`text-[14px]\`, \`rounded-[8px]\`.
3. **Use className** not class.
4. **Follow the shadcn template structure** but with the exact colors, sizes, and content from the Figma data.
5. **No imports needed** — the output is inlined into a parent component.
6. **Static content only** — no hooks, state, or event handlers.
7. **No extra explanations** — just the code block.
`;
}

/**
 * User prompt for shadcn inline-component generation.
 */
export function buildShadcnInlineComponentUserPrompt(
  componentName: string,
  shadcnType: string,
  baseShadcnSource: string,
  style: ExtractedStyle,
  content: ExtractedContent,
  nodeYaml?: string,
): string {
  const parts: string[] = [];

  parts.push(`# Inline component: ${componentName} (based on shadcn ${shadcnType})`);
  parts.push('');
  parts.push('Generate a self-contained JSX fragment (no function wrapper) for this component.');
  parts.push('');

  // Minimal style info
  const styleLines: string[] = ['## Figma Styles'];
  if (style.bg) styleLines.push(`- Background: ${style.bg}`);
  if (style.textColor) styleLines.push(`- Text color: ${style.textColor}`);
  if (style.borderColor) styleLines.push(`- Border: ${style.borderWidth ?? 1}px ${style.borderColor}`);
  if (style.borderRadius) styleLines.push(`- Radius: ${style.borderRadius}px`);
  if (style.fontSize) styleLines.push(`- Font size: ${style.fontSize}px`);
  if (style.fontWeight) styleLines.push(`- Font weight: ${style.fontWeight}`);
  if (style.structure) {
    styleLines.push('');
    styleLines.push('COMPONENT TREE:');
    styleLines.push(style.structure);
  }
  parts.push(styleLines.join('\n'));
  parts.push('');

  parts.push(formatContentForPrompt(content));
  parts.push('');

  if (nodeYaml) {
    parts.push('## Node Structure');
    parts.push('```yaml');
    parts.push(nodeYaml.trim());
    parts.push('```');
    parts.push('');
  }

  parts.push('## shadcn Reference (use as structural guide)');
  parts.push('```tsx');
  parts.push(baseShadcnSource);
  parts.push('```');
  parts.push('');
  parts.push('Output a single code block with self-contained JSX using Tailwind classes. No wrapper function.');

  return parts.join('\n');
}
