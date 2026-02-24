/**
 * Builds dynamic prompts for the LLM to generate a Mitosis component
 * from a COMPONENT_SET. Works for any component type — buttons, inputs,
 * cards, badges, toggles, etc.
 *
 * The LLM receives:
 * 1. The actual child structure extracted from the default variant
 * 2. Dynamic axes/props derived from the component set data
 * 3. A generic system prompt with no component-specific assumptions
 * 4. Optionally, a YAML snippet of the default variant's tree
 */

import type { ComponentSetData, ClassifiedState } from './component-set-parser.js';
import type { AssetEntry } from './asset-export.js';
import { toKebabCase } from './component-set-parser.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VariantPromptData {
  componentName: string;
  baseClass: string;
  /** Inferred semantic HTML element, e.g. "button", "div", "input" */
  elementType: string;
  /** Variant axes (excluding state) with values and defaults */
  axes: { name: string; values: string[]; default: string }[];
  /** Props the component should accept */
  props: { name: string; type: string; default: string }[];
  /** Human-readable description of the default variant's structure */
  structure: string;
  /** CSS class naming convention */
  classNaming: string;
  /** State info derived from the state axis */
  stateInfo: {
    stateValues: string[];
    booleanProps: string[];
    classifiedStates: ClassifiedState[];
  } | null;
  /** Asset entries with variant tracking */
  assets?: AssetEntry[];
}

// ---------------------------------------------------------------------------
// Element type inference
// ---------------------------------------------------------------------------

/**
 * Infers the semantic HTML element from the component name and structure.
 * Returns the appropriate tag name.
 */
function inferElementType(componentName: string, _node?: any): string {
  const lower = componentName.toLowerCase();
  if (lower.includes('button') || lower.includes('btn') || lower.includes('cta')) return 'button';
  if (lower.includes('textarea')) return 'textarea';
  if (lower.includes('input') || lower.includes('textfield') || lower.includes('text-field') || lower.includes('text field')) return 'div';
  if (lower.includes('select') || lower.includes('dropdown')) return 'div';
  if (lower.includes('checkbox')) return 'label';
  if (lower.includes('radio')) return 'label';
  if (lower.includes('toggle') || lower.includes('switch')) return 'button';
  if (lower.includes('link') || lower.includes('anchor')) return 'a';
  if (lower.includes('badge') || lower.includes('chip') || lower.includes('tag') || lower.includes('pill')) return 'span';
  if (lower.includes('card')) return 'article';
  if (lower.includes('alert') || lower.includes('toast') || lower.includes('banner')) return 'div';
  if (lower.includes('nav')) return 'nav';
  if (lower.includes('tab')) return 'button';
  if (lower.includes('avatar')) return 'div';
  if (lower.includes('tooltip')) return 'div';
  if (lower.includes('modal') || lower.includes('dialog')) return 'dialog';
  return 'div';
}

// ---------------------------------------------------------------------------
// Structure extraction
// ---------------------------------------------------------------------------

/**
 * Walks the default variant's child tree and produces a human-readable
 * description of the component structure.
 *
 * @param assetMap - Optional map from nodeId → "./assets/filename.svg".
 *   When provided, icon slot nodes with a known asset emit an explicit
 *   `<img>` rendering hint so the LLM generates the correct tag.
 */
function describeVariantStructure(
  data: ComponentSetData,
  assetMap?: Map<string, string>,
): string {
  const lines: string[] = [];
  const elementType = inferElementType(data.name, data.defaultVariantNode);
  lines.push(`Component: ${data.name}`);
  lines.push(`Semantic element: <${elementType}>`);

  // Build a reverse map: if a deep child has an asset, propagate it to its ancestors
  const propagatedAssetMap = propagateAssetPaths(data.defaultVariantNode, assetMap);

  const node = data.defaultVariantNode;
  if (node?.children && node.children.length > 0) {
    lines.push('Children:');
    for (const child of node.children) {
      describeNodeRecursive(child, lines, 1, propagatedAssetMap);
    }
  }

  return lines.join('\n');
}

/**
 * Propagates asset paths from deep child nodes up to their parent containers.
 * This ensures that when we describe a parent "Left Icon" node, we can find
 * the asset path that was mapped to its deep "Vector" child.
 */
function propagateAssetPaths(
  node: any,
  assetMap?: Map<string, string>,
): Map<string, string> {
  if (!assetMap || assetMap.size === 0) return new Map();

  const propagated = new Map<string, string>();

  function traverse(n: any): string | null {
    if (!n || !n.id) return null;

    // Check if this node directly has an asset
    const directAsset = assetMap?.get(n.id);
    if (directAsset) {
      propagated.set(n.id, directAsset);
      return directAsset;
    }

    // Check all children and collect their assets
    let foundAsset: string | null = null;
    if (n.children && n.children.length > 0) {
      for (const child of n.children) {
        const childAsset = traverse(child);
        if (childAsset && !foundAsset) {
          // Propagate first child's asset to this parent
          foundAsset = childAsset;
          propagated.set(n.id, childAsset);
        }
      }
    }

    return foundAsset;
  }

  traverse(node);
  return propagated;
}

function describeNodeRecursive(
  node: any,
  lines: string[],
  depth: number,
  assetMap?: Map<string, string>,
): void {
  const indent = '  '.repeat(depth);
  const name = node.name ?? 'unnamed';
  const nodeType = node.type ?? 'UNKNOWN';

  // Skip internal metadata nodes (Figma naming convention: _prefix)
  if (name.startsWith('_')) return;

  if (nodeType === 'TEXT') {
    const content = node.text ?? '';
    lines.push(`${indent}- "${name}" (TEXT, content: "${content}")`);
  } else if (nodeType === 'IMAGE-SVG' || nodeType === 'IMAGE') {
    // Explicit asset type — always emit an img hint
    const assetPath = node.id ? assetMap?.get(node.id) : undefined;
    if (assetPath) {
      lines.push(`${indent}- "${name}" (icon/image) → render as: <img src="${assetPath}" alt="" />`);
    } else {
      lines.push(`${indent}- "${name}" (${nodeType}, icon/image)`);
    }
  } else if (nodeType === 'INSTANCE') {
    lines.push(`${indent}- "${name}" (INSTANCE, likely icon/sub-component)`);
  } else if (nodeType === 'FRAME' || nodeType === 'GROUP' || nodeType === 'COMPONENT') {
    const isIconSlot =
      name.toLowerCase().includes('icon') ||
      (isSmallFixedFrame(node) && (!node.children || node.children.length <= 1)) ||
      // A childless FRAME is a collapsed SVG container (Framelink strips vectors)
      (!node.children || node.children.length === 0);

    // Check if we have an exported asset for this specific node
    const assetPath = node.id ? assetMap?.get(node.id) : undefined;

    if (assetPath) {
      // We have a downloaded SVG — tell the LLM exactly how to render it
      lines.push(
        `${indent}- "${name}" (icon slot) → render as: <img src="${assetPath}" alt="" />`,
      );
    } else if (isIconSlot) {
      lines.push(`${indent}- "${name}" (icon slot, optional)`);
    } else {
      lines.push(`${indent}- "${name}" (${nodeType} container)`);
      if (node.children) {
        for (const child of node.children) {
          describeNodeRecursive(child, lines, depth + 1, assetMap);
        }
      }
    }
  } else if (nodeType === 'RECTANGLE') {
    lines.push(`${indent}- "${name}" (RECTANGLE, decorative/divider)`);
  } else {
    lines.push(`${indent}- "${name}" (${nodeType})`);
  }
}

function isSmallFixedFrame(node: any): boolean {
  // A frame is "small" if it has explicit small dimensions (likely an icon container)
  if (!node.layout) return false;
  const dims = node.dimensions ?? node.layout?.dimensions;
  if (!dims) return false;
  return (dims.width && dims.width <= 24 && dims.height && dims.height <= 24);
}

// ---------------------------------------------------------------------------
// Prop generation
// ---------------------------------------------------------------------------

/**
 * Maps a Figma axis name to a component prop name.
 */
function axisToPropName(axisName: string): string {
  const lower = axisName.toLowerCase();
  if (lower === 'style' || lower === 'variant' || lower === 'appearance' || lower === 'type') return 'variant';
  if (lower === 'size') return 'size';
  if (lower === 'color' || lower === 'theme') return 'color';
  return lower.replace(/\s+/g, '');
}

/**
 * Builds the props list dynamically from axes, classified states, and component property definitions.
 * Now includes icon slot props (INSTANCE_SWAP), text content props (TEXT), and boolean visibility props (BOOLEAN).
 */
function buildDynamicProps(data: ComponentSetData): { name: string; type: string; default: string }[] {
  const props: { name: string; type: string; default: string }[] = [];

  // One prop per non-state axis
  for (const axis of data.propAxes) {
    const propName = axisToPropName(axis.name);
    const defaultValue = data.defaultVariant.props[axis.name] ?? axis.values[0];
    props.push({
      name: propName,
      type: axis.values.map((v) => `'${toKebabCase(v)}'`).join(' | '),
      default: toKebabCase(defaultValue),
    });
  }

  // Icon slot props from INSTANCE_SWAP component properties
  if (data.iconSlotProperties) {
    for (const iconProp of data.iconSlotProperties) {
      const propName = toCamelCase(iconProp.name);
      props.push({
        name: propName,
        type: 'React.ReactNode',
        default: 'undefined',
      });
    }
  }

  // Text content props from TEXT component properties
  if (data.textContentProperties) {
    for (const textProp of data.textContentProperties) {
      const propName = toCamelCase(textProp.name);
      props.push({
        name: propName,
        type: 'string',
        default: `'${textProp.defaultValue}'`,
      });
    }
  }

  // Boolean visibility props from BOOLEAN component properties
  if (data.booleanVisibilityProperties) {
    for (const boolProp of data.booleanVisibilityProperties) {
      const propName = toCamelCase(boolProp.name);
      // Avoid duplicates with state-derived boolean props
      if (!props.some((p) => p.name === propName)) {
        props.push({
          name: propName,
          type: 'boolean',
          default: String(boolProp.defaultValue),
        });
      }
    }
  }

  // Boolean props from state analysis
  for (const boolProp of data.booleanProps) {
    // Avoid duplicates with component property boolean props
    if (!props.some((p) => p.name === boolProp)) {
      props.push({
        name: boolProp,
        type: 'boolean',
        default: 'false',
      });
    }
  }

  return props;
}

/**
 * Convert string to camelCase
 */
function toCamelCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, char) => char.toUpperCase());
}

// ---------------------------------------------------------------------------
// Class naming
// ---------------------------------------------------------------------------

function buildClassNaming(data: ComponentSetData, baseClass: string): string {
  const lines: string[] = [`Base class: "${baseClass}"`];

  for (const axis of data.propAxes) {
    const propName = axisToPropName(axis.name);
    const exampleValue = toKebabCase(axis.values[0]);
    lines.push(`${axis.name} modifier: "${baseClass}--{${propName}}" (e.g., "${baseClass}--${exampleValue}")`);
  }

  for (const boolProp of data.booleanProps) {
    if (boolProp === 'disabled') {
      lines.push(`${boolProp}: uses [disabled] attribute`);
    } else if (boolProp === 'loading') {
      lines.push(`${boolProp}: add "${boolProp}" class when ${boolProp}=true`);
    } else {
      lines.push(`${boolProp}: add data-${boolProp} attribute when ${boolProp}=true`);
    }
  }

  lines.push(`Child element classes: "${baseClass}__<child-name>" for styled children`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds the data that will be injected into the LLM prompt.
 *
 * @param assetMap - Optional map from nodeId → "./assets/filename.svg".
 *   When provided, icon slot hints in the structure description include
 *   explicit `<img>` rendering instructions for the LLM.
 */
export function buildVariantPromptData(
  data: ComponentSetData,
  assetMap?: Map<string, string>,
  assets?: AssetEntry[],
): VariantPromptData {
  const componentName = data.name.replace(/\s+/g, '');
  const baseClass = toKebabCase(data.name);
  const elementType = inferElementType(data.name, data.defaultVariantNode);

  const axes = data.propAxes.map((axis) => ({
    name: axis.name,
    values: axis.values,
    default: data.defaultVariant.props[axis.name] ?? axis.values[0],
  }));

  const props = buildDynamicProps(data);
  const structure = describeVariantStructure(data, assetMap);
  const classNaming = buildClassNaming(data, baseClass);

  const stateInfo = data.stateAxis
    ? {
        stateValues: data.stateAxis.values,
        booleanProps: data.booleanProps,
        classifiedStates: data.classifiedStates,
      }
    : null;

  return { componentName, baseClass, elementType, axes, props, structure, classNaming, stateInfo, assets };
}

/**
 * Builds the user prompt for the LLM, containing the variant data
 * and optionally the default variant's YAML subtree.
 *
 * @param promptData - The formatted prompt data (for display)
 * @param defaultVariantYaml - Optional YAML representation
 * @param componentSetData - Optional full component set data (for accessing component properties)
 */
export function buildComponentSetUserPrompt(
  promptData: VariantPromptData,
  defaultVariantYaml?: string,
  componentSetData?: ComponentSetData,
): string {
  const lines: string[] = [];

  lines.push(`## Component Set: ${promptData.componentName}`);
  lines.push('');
  lines.push('### Structure');
  lines.push(promptData.structure);
  lines.push('');

  // Asset variant tracking - show which icons appear in which states/variants
  if (promptData.assets && promptData.assets.length > 0) {
    const conditionalAssets = promptData.assets.filter(a => a.variants && a.variants.length > 0);

    if (conditionalAssets.length > 0) {
      lines.push('### Icon/Asset Conditional Rendering');
      lines.push('Some icons only appear in specific variants or states:');
      lines.push('');

      for (const asset of conditionalAssets) {
        const totalVariants = componentSetData?.variants.length || 0;
        const appearsIn = asset.variants?.length || 0;

        // Only document if the asset doesn't appear in ALL variants
        if (appearsIn > 0 && appearsIn < totalVariants) {
          const assetName = asset.filename.replace('.svg', '').replace(/-/g, ' ');
          lines.push(`**${assetName}** (${asset.filename}):`);

          // Try to detect patterns in variant names
          const variantNames = asset.variants || [];
          const hasLoadingState = variantNames.some(v => v.toLowerCase().includes('loading'));
          const hasHoverState = variantNames.some(v => v.toLowerCase().includes('hover'));
          const hasDisabledState = variantNames.some(v => v.toLowerCase().includes('disabled'));
          const hasErrorState = variantNames.some(v => v.toLowerCase().includes('error'));

          if (hasLoadingState && !hasHoverState && !hasDisabledState) {
            lines.push(`  - Only appears in LOADING state`);
            lines.push(`  - Use conditional rendering: {props.loading && <img src="./assets/${asset.filename}" />}`);
          } else if (variantNames.length <= 5) {
            lines.push(`  - Only appears in: ${variantNames.join(', ')}`);
            lines.push(`  - Appears in ${appearsIn}/${totalVariants} variants`);
          } else {
            lines.push(`  - Appears in ${appearsIn}/${totalVariants} variants`);
          }

          if (asset.isColorVariant) {
            lines.push(`  - ✓ This SVG uses \`currentColor\` and can be recolored via CSS`);
          }

          lines.push('');
        }
      }
    }
  }

  // Variant axes
  if (promptData.axes.length > 0) {
    lines.push('### Variant Axes');
    for (const axis of promptData.axes) {
      lines.push(`- ${axis.name}: [${axis.values.join(', ')}] (default: ${axis.default})`);
    }
    lines.push('');
  }

  // State info — from actual data, not hardcoded
  if (promptData.stateInfo) {
    lines.push('### States');
    lines.push(`- Values: [${promptData.stateInfo.stateValues.join(', ')}]`);
    lines.push('- Handled via CSS pseudo-classes and class/attribute modifiers');
    if (promptData.stateInfo.booleanProps.length > 0) {
      lines.push(`- Boolean conditions from states: ${promptData.stateInfo.booleanProps.join(', ')}`);
    }
    lines.push('');
  }

  // Component properties from Figma API (if available)
  if (componentSetData?.componentPropertyDefinitions && Object.keys(componentSetData.componentPropertyDefinitions).length > 0) {
    lines.push('### Component Properties (from Figma)');
    lines.push('The component has the following Figma component properties:');

    if (componentSetData.iconSlotProperties && componentSetData.iconSlotProperties.length > 0) {
      lines.push('');
      lines.push('**Icon Slots (INSTANCE_SWAP properties):**');
      for (const iconProp of componentSetData.iconSlotProperties) {
        lines.push(`- ${iconProp.name}: Swappable icon/component slot`);
      }
      lines.push('  → These should be exposed as React.ReactNode props for custom icons');
    }

    if (componentSetData.textContentProperties && componentSetData.textContentProperties.length > 0) {
      lines.push('');
      lines.push('**Text Content (TEXT properties):**');
      for (const textProp of componentSetData.textContentProperties) {
        lines.push(`- ${textProp.name}: Editable text content (default: "${textProp.defaultValue}")`);
      }
      lines.push('  → These should be exposed as string props');
    }

    if (componentSetData.booleanVisibilityProperties && componentSetData.booleanVisibilityProperties.length > 0) {
      lines.push('');
      lines.push('**Visibility Toggles (BOOLEAN properties):**');
      for (const boolProp of componentSetData.booleanVisibilityProperties) {
        lines.push(`- ${boolProp.name}: Visibility toggle (default: ${boolProp.defaultValue})`);
      }
      lines.push('  → These should control element visibility with conditional rendering');
    }

    lines.push('');
  }

  lines.push('### CSS Class Convention');
  lines.push(promptData.classNaming);
  lines.push('');
  lines.push('### Props');
  for (const prop of promptData.props) {
    lines.push(`- ${prop.name}: ${prop.type} (default: ${prop.default})`);
  }
  lines.push('- children: content for text slots');
  lines.push('');

  // Dynamic requirements
  lines.push('### Requirements');
  lines.push('1. Generate a Mitosis (.lite.tsx) component');
  lines.push('2. Use `useStore` with a getter `get classes()` that builds the CSS class string from props');
  lines.push('3. Bind via `class={state.classes}` — do NOT use `css={{}}`');
  lines.push(`4. The component should accept: ${promptData.props.map((p) => p.name).join(', ')}, and children props`);

  // Add requirements for component properties if present
  if (componentSetData?.iconSlotProperties && componentSetData.iconSlotProperties.length > 0) {
    lines.push('5. For INSTANCE_SWAP icon slots: Use conditional rendering {props.iconSlot || <img src="./assets/default.svg" />}');
  }
  if (componentSetData?.booleanVisibilityProperties && componentSetData.booleanVisibilityProperties.length > 0) {
    lines.push('6. For BOOLEAN visibility toggles:');
    for (const boolProp of componentSetData.booleanVisibilityProperties) {
      if (boolProp.defaultValue === true) {
        const propName = toCamelCase(boolProp.name);
        lines.push(`   - ${propName} defaults to TRUE, so use: {props.${propName} !== false ? <div>...</div> : null}`);
      } else {
        const propName = toCamelCase(boolProp.name);
        lines.push(`   - ${propName} defaults to FALSE, so use: {props.${propName} ? <div>...</div> : null}`);
      }
    }
  }
  if (componentSetData?.textContentProperties && componentSetData.textContentProperties.length > 0) {
    lines.push('7. For TEXT properties: Use as default values in text elements');
  }

  // Element-specific requirements
  const el = promptData.elementType;
  if (el === 'button') {
    const hasDisabled = promptData.props.some((p) => p.name === 'disabled');
    const hasLoading = promptData.props.some((p) => p.name === 'loading');
    if (hasDisabled || hasLoading) {
      const conditions = [hasDisabled ? 'props.disabled' : '', hasLoading ? 'props.loading' : ''].filter(Boolean).join(' || ');
      lines.push(`5. Set \`disabled={${conditions}}\` on the <button>`);
    }
  } else if (el === 'div' && promptData.componentName.toLowerCase().includes('input')) {
    lines.push('5. Render an <input> element inside the wrapper div for the text entry area');
    const hasDisabled = promptData.props.some((p) => p.name === 'disabled');
    if (hasDisabled) {
      lines.push('6. Pass disabled prop to the <input> element');
    }
  }

  lines.push(`${lines[lines.length - 1].startsWith('5') || lines[lines.length - 1].startsWith('6') ? '7' : '5'}. Use string concatenation (not template literals) for class building`);

  // Boolean prop → data attribute mapping
  const dataAttrProps = promptData.props.filter(
    (p) => p.type === 'boolean' && p.name !== 'disabled' && p.name !== 'loading',
  );
  if (dataAttrProps.length > 0) {
    lines.push(`${lines[lines.length - 1][0] === '7' ? '8' : '6'}. For boolean props [${dataAttrProps.map((p) => p.name).join(', ')}], add data-{name} attribute to the root element when true`);
  }

  // Include default variant YAML for LLM context
  if (defaultVariantYaml) {
    lines.push('');
    lines.push('### Default Variant Tree (YAML)');
    lines.push('Use this to understand the actual component structure:');
    lines.push('```yaml');
    lines.push(defaultVariantYaml);
    lines.push('```');
  }

  return lines.join('\n');
}

/**
 * Builds a generic system prompt for component set generation.
 * No component-specific assumptions.
 */
export function buildComponentSetSystemPrompt(): string {
  return `You are a Mitosis component generator. You receive a component set description with its structure, variant axes, and a YAML snippet of the actual Figma tree. Generate a single Mitosis (.lite.tsx) component that handles all variants through CSS classes and props.

## Output Rules
1. Export exactly ONE default function component
2. Use \`class\` NOT \`className\` for CSS classes
3. Do NOT use \`css={{}}\` — all styling is handled via CSS classes
4. Use \`useStore\` with a getter to compute the class string from props
5. Import only \`useStore\` from '@builder.io/mitosis'
6. Use string concatenation with + operator for building class strings (no template literals)
7. Access props directly (e.g., props.variant), do NOT destructure props
8. Use the semantic HTML element specified in the structure description
9. Match the child structure from the YAML tree — reproduce the actual children (labels, inputs, icons, helper text, etc.)
10. For text content children, use {props.children || '<actual text from YAML>'}
11. Map boolean props to appropriate HTML attributes AND CSS class/data-attribute modifiers
12. For boolean props like "error", "filled", etc., add data-{name} attribute to root element
13. CRITICAL: When the structure description says "render as: <img src='...'>" for an icon/image node, you MUST use an <img> tag with that exact src path. Do NOT use div, svg, or any other element.
14. CRITICAL: For BOOLEAN visibility props with default=true, use {props.name !== false ? ... : null} NOT {props.name ? ... : null}
15. CRITICAL: For BOOLEAN visibility props with default=false, use {props.name ? ... : null}

## Example Pattern
\`\`\`tsx
import { useStore } from '@builder.io/mitosis';

export default function ComponentName(props) {
  const state = useStore({
    get classes() {
      const base = 'component-name';
      return base + ' ' + base + '--' + (props.variant || 'default') + (props.error ? ' error' : '') + (props.disabled ? ' disabled' : '');
    }
  });

  return (
    <div class={state.classes} data-error={props.error || undefined}>
      <span class="component-name__label">{props.children || 'Label'}</span>
    </div>
  );
}
\`\`\`

Respond with ONLY the .lite.tsx code. No markdown fences, no explanation.
Start directly with the import statement.`;
}
