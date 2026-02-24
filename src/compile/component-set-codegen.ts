/**
 * Generates framework-specific component code from parsed COMPONENT_SET data.
 *
 * This bypasses Mitosis entirely — used as a deterministic fallback when
 * the LLM+Mitosis path fails. Works for any component type by deriving
 * props, element type, and text from the parsed data.
 */

import type { ComponentSetData } from '../figma/component-set-parser.js';
import { buildVariantCSS, toKebabCase } from '../figma/component-set-parser.js';
import type { Framework } from '../types/index.js';

export interface ComponentSetCodegenResult {
  frameworkOutputs: Record<string, string>;
  css: string;
  componentName: string;
}

interface CodegenConfig {
  componentName: string;
  baseClass: string;
  css: string;
  /** All prop axes with prop name, values, and default */
  propAxes: { propName: string; values: string[]; default: string }[];
  /** Boolean props from state analysis */
  booleanProps: string[];
  /** Inferred HTML element */
  elementType: string;
  /** Default text from first TEXT child */
  defaultText: string;
}

/**
 * Generate framework-specific code for all requested frameworks.
 */
export function generateComponentSetCode(
  data: ComponentSetData,
  frameworks: Framework[],
): ComponentSetCodegenResult {
  const css = buildVariantCSS(data);
  const componentName = data.name.replace(/\s+/g, '');
  const baseClass = toKebabCase(data.name);

  const propAxes = data.propAxes.map((axis) => ({
    propName: axisToPropName(axis.name),
    values: axis.values,
    default: data.defaultVariant.props[axis.name] ?? axis.values[0],
  }));

  const config: CodegenConfig = {
    componentName,
    baseClass,
    css,
    propAxes,
    booleanProps: data.booleanProps,
    elementType: inferElementType(data.name),
    defaultText: extractLabelText(data),
  };

  const generators: Record<Framework, (cfg: CodegenConfig) => string> = {
    react: generateReact,
    vue: generateVue,
    svelte: generateSvelte,
    angular: generateAngular,
    solid: generateSolid,
  };

  const frameworkOutputs: Record<string, string> = {};
  for (const fw of frameworks) {
    frameworkOutputs[fw] = generators[fw](config);
  }

  return { frameworkOutputs, css, componentName };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function axisToPropName(axisName: string): string {
  const lower = axisName.toLowerCase();
  if (lower === 'style' || lower === 'variant' || lower === 'appearance' || lower === 'type') return 'variant';
  if (lower === 'size') return 'size';
  return lower.replace(/\s+/g, '');
}

function inferElementType(componentName: string): string {
  const lower = componentName.toLowerCase();
  if (lower.includes('button') || lower.includes('btn') || lower.includes('cta')) return 'button';
  if (lower.includes('input') || lower.includes('textfield') || lower.includes('text-field')) return 'div';
  if (lower.includes('badge') || lower.includes('chip') || lower.includes('tag')) return 'span';
  if (lower.includes('card')) return 'article';
  if (lower.includes('link') || lower.includes('anchor')) return 'a';
  return 'div';
}

function extractLabelText(data: ComponentSetData): string {
  const node = data.defaultVariantNode;
  if (!node) return data.name;
  return findFirstText(node) ?? data.name;
}

function findFirstText(node: any): string | null {
  if (node.type === 'TEXT' && node.text) return node.text;
  if (node.children) {
    for (const child of node.children) {
      const found = findFirstText(child);
      if (found) return found;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Class string builder (shared logic)
// ---------------------------------------------------------------------------

function buildClassArrayItems(cfg: CodegenConfig, prefix: string): string[] {
  const items: string[] = [`${prefix}baseClass`];
  for (const axis of cfg.propAxes) {
    items.push(`\`\${${prefix}baseClass}--\${${prefix}${axis.propName}}\``);
  }
  for (const bp of cfg.booleanProps) {
    if (bp === 'disabled') continue; // disabled is handled via attribute
    items.push(`${prefix}${bp} ? "${bp}" : ""`);
  }
  return items;
}

function buildDisabledExpr(cfg: CodegenConfig, prefix: string): string {
  const parts: string[] = [];
  if (cfg.booleanProps.includes('disabled')) parts.push(`${prefix}disabled`);
  if (cfg.booleanProps.includes('loading')) parts.push(`${prefix}loading`);
  return parts.length > 0 ? parts.join(' || ') : '';
}

function buildDataAttrs(cfg: CodegenConfig, prefix: string, syntax: 'jsx' | 'vue' | 'angular'): string {
  const attrs: string[] = [];
  for (const bp of cfg.booleanProps) {
    if (bp === 'disabled' || bp === 'loading') continue;
    if (syntax === 'jsx') {
      attrs.push(` data-${bp}={${prefix}${bp} || undefined}`);
    } else if (syntax === 'vue') {
      attrs.push(` :data-${bp}="${bp} || undefined"`);
    } else if (syntax === 'angular') {
      attrs.push(` [attr.data-${bp}]="this.${bp} || null"`);
    }
  }
  return attrs.join('');
}

// ---------------------------------------------------------------------------
// Framework generators
// ---------------------------------------------------------------------------

function generateReact(cfg: CodegenConfig): string {
  const propDefaults = [
    ...cfg.propAxes.map((a) => `  ${a.propName} = "${toKebabCase(a.default)}",`),
    ...cfg.booleanProps.map((p) => `  ${p} = false,`),
    '  children,',
  ].join('\n');

  const classItems = buildClassArrayItems(cfg, '');
  const disabledExpr = buildDisabledExpr(cfg, '');
  const disabledAttr = disabledExpr ? ` disabled={${disabledExpr}}` : '';
  const dataAttrs = buildDataAttrs(cfg, '', 'jsx');

  return `import * as React from "react";

function ${cfg.componentName}({
${propDefaults}
}) {
  const baseClass = "${cfg.baseClass}";
  const classes = [
    ${classItems.join(',\n    ')},
  ].filter(Boolean).join(" ");

  return (
    <>
      <${cfg.elementType} className={classes}${disabledAttr}${dataAttrs}>
        <span className={\`\${baseClass}__label\`}>{children || "${cfg.defaultText}"}</span>
      </${cfg.elementType}>
      <style>{\`${cfg.css}\`}</style>
    </>
  );
}

export default ${cfg.componentName};
`;
}

function generateVue(cfg: CodegenConfig): string {
  const propsDecl = [
    ...cfg.propAxes.map((a) => `  ${a.propName}: { type: String, default: "${toKebabCase(a.default)}" },`),
    ...cfg.booleanProps.map((p) => `  ${p}: { type: Boolean, default: false },`),
  ].join('\n');

  const classItems = buildClassArrayItems(cfg, 'props.');
  const disabledExpr = buildDisabledExpr(cfg, '');
  const disabledAttr = disabledExpr ? ` :disabled="${disabledExpr}"` : '';
  const dataAttrs = buildDataAttrs(cfg, '', 'vue');

  return `<template>
  <${cfg.elementType} :class="classes"${disabledAttr}${dataAttrs}>
    <span :class="\`${cfg.baseClass}__label\`">
      <slot>${cfg.defaultText}</slot>
    </span>
  </${cfg.elementType}>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
${propsDecl}
});

const baseClass = "${cfg.baseClass}";

const classes = computed(() =>
  [
    ${classItems.join(',\n    ')},
  ].filter(Boolean).join(" ")
);
</script>

<style scoped>
${cfg.css}
</style>
`;
}

function generateSvelte(cfg: CodegenConfig): string {
  const propsDecl = [
    ...cfg.propAxes.map((a) => `  export let ${a.propName} = "${toKebabCase(a.default)}";`),
    ...cfg.booleanProps.map((p) => `  export let ${p} = false;`),
  ].join('\n');

  const classItems = buildClassArrayItems(cfg, '');
  const disabledExpr = buildDisabledExpr(cfg, '');
  const disabledAttr = disabledExpr ? ` disabled={${disabledExpr}}` : '';
  const dataAttrs = buildDataAttrs(cfg, '', 'jsx');

  return `<script>
${propsDecl}

  const baseClass = "${cfg.baseClass}";
  $: classes = [
    ${classItems.join(',\n    ')},
  ].filter(Boolean).join(" ");
</script>

<${cfg.elementType} class={classes}${disabledAttr}${dataAttrs}>
  <span class="${cfg.baseClass}__label">
    <slot>${cfg.defaultText}</slot>
  </span>
</${cfg.elementType}>

<style>
${cfg.css}
</style>
`;
}

function generateAngular(cfg: CodegenConfig): string {
  const inputs = [
    ...cfg.propAxes.map((a) => `  @Input() ${a.propName} = "${toKebabCase(a.default)}";`),
    ...cfg.booleanProps.map((p) => `  @Input() ${p} = false;`),
  ].join('\n');

  const classItems = buildClassArrayItems(cfg, 'this.');
  const disabledExpr = buildDisabledExpr(cfg, 'this.');
  const disabledAttr = disabledExpr ? ` [disabled]="${disabledExpr}"` : '';
  const dataAttrs = buildDataAttrs(cfg, '', 'angular');
  const indentedCSS = cfg.css.split('\n').map((l) => '      ' + l).join('\n');

  return `import { Component, Input } from "@angular/core";
import { CommonModule } from "@angular/common";

@Component({
  selector: "${cfg.baseClass}",
  template: \`
    <${cfg.elementType} [class]="classes"${disabledAttr}${dataAttrs}>
      <span class="${cfg.baseClass}__label">
        <ng-content>${cfg.defaultText}</ng-content>
      </span>
    </${cfg.elementType}>
  \`,
  styles: [
    \`
      :host {
        display: contents;
      }
${indentedCSS}
    \`,
  ],
  standalone: true,
  imports: [CommonModule],
})
export default class ${cfg.componentName} {
${inputs}

  get classes(): string {
    const baseClass = "${cfg.baseClass}";
    return [
      ${classItems.join(',\n      ')},
    ].filter(Boolean).join(" ");
  }
}
`;
}

function generateSolid(cfg: CodegenConfig): string {
  const mergeDefaults = [
    ...cfg.propAxes.map((a) => `      ${a.propName}: "${toKebabCase(a.default)}",`),
    ...cfg.booleanProps.map((p) => `      ${p}: false,`),
  ].join('\n');

  const classItems = buildClassArrayItems(cfg, 'merged.');
  const disabledExpr = buildDisabledExpr(cfg, 'merged.');
  const disabledAttr = disabledExpr ? ` disabled={${disabledExpr}}` : '';
  const dataAttrs = buildDataAttrs(cfg, 'merged.', 'jsx');

  return `import { mergeProps } from "solid-js";

function ${cfg.componentName}(props) {
  const merged = mergeProps(
    {
${mergeDefaults}
    },
    props
  );

  const baseClass = "${cfg.baseClass}";
  const classes = () =>
    [
      ${classItems.join(',\n      ')},
    ].filter(Boolean).join(" ");

  return (
    <>
      <${cfg.elementType} class={classes()}${disabledAttr}${dataAttrs}>
        <span class={\`\${baseClass}__label\`}>{props.children || "${cfg.defaultText}"}</span>
      </${cfg.elementType}>
      <style>{\`${cfg.css}\`}</style>
    </>
  );
}

export default ${cfg.componentName};
`;
}
