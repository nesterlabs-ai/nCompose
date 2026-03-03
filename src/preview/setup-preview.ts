/**
 * Preview Setup Utility
 *
 * Sets up the preview-app to display a generated component
 * - Cleans old components and assets
 * - Copies component to preview-app/src/components/
 * - Copies assets to preview-app/public/assets/
 * - Updates App.jsx to render the component
 */

import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, unlinkSync, rmSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Archive old components and assets before cleaning
 * Creates a timestamped backup in preview-app/_archive/
 */
function archiveOldComponents(previewAppDir: string): void {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const archiveDir = join(previewAppDir, '_archive', `backup-${timestamp}`);

  const componentsDir = join(previewAppDir, 'src', 'components');
  const assetsDir = join(previewAppDir, 'public', 'assets');

  let hasContent = false;

  // Archive components if they exist
  if (existsSync(componentsDir)) {
    const items = readdirSync(componentsDir);
    if (items.length > 0) {
      const archiveComponentsDir = join(archiveDir, 'components');
      mkdirSync(archiveComponentsDir, { recursive: true });
      for (const item of items) {
        cpSync(join(componentsDir, item), join(archiveComponentsDir, item), { recursive: true });
      }
      hasContent = true;
    }
  }

  // Archive assets if they exist
  if (existsSync(assetsDir)) {
    const items = readdirSync(assetsDir);
    if (items.length > 0) {
      const archiveAssetsDir = join(archiveDir, 'assets');
      mkdirSync(archiveAssetsDir, { recursive: true });
      for (const item of items) {
        cpSync(join(assetsDir, item), join(archiveAssetsDir, item), { recursive: true });
      }
      hasContent = true;
    }
  }

  if (hasContent) {
    console.log(`✓ Archived old components to ${archiveDir}`);
  }
}

/**
 * Clean preview app before setting up new component
 * Removes ALL old components and assets to prevent interference
 * Optionally archives old content before cleaning
 */
export function cleanPreviewApp(previewAppDir: string, options?: { archive?: boolean }): void {
  // Archive old components before cleaning (if requested)
  if (options?.archive) {
    archiveOldComponents(previewAppDir);
  }

  let cleanedItems = 0;

  // Clean components directory - remove ALL files and directories
  const componentsDir = join(previewAppDir, 'src', 'components');
  if (existsSync(componentsDir)) {
    const items = readdirSync(componentsDir);
    for (const item of items) {
      const itemPath = join(componentsDir, item);
      try {
        rmSync(itemPath, { recursive: true, force: true });
        cleanedItems++;
      } catch (err) {
        console.warn(`Warning: Failed to remove ${itemPath}:`, err);
      }
    }
    if (cleanedItems > 0) {
      console.log(`✓ Cleaned ${cleanedItems} old component(s) and directories`);
    }
  }

  // Clean assets directory - remove ALL files
  const assetsDir = join(previewAppDir, 'public', 'assets');
  let cleanedAssets = 0;
  if (existsSync(assetsDir)) {
    const files = readdirSync(assetsDir);
    for (const file of files) {
      const filePath = join(assetsDir, file);
      try {
        rmSync(filePath, { recursive: true, force: true });
        cleanedAssets++;
      } catch (err) {
        console.warn(`Warning: Failed to remove ${filePath}:`, err);
      }
    }
    if (cleanedAssets > 0) {
      console.log(`✓ Cleaned ${cleanedAssets} old asset(s)`);
    }
  }
}

export interface PreviewSetupOptions {
  componentName: string;
  componentPath: string;  // Path to generated .jsx file
  assetsDir?: string;      // Path to assets directory
  previewAppDir: string;   // Path to preview-app
  componentPropertyDefinitions?: Record<string, any>;  // Figma component properties
  metadataPath?: string;   // Path to .meta.json file
}

/**
 * Set up preview app to display generated component
 */
export async function setupPreview(options: PreviewSetupOptions): Promise<void> {
  const { componentName, componentPath, assetsDir, previewAppDir, metadataPath } = options;

  // 1. Create necessary directories
  const componentsDir = join(previewAppDir, 'src', 'components');
  const publicAssetsDir = join(previewAppDir, 'public', 'assets');

  if (!existsSync(componentsDir)) {
    mkdirSync(componentsDir, { recursive: true });
  }
  if (!existsSync(publicAssetsDir)) {
    mkdirSync(publicAssetsDir, { recursive: true });
  }

  // 2. Copy component to preview-app/src/components/
  const destComponentPath = join(componentsDir, `${componentName}.jsx`);
  copyFileSync(componentPath, destComponentPath);
  console.log(`✓ Copied component to ${destComponentPath}`);

  // 3. Copy metadata if it exists
  let metadata: any = null;
  if (metadataPath && existsSync(metadataPath)) {
    const destMetadataPath = join(componentsDir, `${componentName}.meta.json`);
    copyFileSync(metadataPath, destMetadataPath);
    console.log(`✓ Copied metadata to ${destMetadataPath}`);

    // Read metadata for App.jsx generation
    metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
  }

  // 4. Copy assets if they exist
  let assetFiles: string[] = [];
  if (assetsDir && existsSync(assetsDir)) {
    const fs = await import('fs/promises');
    assetFiles = await fs.readdir(assetsDir);

    for (const file of assetFiles) {
      const srcPath = join(assetsDir, file);
      const destPath = join(publicAssetsDir, file);
      copyFileSync(srcPath, destPath);
    }

    if (assetFiles.length > 0) {
      console.log(`✓ Copied ${assetFiles.length} asset(s) to ${publicAssetsDir}`);
    }
  }

  // 5. Generate App.jsx to display the component
  const appContent = generateAppContent(componentName, metadata, assetFiles);
  const appPath = join(previewAppDir, 'src', 'App.jsx');
  writeFileSync(appPath, appContent);
  console.log(`✓ Updated ${appPath}`);
}

/**
 * Convert property name to camelCase (e.g., "Show Left Icon" -> "showLeftIcon")
 */
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

function buildDefaultProps(metadata: any): Record<string, string | boolean> {
  const defs = metadata?.componentPropertyDefinitions;
  if (!defs || typeof defs !== 'object') return {};

  const defaults: Record<string, string | boolean> = {};
  const seen = new Set<string>();

  for (const [rawName, def] of Object.entries(defs as Record<string, any>)) {
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

function buildVariantEntries(metadata: any): Array<{ label: string; props: Record<string, string | boolean> }> {
  const variants = metadata?.variants;
  if (!Array.isArray(variants) || variants.length === 0) return [];

  const axisMap = new Map<string, { name: string; values: string[] }>();
  if (Array.isArray(metadata?.axes)) {
    for (const axis of metadata.axes) {
      if (axis?.name && Array.isArray(axis?.values)) {
        axisMap.set(axis.name, axis);
      }
    }
  }

  return variants.map((variant: any, index: number) => {
    const props: Record<string, string | boolean> = {};
    const rawProps = variant?.props && typeof variant.props === 'object' ? variant.props : {};

    for (const [axisName, rawValue] of Object.entries(rawProps)) {
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

    const label = typeof variant?.name === 'string' && variant.name.length > 0
      ? variant.name
      : `Variant ${index + 1}`;
    return { label, props };
  });
}

function generateRawPreview(componentName: string, defaultProps: Record<string, string | boolean>): string {
  const defaultPropsLiteral = JSON.stringify(defaultProps, null, 2);
  return `import ${componentName} from './components/${componentName}'

const defaultProps = ${defaultPropsLiteral}

function App() {
  return <${componentName} {...defaultProps} />
}

export default App
`;
}

function generateGridPreview(
  componentName: string,
  defaultProps: Record<string, string | boolean>,
  variants: Array<{ label: string; props: Record<string, string | boolean> }>,
): string {
  const defaultPropsLiteral = JSON.stringify(defaultProps, null, 2);
  const variantsLiteral = JSON.stringify(variants, null, 2);

  return `import ${componentName} from './components/${componentName}'

const defaultProps = ${defaultPropsLiteral}
const allVariants = ${variantsLiteral}

const labelStyle = {
  fontSize: '11px',
  fontWeight: 600,
  color: '#888',
  textTransform: 'uppercase',
  marginBottom: '8px',
  letterSpacing: '0.05em',
}

function App() {
  return (
    <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif', background: '#f8f9fa', minHeight: '100vh' }}>
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
          gap: '16px'
        }}>
          {allVariants.map((v, idx) => (
            <div key={idx} style={{
              padding: '16px',
              background: '#fff',
              borderRadius: '10px',
              border: '1px solid #e5e7eb'
            }}>
              <div style={labelStyle}>{v.label}</div>
              <${componentName} {...defaultProps} {...v.props} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default App
`;
}

/**
 * Generate App.jsx content to display the component.
 * Default mode (`raw`) renders a single exact default instance.
 */
function generateAppContent(componentName: string, metadata: any, _assetFiles: string[] = []): string {
  const defaultProps = buildDefaultProps(metadata);

  if (config.preview.mode !== 'grid') {
    return generateRawPreview(componentName, defaultProps);
  }

  const variants = buildVariantEntries(metadata);
  if (variants.length === 0) {
    return generateRawPreview(componentName, defaultProps);
  }

  return generateGridPreview(componentName, defaultProps, variants);
}

/**
 * Get preview URL (assumes dev server is running)
 */
export function getPreviewUrl(port: number = config.preview.port): string {
  return `http://localhost:${port}`;
}
