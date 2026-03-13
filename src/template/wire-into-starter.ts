/**
 * Wires a generated React component into the figma-to-code-starter-main template.
 * When --template is used, after writeOutputFiles() we copy the starter to output/app/,
 * place the component in src/components/, copy assets to public/assets/, and add a route.
 */

import {
  existsSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  cpSync,
} from 'node:fs';
import { join } from 'node:path';
import { normalizeStateName, normalizeVariantName } from '../shadcn/style-extractor.js';

// Local copy of preview's toCamelCase for prop names
function toCamelCase(str: string): string {
  const clean = str.replace(/#\d+:\d+$/, '');
  return clean
    .replace(/[-_\s]+(.)?/g, (_: unknown, c: string) => (c ? c.toUpperCase() : ''))
    .replace(/^[A-Z]/, (c) => c.toLowerCase());
}

export interface WireIntoStarterOptions {
  /** Output directory that already contains the generated files (e.g. output/ComponentName-sessionId) */
  componentOutputDir: string;
  /** Component name (e.g. TextareaField) */
  componentName: string;
  /** Path to the figma-to-code-starter-main template directory */
  starterDir: string;
  /** Optional component property definitions (for variant grid) */
  componentPropertyDefinitions?: Record<string, any>;
  /** LLM-customized shadcn component source (.tsx) */
  updatedShadcnSource?: string;
  /** shadcn component name (e.g. "button") */
  shadcnComponentName?: string;
  /** Actual Figma variant names (e.g. ["State=Default, Size=Medium, Color=Green", ...]) — used to filter preview to only existing combos */
  figmaVariantNames?: string[];
}

/**
 * Rewrite asset paths in component code: ./assets/ → /assets/ for Vite public folder.
 */
function rewriteAssetPaths(code: string): string {
  return code
    .replace(/["']\.\/assets\/([^"']+)["']/g, '"/assets/$1"')
    .replace(/src=["']\.\/assets\/([^"']+)["']/g, 'src="/assets/$1"');
}

/**
 * Copy a directory recursively, skipping node_modules and .git.
 */
function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      mkdirSync(join(destPath, '..'), { recursive: true });
      copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Copy the starter template into componentOutputDir/app, write the generated component
 * into src/components/, copy assets to public/assets/, and patch App.tsx with a new route.
 *
 * @returns Path to the app directory (e.g. componentOutputDir/app)
 */
export function wireIntoStarter(options: WireIntoStarterOptions): string {
  const { componentOutputDir, componentName, starterDir, componentPropertyDefinitions, updatedShadcnSource, shadcnComponentName, figmaVariantNames } = options;

  if (!existsSync(starterDir)) {
    throw new Error(`Starter template not found at ${starterDir}`);
  }

  const appDir = join(componentOutputDir, 'app');
  const reactPath = join(componentOutputDir, `${componentName}.jsx`);
  const assetsDir = join(componentOutputDir, 'assets');

  // 1. Copy starter to output/app
  copyDirRecursive(starterDir, appDir);

  const componentsDir = join(appDir, 'src', 'components');
  const publicAssetsDir = join(appDir, 'public', 'assets');
  mkdirSync(componentsDir, { recursive: true });
  mkdirSync(publicAssetsDir, { recursive: true });

  // 2. Write component into src/components/ (rewrite asset paths)
  if (existsSync(reactPath)) {
    let code = readFileSync(reactPath, 'utf-8');
    code = rewriteAssetPaths(code);
    const componentExt = reactPath.endsWith('.tsx') ? '.tsx' : '.jsx';
    const destComponentPath = join(componentsDir, `${componentName}${componentExt}`);
    writeFileSync(destComponentPath, code, 'utf-8');

    // Copy companion CSS file if it exists (chart components import ./ComponentName.css)
    const cssPath = join(componentOutputDir, `${componentName}.css`);
    if (existsSync(cssPath)) {
      copyFileSync(cssPath, join(componentsDir, `${componentName}.css`));
    }

    // Add recharts dependency if the component uses it
    if (code.includes("from 'recharts'") || code.includes('from "recharts"')) {
      const pkgPath = join(appDir, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        pkg.dependencies = pkg.dependencies || {};
        if (!pkg.dependencies['recharts']) {
          pkg.dependencies['recharts'] = '^2.12.0';
        }
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
      }
    }
  }

  // 3. Copy assets to public/assets
  if (existsSync(assetsDir)) {
    const files = readdirSync(assetsDir);
    for (const file of files) {
      copyFileSync(join(assetsDir, file), join(publicAssetsDir, file));
    }
  }

  // 3b. Copy LLM-customized shadcn component source to ui/ directory
  if (updatedShadcnSource && shadcnComponentName) {
    const uiDir = join(appDir, 'src', 'components', 'ui');
    mkdirSync(uiDir, { recursive: true });
    writeFileSync(join(uiDir, `${shadcnComponentName}.tsx`), updatedShadcnSource, 'utf-8');
  }

  // 4. Create a page that renders the component (single or variant grid)
  const previewPagePath = join(appDir, 'src', 'pages', 'component-preview.tsx');
  mkdirSync(join(appDir, 'src', 'pages'), { recursive: true });
  let previewPageContent: string;

  if (!componentPropertyDefinitions) {
    // Simple preview: single instance
    previewPageContent = `import ${componentName} from "@/components/${componentName}";

export function ComponentPreviewPage() {
  return (
    <div className="min-h-dvh bg-[var(--color-background)] p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          ${componentName}
        </h1>
        <p className="text-[var(--color-muted-foreground)] text-sm">
          Generated from Figma — edit in src/components/${componentName}.jsx
        </p>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-6">
          <${componentName} />
        </div>
      </div>
    </div>
  );
}
`;
  } else {
    // Variant grid preview: compute allVariants in Node based on prop definitions
    const variantAxes: Array<{ name: string; camel: string; values: string[]; defaultValue?: string }> = [];
    const booleanProps: Array<{ name: string; camel: string; defaultValue: boolean }> = [];

    for (const [name, def] of Object.entries(componentPropertyDefinitions)) {
      if (def && def.type === 'VARIANT' && Array.isArray(def.variantOptions)) {
        variantAxes.push({
          name,
          camel: toCamelCase(name),
          values: def.variantOptions as string[],
          defaultValue: (def as any).defaultValue as string | undefined,
        });
      } else if (def && def.type === 'BOOLEAN') {
        booleanProps.push({
          name,
          camel: toCamelCase(name),
          defaultValue: def.defaultValue ?? true,
        });
      }
    }

    // Detect state axis
    const stateKeywords = ['default', 'hover', 'focus', 'disabled', 'loading', 'active', 'pressed', 'error'];
    const stateAxisIdx = variantAxes.findIndex((a) => {
      if (a.name.toLowerCase() === 'state') return true;
      const lowerVals = a.values.map((v) => v.toLowerCase());
      return lowerVals.filter((v) => stateKeywords.includes(v)).length >= 2;
    });

    const stateAxis = stateAxisIdx >= 0 ? variantAxes.splice(stateAxisIdx, 1)[0] : null;
    const propAxes = variantAxes;

    // Build state entries
    // When shadcn is active, pass state as string prop; otherwise use boolean flags
    const isShadcn = !!(updatedShadcnSource && shadcnComponentName);
    type StateEntry = { label: string; props: Record<string, any> };
    let stateEntries: StateEntry[] = [{ label: 'Default', props: {} }];
    if (stateAxis) {
      stateEntries = stateAxis.values.map((val) => {
        const lower = val.toLowerCase();
        if (lower === 'default') {
          return { label: val, props: isShadcn ? { state: 'default' } : {} };
        }
        if (isShadcn) {
          // Use normalized kebab-case to match CVA state keys: "Filled in" → "filled-in"
          return { label: val, props: { state: normalizeStateName(val) } };
        }
        const parts = val.split(/[-\s]+/).filter(Boolean);
        const props: Record<string, boolean> = {};
        for (const part of parts) {
          props[toCamelCase(part)] = true;
        }
        return { label: val, props };
      });
    }

    // Base boolean props (default true)
    const baseProps: Record<string, boolean> = {};
    for (const bp of booleanProps) {
      if (bp.defaultValue === true) {
        baseProps[bp.camel] = true;
      }
    }

    // Parse actual CVA key names from the generated shadcn source
    const cvaKeys: Record<string, boolean> = {};
    if (updatedShadcnSource) {
      const cvaMatch = updatedShadcnSource.match(/variants\s*:\s*\{([\s\S]*?)\n\s*\}/);
      if (cvaMatch) {
        const variantBlock = cvaMatch[1];
        for (const m of variantBlock.matchAll(/^\s*(\w+)\s*:/gm)) {
          cvaKeys[m[1]] = true;
        }
      }
    }

    // Map prop axes to component prop names using actual CVA keys
    const propMappings = propAxes.map((axis) => {
      const camel = axis.camel;
      let propName: string;
      if (cvaKeys[camel]) {
        propName = camel;
      } else if (cvaKeys['variant'] && (axis.name.toLowerCase() === 'style' || axis.name.toLowerCase() === 'type')) {
        propName = 'variant';
      } else {
        // Find a matching CVA key, excluding size/state
        propName = Object.keys(cvaKeys).find(k => k !== 'size' && k !== 'state') || camel;
      }
      return { axis, propName };
    });

    // Build cartesian product of prop axes
    type VariantEntry = { label: string; props: Record<string, any> };
    let allVariants: VariantEntry[] = [];

    if (propAxes.length === 0) {
      allVariants = stateEntries.map((state) => ({
        label: state.label,
        props: { ...baseProps, ...state.props },
      }));
    } else {
      // Build nested loops
      function buildVariants(
        axisIdx: number,
        currentAxisValues: Record<string, string>,
      ): VariantEntry[] {
        if (axisIdx >= propMappings.length) {
          // At innermost: combine with each state
          const entries: VariantEntry[] = [];
          for (const state of stateEntries) {
            const labelParts = [
              ...propMappings.map((m) => currentAxisValues[m.axis.camel] ?? m.axis.values[0]).map(String),
              state.label,
            ];
            const props: Record<string, any> = { ...baseProps };
            // Only set prop when axis value differs from default
            propMappings.forEach((m) => {
              const value = currentAxisValues[m.axis.camel] ?? m.axis.values[0];
              const defaultVal = m.axis.defaultValue ?? m.axis.values[0];
              if (String(value).toLowerCase() !== String(defaultVal).toLowerCase()) {
                props[m.propName] = isShadcn ? normalizeVariantName(String(value)) : String(value).toLowerCase();
              }
            });
            Object.assign(props, state.props);
            entries.push({ label: labelParts.join(' / '), props });
          }
          return entries;
        }

        const m = propMappings[axisIdx];
        const entries: VariantEntry[] = [];
        for (const val of m.axis.values) {
          const nextAxisValues = { ...currentAxisValues, [m.axis.camel]: val };
          entries.push(...buildVariants(axisIdx + 1, nextAxisValues));
        }
        return entries;
      }

      allVariants = buildVariants(0, {});
    }

    // Filter to only combos that actually exist in Figma (avoid rendering non-existent combos like grey+default)
    if (figmaVariantNames && figmaVariantNames.length > 0) {
      // Build a set of normalized Figma combo keys: sorted lowercase values joined by "|"
      const figmaCombos = new Set<string>();
      for (const name of figmaVariantNames) {
        const values: string[] = [];
        for (const part of name.split(',').map((s: string) => s.trim())) {
          const eq = part.indexOf('=');
          if (eq > 0) values.push(part.slice(eq + 1).trim().toLowerCase());
        }
        // Sort values alphabetically for consistent matching
        const key = values.sort().join('|');
        figmaCombos.add(key);
      }

      allVariants = allVariants.filter((entry) => {
        // Collect all values from label (which has ALL axis values including defaults)
        const labelParts = entry.label.split(' / ').map((s: string) => s.trim().toLowerCase());
        const key = [...labelParts].sort().join('|');
        return figmaCombos.has(key);
      });
    }

    const allVariantsLiteral = JSON.stringify(allVariants, null, 2);

    previewPageContent = `import ${componentName} from "@/components/${componentName}";

const allVariants = ${allVariantsLiteral} as const;

export function ComponentPreviewPage() {
  return (
    <div className="min-h-dvh bg-[var(--color-background)] p-4">
      <div className="mx-auto space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            ${componentName}
          </h1>
          <p className="text-[var(--color-muted-foreground)] text-sm">
            {allVariants.length} variant combination{allVariants.length !== 1 ? 's' : ''}.
          </p>
        </header>
        <div className="grid gap-4 grid-cols-2">
          {allVariants.map((v, idx) => (
            <div
              key={idx}
              className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 overflow-hidden"
            >
              <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--color-muted-foreground)]">
                {v.label}
              </p>
              <div className="mt-1">
                <${componentName} {...(v as any).props} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
`;
  }
  writeFileSync(previewPagePath, previewPageContent, 'utf-8');

  // 5. Patch App.tsx: import preview page and point "/" to it
  const appPath = join(appDir, 'src', 'App.tsx');
  let appContent = readFileSync(appPath, 'utf-8');

  // Insert import for ComponentPreviewPage after the ThemeProvider import
  const importMarker = 'import { ThemeProvider } from "@/components/theme-provider";';
  if (!appContent.includes('ComponentPreviewPage')) {
    appContent = appContent.replace(
      importMarker,
      `${importMarker}\nimport { ComponentPreviewPage } from "@/pages/component-preview";`,
    );
  }

  // Replace "/" route element so it renders the preview page
  appContent = appContent.replace(
    '<Route path="/" element={<LandingPage />} />',
    '<Route path="/" element={<ComponentPreviewPage />} />',
  );

  writeFileSync(appPath, appContent, 'utf-8');

  return appDir;
}
