/**
 * Generates standalone preview HTML for React output.
 *
 * Default mode (`raw`) renders exactly one component instance with default
 * Figma-driven props for fidelity. Optional `grid` mode renders metadata-driven
 * variant combos for inspection.
 */

import { config } from '../config.js';

interface VariantAxisMeta {
  name: string;
  values: string[];
  default: string;
}

interface VariantMetaEntry {
  name: string;
  props: Record<string, string>;
}

interface VariantMetadata {
  axes: VariantAxisMeta[];
  variants: VariantMetaEntry[];
}

interface PreviewVariantEntry {
  label: string;
  props: Record<string, string | boolean>;
}

/**
 * Transform Mitosis-compiled React JSX into browser-runnable code.
 *
 * 1. Strip import lines
 * 2. Rewrite asset paths to API endpoint
 * 3. Extract and hoist <style> tag CSS
 */
function transformReactCode(
  reactCode: string,
  sessionId: string,
): { code: string; css: string } {
  const lines = reactCode.split('\n');
  const codeLines: string[] = [];
  let css = '';

  for (const line of lines) {
    if (/^\s*import\s+/.test(line)) continue;
    if (/^\s*export\s+default\s+/.test(line)) continue;
    codeLines.push(line);
  }

  let code = codeLines.join('\n');

  const styleTagRegex = /<style>\{`([\s\S]*?)`\}<\/style>/g;
  let styleMatch;
  while ((styleMatch = styleTagRegex.exec(code)) !== null) {
    css += styleMatch[1] + '\n';
  }
  code = code.replace(/<style>\{`[\s\S]*?`\}<\/style>/g, '');

  code = code.replace(
    /["']\.\/assets\/([^"']+)["']/g,
    `"/api/preview/${sessionId}/assets/$1"`,
  );

  code = code.replace(
    /src=["']([^"'/][^"']*\.svg)["']/g,
    `src="/api/preview/${sessionId}/assets/$1"`,
  );

  css = css.replace(
    /url\(["']?\.\/assets\/([^"')]+)["']?\)/g,
    `url("/api/preview/${sessionId}/assets/$1")`,
  );

  return { code, css };
}

function toCamelCase(str: string): string {
  const clean = str.replace(/#[\w:]+$/, '').trim();
  return clean
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^[A-Z]/, (c) => c.toLowerCase());
}

function toKebabCase(str: string): string {
  return String(str)
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/\s+/g, '-')
    .replace(/[()[\]/\\'",.:;!?@#$%^&*+=|~`<>{}]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function axisToPropName(axisName: string): string {
  const lower = axisName.toLowerCase().trim();
  if (lower === 'style' || lower === 'variant' || lower === 'appearance' || lower === 'type') {
    return 'variant';
  }
  return toCamelCase(axisName);
}

const DEFAULT_STATE_VALUES = new Set(['default', 'rest', 'resting', 'normal', 'idle', 'enabled', 'base']);
const STATE_KEYWORDS = new Set(['hover', 'focus', 'disabled', 'loading', 'active', 'pressed', 'error', 'selected']);

function isStateAxis(axisName: string, values: string[]): boolean {
  if (axisName.toLowerCase().trim() === 'state') return true;
  const lowerValues = values.map((v) => String(v).toLowerCase().trim());
  const hits = lowerValues.filter((v) => DEFAULT_STATE_VALUES.has(v) || STATE_KEYWORDS.has(v)).length;
  return hits >= 2;
}

function stateValueToProps(stateValue: string): Record<string, boolean> {
  const lower = stateValue.toLowerCase().trim();
  if (!lower || DEFAULT_STATE_VALUES.has(lower)) return {};

  const props: Record<string, boolean> = {};
  const parts = lower.split(/\s*-\s*|\s+/).filter(Boolean);
  for (const part of parts) {
    if (DEFAULT_STATE_VALUES.has(part)) continue;
    props[toCamelCase(part)] = true;
  }
  return props;
}

function buildDefaultPropsObject(
  propDefs?: Record<string, any>,
): Record<string, string | boolean> {
  if (!propDefs) return {};

  const defaults: Record<string, string | boolean> = {};
  const seen = new Set<string>();

  for (const [rawName, def] of Object.entries(propDefs)) {
    if (def?.type === 'VARIANT' && typeof def.defaultValue === 'string') {
      const variantOptions = Array.isArray(def.variantOptions)
        ? def.variantOptions.map((v: any) => String(v))
        : [];
      if (isStateAxis(rawName, variantOptions)) continue;

      const propName = axisToPropName(rawName);
      if (!propName || seen.has(propName)) continue;
      defaults[propName] = toKebabCase(def.defaultValue);
      seen.add(propName);
      continue;
    }

    if (def?.type === 'TEXT' && typeof def.defaultValue === 'string') {
      const propName = toCamelCase(rawName);
      if (!propName || seen.has(propName)) continue;
      defaults[propName] = def.defaultValue;
      seen.add(propName);
      continue;
    }

    if (def?.type === 'BOOLEAN' && typeof def.defaultValue === 'boolean') {
      const propName = toCamelCase(rawName);
      if (!propName || seen.has(propName)) continue;
      defaults[propName] = def.defaultValue;
      seen.add(propName);
    }
  }

  return defaults;
}

function buildVariantEntries(metadata?: VariantMetadata): PreviewVariantEntry[] {
  if (!metadata?.variants || metadata.variants.length === 0) return [];

  const axisMap = new Map<string, VariantAxisMeta>();
  for (const axis of metadata.axes ?? []) {
    axisMap.set(axis.name, axis);
  }

  return metadata.variants.map((variant, index) => {
    const props: Record<string, string | boolean> = {};

    for (const [axisName, rawValue] of Object.entries(variant.props ?? {})) {
      const axis = axisMap.get(axisName);
      const value = String(rawValue ?? '');

      if (axis && isStateAxis(axis.name, axis.values)) {
        Object.assign(props, stateValueToProps(value));
        continue;
      }

      const propName = axisToPropName(axisName);
      if (!propName) continue;
      props[propName] = toKebabCase(value);
    }

    const label = variant.name || `Variant ${index + 1}`;
    return { label, props };
  });
}

function buildRawPreviewApp(
  componentName: string,
  propDefs?: Record<string, any>,
): string {
  const defaultPropsLiteral = JSON.stringify(buildDefaultPropsObject(propDefs), null, 2);

  return `
    function App() {
      const defaultProps = ${defaultPropsLiteral};
      return <${componentName} {...defaultProps} />;
    }`;
}

function buildVariantGridApp(
  componentName: string,
  propDefs?: Record<string, any>,
  variantMetadata?: VariantMetadata,
): string {
  const variantEntries = buildVariantEntries(variantMetadata);
  if (variantEntries.length === 0) {
    return buildRawPreviewApp(componentName, propDefs);
  }

  const defaultPropsLiteral = JSON.stringify(buildDefaultPropsObject(propDefs), null, 2);
  const entriesLiteral = JSON.stringify(variantEntries, null, 2);

  return `
    function App() {
      const defaultProps = ${defaultPropsLiteral};
      const allVariants = ${entriesLiteral};

      return (
        <div style={{ padding: '24px', fontFamily: 'system-ui, -apple-system, sans-serif', background: '#f8f9fa', minHeight: '100vh' }}>
          <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
            <h1 style={{ margin: '0 0 8px', fontSize: '24px', fontWeight: 700, color: '#1a1a1a' }}>
              ${componentName}
            </h1>
            <p style={{ margin: '0 0 20px', color: '#666', fontSize: '13px' }}>
              {allVariants.length} variant combination{allVariants.length !== 1 ? 's' : ''}
            </p>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: '16px',
            }}>
              {allVariants.map((v, i) => (
                <div key={i} style={{
                  padding: '16px',
                  background: '#fff',
                  borderRadius: '10px',
                  border: '1px solid #e5e7eb',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '10px',
                }}>
                  <div style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#888',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    textAlign: 'center',
                  }}>
                    {v.label}
                  </div>
                  <${componentName} {...defaultProps} {...v.props} />
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }`;
}

/**
 * Generate a standalone HTML page that renders the React component.
 */
export function generatePreviewHTML(
  reactCode: string,
  componentName: string,
  sessionId: string,
  componentPropertyDefinitions?: Record<string, any>,
  variantMetadata?: VariantMetadata,
): string {
  const { code, css } = transformReactCode(reactCode, sessionId);
  // Use grid mode when the component has multiple variants (COMPONENT_SET),
  // or when explicitly configured via PREVIEW_MODE=grid.
  const hasMultipleVariants = (variantMetadata?.variants?.length ?? 0) > 1;
  // 'grid' → always grid; 'raw' → always single; 'auto' (default) → grid when component set has multiple variants
  const useGridPreview =
    config.preview.mode === 'grid' ||
    (config.preview.mode === 'auto' && hasMultipleVariants);

  const appCode = useGridPreview
    ? buildVariantGridApp(componentName, componentPropertyDefinitions, variantMetadata)
    : buildRawPreviewApp(componentName, componentPropertyDefinitions);

  const previewShellCSS = useGridPreview
    ? `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #f8f9fa;
      min-height: 100vh;
    }
    `
    : `
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
    }
    #root {
      display: inline-block;
    }
    `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Preview: ${componentName}</title>
  <style>
    ${previewShellCSS}
    ${css}
  </style>
  <script src="${config.preview.cdnUrls.react}" crossorigin></script>
  <script src="${config.preview.cdnUrls.reactDom}" crossorigin></script>
  <script src="${config.preview.cdnUrls.babel}"></script>
</head>
<body>
  <div id="root"></div>

  <script type="text/babel" data-type="module">
    const { useState, useEffect, useRef, useCallback, useMemo } = React;

    ${code}

    ${appCode}

    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(<App />);
  </script>
</body>
</html>`;
}
