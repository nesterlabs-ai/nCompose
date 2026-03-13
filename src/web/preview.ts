/**
 * Generates a standalone HTML page that renders a React component
 * using CDN-loaded React + Babel for in-browser JSX transpilation.
 *
 * For COMPONENT_SET results (with componentPropertyDefinitions),
 * renders a grid of all variant combinations.
 */

import { collectFontFamilies, buildGoogleFontsLink } from '../compile/font-resolver.js';

/**
 * Transform Mitosis-compiled React JSX into browser-runnable code.
 *
 * 1. Strip import lines
 * 2. Add React globals
 * 3. Rewrite asset paths to API endpoint
 * 4. Extract and hoist <style> tag CSS
 */
function transformReactCode(
  reactCode: string,
  componentName: string,
  sessionId: string,
): { code: string; css: string } {
  const lines = reactCode.split('\n');
  const codeLines: string[] = [];
  let css = '';

  for (const line of lines) {
    // Skip "use client" directive (not needed in browser context)
    if (/^\s*["']use client["'];?\s*$/.test(line)) continue;
    // Skip all import lines (including CSS imports and chart component imports)
    if (/^\s*import\s+/.test(line)) continue;
    // "export default function Foo() {" → keep as "function Foo() {" so the function is defined
    if (/^\s*export\s+default\s+function\s+/.test(line)) {
      codeLines.push(line.replace(/export\s+default\s+/, ''));
      continue;
    }
    // Skip standalone "export default ComponentName;" lines
    if (/^\s*export\s+default\s+/.test(line)) continue;
    codeLines.push(line);
  }

  let code = codeLines.join('\n');

  // Extract CSS from style tags: <style>{`...css...`}</style>
  const styleTagRegex = /<style>\{`([\s\S]*?)`\}<\/style>/g;
  let styleMatch;
  while ((styleMatch = styleTagRegex.exec(code)) !== null) {
    css += styleMatch[1] + '\n';
  }
  // Remove <style> tags from JSX (CSS will be in a real <style> element)
  code = code.replace(/<style>\{`[\s\S]*?`\}<\/style>/g, '');

  // Rewrite asset paths: ./assets/foo.svg → /api/preview/:sessionId/assets/foo.svg
  code = code.replace(
    /["']\.\/assets\/([^"']+)["']/g,
    `"/api/preview/${sessionId}/assets/$1"`,
  );

  // Also catch bare SVG filenames without ./assets/ prefix (LLM sometimes omits the path)
  code = code.replace(
    /src=["']([^"'/][^"']*\.svg)["']/g,
    `src="/api/preview/${sessionId}/assets/$1"`,
  );

  // Also rewrite asset paths in CSS
  css = css.replace(
    /url\(["']?\.\/assets\/([^"')]+)["']?\)/g,
    `url("/api/preview/${sessionId}/assets/$1")`,
  );

  // Repair truncated CSS (LLM output cut off mid-property)
  css = repairTruncatedCSS(css);

  return { code, css };
}

/**
 * Fix CSS truncated by LLM token limits — removes incomplete declarations
 * and closes any unclosed braces so PostCSS/Vite won't choke.
 */
function repairTruncatedCSS(css: string): string {
  if (!css) return css;
  let result = css.trimEnd();
  // Remove trailing incomplete declaration (property name without semicolon)
  result = result.replace(/\n[ \t]*[a-zA-Z-]+[ \t]*:?[^;{}]*$/, '');
  // Close any unclosed braces
  let open = 0;
  for (const ch of result) {
    if (ch === '{') open++;
    else if (ch === '}') open--;
  }
  while (open > 0) { result += '\n}'; open--; }
  return result;
}

/**
 * Convert a property name to camelCase for use as a React prop.
 * e.g. "Show Left Icon#3371:152" → "showLeftIcon"
 */
function toCamelCase(str: string): string {
  const clean = str.replace(/#\d+:\d+$/, '');
  return clean
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^[A-Z]/, (c) => c.toLowerCase());
}

/**
 * Build the JavaScript source for the variant grid App component.
 * Reads componentPropertyDefinitions to discover axes and render all combos.
 */
function buildVariantGridApp(
  componentName: string,
  propDefs?: Record<string, any>,
): string {
  if (!propDefs) {
    // No property definitions — render a single instance
    return `
    function App() {
      return (
        <div style={{ padding: '1rem' }}>
          <${componentName} />
        </div>
      );
    }`;
  }

  // Separate VARIANT axes from other properties
  const variantAxes: Array<{ name: string; camel: string; values: string[] }> = [];
  const booleanProps: Array<{ name: string; camel: string; defaultValue: boolean }> = [];
  for (const [name, def] of Object.entries(propDefs)) {
    if (def.type === 'VARIANT' && def.variantOptions) {
      variantAxes.push({
        name,
        camel: toCamelCase(name),
        values: def.variantOptions,
      });
    } else if (def.type === 'BOOLEAN') {
      booleanProps.push({
        name,
        camel: toCamelCase(name),
        defaultValue: def.defaultValue ?? true,
      });
    }
  }

  // Identify the state axis (name is "State" or contains state-like values)
  const stateKeywords = ['default', 'hover', 'focus', 'disabled', 'loading', 'active', 'pressed', 'error'];
  const stateAxisIdx = variantAxes.findIndex((a) => {
    if (a.name.toLowerCase() === 'state') return true;
    const lowerVals = a.values.map((v) => v.toLowerCase());
    return lowerVals.filter((v) => stateKeywords.includes(v)).length >= 2;
  });

  const stateAxis = stateAxisIdx >= 0 ? variantAxes.splice(stateAxisIdx, 1)[0] : null;
  const propAxes = variantAxes; // Remaining axes are prop axes (Style, Size, etc.)

  // Build the JS arrays for variant axes
  const axisArraysJS = propAxes.map((axis) => {
    const values = JSON.stringify(axis.values.map((v) => v.toLowerCase()));
    return `  const ${axis.camel}Values = ${values};`;
  }).join('\n');

  // Build state entries
  let statesJS = `  const stateEntries = [{ label: 'Default', props: {} }];`;
  if (stateAxis) {
    const entries = stateAxis.values.map((val) => {
      const lower = val.toLowerCase();
      if (lower === 'default') {
        return `    { label: '${val}', props: {} }`;
      }
      // Compound states like "Error-Hover" → { error: true, hover: true }
      const parts = val.split(/[-\s]+/).filter(Boolean);
      const propsObj = parts.map((p) => `${toCamelCase(p)}: true`).join(', ');
      return `    { label: '${val}', props: { ${propsObj} } }`;
    });
    statesJS = `  const stateEntries = [\n${entries.join(',\n')}\n  ];`;
  }

  // Build base props (boolean defaults + instance swap icons)
  const basePropsEntries: string[] = [];
  for (const bp of booleanProps) {
    if (bp.defaultValue === true) {
      basePropsEntries.push(`${bp.camel}: true`);
    }
  }
  // INSTANCE_SWAP props are not passed — let the component use its own
  // inline SVG defaults rather than overriding with <img> tags.
  const basePropsJS = basePropsEntries.length > 0
    ? `  const baseProps = { ${basePropsEntries.join(', ')} };`
    : `  const baseProps = {};`;

  // Determine how prop axes map to component props.
  // Convention: first axis → "variant", second → "size", rest → camelCase of axis name
  const propMappings = propAxes.map((axis) => {
    // Use the axis camelCase name directly as the prop name
    // But for "Style" → "variant" is the common convention
    const propName = axis.name.toLowerCase() === 'style' ? 'variant'
                   : axis.name.toLowerCase() === 'type' ? 'variant'
                   : axis.camel;
    return { axis, propName };
  });

  // Build cartesian product of prop axes
  // Generate nested flatMap for all axis combinations
  let variantBuildJS: string;
  if (propAxes.length === 0) {
    variantBuildJS = `
  const allVariants = stateEntries.map((state) => ({
    label: state.label,
    props: { ...baseProps, ...state.props },
  }));`;
  } else {
    // Build nested flatMap
    const indent = '    ';
    let inner = `({
${indent}  label: [${propMappings.map((m) => m.axis.camel).join(', ')}, state.label].join(' / '),
${indent}  props: {
${indent}    ...baseProps,
${indent}    ${propMappings.map((m) => {
      const defaultVal = m.axis.values[0].toLowerCase();
      return `...(${m.axis.camel} !== '${defaultVal}' ? { ${m.propName}: ${m.axis.camel} } : {})`;
    }).join(`,\n${indent}    `)},
${indent}    ...state.props,
${indent}  },
${indent}})`;

    let expr = `stateEntries.map((state) => ${inner})`;

    // Wrap in flatMaps from innermost to outermost
    for (let i = propMappings.length - 1; i >= 0; i--) {
      const m = propMappings[i];
      expr = `${m.axis.camel}Values.flatMap((${m.axis.camel}) =>\n      ${expr}\n    )`;
    }

    variantBuildJS = `\n  const allVariants = ${expr};`;
  }

  return `
    const sessionId = ${JSON.stringify('')};

${axisArraysJS}
${statesJS}
${basePropsJS}
${variantBuildJS}

    function App() {
      return (
        <div style={{ padding: '1rem', minHeight: '100vh' }}>
          <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem' }}>${componentName}</h1>
          <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#666' }}>
            {allVariants.length} variant combination{allVariants.length !== 1 ? 's' : ''}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {allVariants.map((v, i) => (
              <div key={i} style={{ width: '100%' }}>
                <div style={{ marginBottom: '0.5rem', fontSize: '0.75rem', color: '#666' }}>{v.label}</div>
                <div style={{ width: '100%' }}>
                  <${componentName} {...v.props} />
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }`;
}

/**
 * Generate a standalone HTML page that renders the React component.
 * If componentPropertyDefinitions is provided, renders a full variant grid.
 */
export function generatePreviewHTML(
  reactCode: string,
  componentName: string,
  sessionId: string,
  componentPropertyDefinitions?: Record<string, any>,
  chartComponents?: Array<{ name: string; reactCode: string; css: string }>,
): string {
  const { code, css } = transformReactCode(reactCode, componentName, sessionId);
  const appCode = buildVariantGridApp(componentName, componentPropertyDefinitions);

  // Detect recharts usage in main code (chart code is now inlined into reactCode)
  const usesRecharts = /from ['"]recharts['"]/.test(reactCode);
  const rechartsScript = usesRecharts
    ? '\n  <script src="https://unpkg.com/recharts@2/umd/Recharts.js" crossorigin></script>'
    : '';
  const rechartsGlobals = usesRecharts
    ? `\n    const { AreaChart, Area, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
      XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
      ComposedChart, ReferenceLine, Brush } = Recharts;`
    : '';

  // Load Google Fonts used in the component CSS
  const fontFamilies = collectFontFamilies(css);
  const fontLink = buildGoogleFontsLink(fontFamilies);

  // Escape code for embedding inside a JS string literal (used in manual transpile approach)
  // We manually call Babel.transform instead of using type="text/babel" to get error handling.
  const escapedJSX = (
    `const { useState, useEffect, useRef, useCallback, useMemo } = React;${rechartsGlobals}\n` +
    code + '\n' +
    appCode + '\n' +
    `const root = ReactDOM.createRoot(document.getElementById('root'));\nroot.render(React.createElement(App));`
  ).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Preview: ${componentName}</title>
  ${fontLink}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #f8f9fa;
      min-height: 100vh;
    }
    .preview-error { padding: 1rem; color: #dc2626; font-family: monospace; white-space: pre-wrap; font-size: 13px; }
    .preview-error h3 { margin-bottom: 0.5rem; font-size: 14px; }
    .ve-hover-outline { outline: 2px solid #3b82f6 !important; outline-offset: -2px !important; cursor: pointer !important; }
    .ve-selected-outline { outline: 2px solid #3b82f6 !important; outline-offset: -2px !important; box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.2) !important; }
    ${css}
  </style>
  <script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>${rechartsScript}
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
</head>
<body>
  <div id="root"></div>

  <script>
    window.onerror = function(msg, src, line, col, err) {
      var el = document.getElementById('root');
      if (el) el.innerHTML = '<div class="preview-error"><h3>Preview Error</h3>' + msg + (line ? ' (line ' + line + ')' : '') + '</div>';
    };
    try {
      var jsxCode = \`${escapedJSX}\`;
      var result = Babel.transform(jsxCode, { presets: ['react'], plugins: ['proposal-optional-chaining', 'proposal-nullish-coalescing-operator'] });
      var script = document.createElement('script');
      script.textContent = result.code;
      document.body.appendChild(script);
    } catch (e) {
      var el = document.getElementById('root');
      if (el) el.innerHTML = '<div class="preview-error"><h3>Babel Transpile Error</h3>' + (e.message || e) + '</div>';
      console.error('Babel transpile error:', e);
    }
  </script>
  <script>
    (function() {
      let lastHovered = null;
      let selectedEl = null;

      document.addEventListener('mouseover', (e) => {
        if (!window.parentVisualEditActive) return;
        if (lastHovered && lastHovered !== selectedEl) {
          lastHovered.classList.remove('ve-hover-outline');
        }
        lastHovered = e.target;
        if (lastHovered && lastHovered !== selectedEl && lastHovered !== document.body && lastHovered !== document.documentElement) {
          lastHovered.classList.add('ve-hover-outline');
        }
      }, true);

      document.addEventListener('click', (e) => {
        if (!window.parentVisualEditActive) return;
        e.preventDefault();
        e.stopPropagation();

        if (selectedEl) {
          selectedEl.classList.remove('ve-selected-outline');
        }
        selectedEl = e.target;
        if (!selectedEl || selectedEl === document.body || selectedEl === document.documentElement) return;

        selectedEl.classList.remove('ve-hover-outline');
        selectedEl.classList.add('ve-selected-outline');

        const style = window.getComputedStyle(selectedEl);
        const rect = selectedEl.getBoundingClientRect();

        window.parent.postMessage({
          type: 'elementSelected',
          tagName: selectedEl.tagName.toLowerCase(),
          textContent: selectedEl.textContent.trim(),
          computedStyle: {
            color: style.color,
            backgroundColor: style.backgroundColor,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            margin: style.margin,
            padding: style.padding,
            textAlign: style.textAlign
          },
          rect: {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height
          }
        }, '*');
      }, true);

      window.addEventListener('message', (e) => {
        console.log('Iframe received message:', e.data.type, e.data.active);
        if (e.data.type === 'updateElement') {
          if (selectedEl) {
            if (e.data.prop === 'textContent') {
              selectedEl.textContent = e.data.value;
            } else {
              selectedEl.style[e.data.prop] = e.data.value;
            }
            const rect = selectedEl.getBoundingClientRect();
            window.parent.postMessage({ type: 'rectUpdated', rect }, '*');
          }
        } else if (e.data.type === 'setVisualEditActive') {
          window.parentVisualEditActive = e.data.active;
          console.log('Iframe Visual Edit Active:', window.parentVisualEditActive);
          if (!e.data.active) {
            if (lastHovered) lastHovered.classList.remove('ve-hover-outline');
            if (selectedEl) selectedEl.classList.remove('ve-selected-outline');
            selectedEl = null;
          }
        }
      });

      // Report ready to parent
      window.parent.postMessage({ type: 'iframeReady' }, '*');
    })();
  </script>
</body>
</html>`;
}
