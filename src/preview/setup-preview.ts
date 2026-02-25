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
  // Remove node ID suffix if present (e.g., "Show Left Icon#3371:152")
  const cleanName = str.replace(/#\d+:\d+$/, '');

  return cleanName
    .replace(/[-_\s]+(.)?/g, (_, char) => (char ? char.toUpperCase() : ''))
    .replace(/^[A-Z]/, (char) => char.toLowerCase());
}

/**
 * Generate App.jsx content to display the component
 * Uses metadata.axes to dynamically generate all variant combinations
 */
function generateAppContent(componentName: string, metadata: any, assetFiles: string[] = []): string {
  // If no metadata, generate a simple preview
  if (!metadata || !metadata.axes || metadata.axes.length === 0) {
    return generateSimplePreview(componentName);
  }

  // Extract axes from metadata
  const axes = metadata.axes || [];

  // Find specific axes
  const styleAxis = axes.find((a: any) => a.name.toLowerCase().includes('style') || a.name.toLowerCase().includes('variant'));
  const sizeAxis = axes.find((a: any) => a.name.toLowerCase() === 'size');
  const stateAxis = axes.find((a: any) => a.name.toLowerCase() === 'state');

  // Build arrays for each axis
  const styles = styleAxis ? styleAxis.values : ['default'];
  const sizes = sizeAxis ? sizeAxis.values : ['medium'];
  const states = stateAxis ? stateAxis.values : ['default'];

  console.log(`Generating preview for ${componentName}:`);
  console.log(`  Styles: ${styles.join(', ')}`);
  console.log(`  Sizes: ${sizes.join(', ')}`);
  console.log(`  States: ${states.join(', ')}`);
  console.log(`  Total: ${styles.length} × ${sizes.length} × ${states.length} = ${styles.length * sizes.length * states.length} variants`);

  return `import ${componentName} from './components/${componentName}'
import metadata from './components/${componentName}.meta.json'

// Dynamically generate all variant combinations from metadata
const axes = metadata.axes || []
const styleAxis = axes.find(a => a.name.toLowerCase().includes('style') || a.name.toLowerCase().includes('variant'))
const sizeAxis = axes.find(a => a.name === 'Size')
const stateAxis = axes.find(a => a.name === 'State')

const styles = styleAxis ? styleAxis.values : ['default']
const sizes = sizeAxis ? sizeAxis.values : ['medium']
const states = stateAxis ? stateAxis.values : ['default']

// Normalize variant names to match CSS class naming convention
function normalizeVariantName(name) {
  return name
    .replace(/[()]/g, '')  // Remove parentheses
    .replace(/\\s+/g, '-')   // Replace spaces with dashes
    .toLowerCase()
}

// Map state names to prop names
function mapStateToProps(state) {
  const stateLower = state.toLowerCase()
  if (stateLower === 'default') return {}
  if (stateLower === 'hover') return { hover: true }
  if (stateLower === 'focus') return { focus: true }
  if (stateLower === 'disabled') return { disabled: true }
  if (stateLower === 'loading') return { loading: true }
  if (stateLower.includes('error')) return { error: true }
  if (stateLower.includes('filled')) return { filled: true }
  return {}
}

// Generate all variant combinations
const allVariants = styles.flatMap(style =>
  sizes.flatMap(size =>
    states.map(state => ({
      label: \`\${style} / \${size} / \${state}\`,
      props: {
        variant: normalizeVariantName(style),
        size: normalizeVariantName(size),
        ...mapStateToProps(state)
      }
    }))
  )
)

console.log('Generated variants:', allVariants.length)
console.log('Sample:', allVariants.slice(0, 3))

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
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif', background: '#f8f9fa', minHeight: '100vh' }}>
      <div style={{ maxWidth: '1600px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '40px' }}>
          <h1 style={{ margin: '0 0 8px', fontSize: '32px', fontWeight: 700, color: '#1a1a1a' }}>
            ${componentName}
          </h1>
          <p style={{ margin: '0 0 16px', color: '#666', fontSize: '16px', lineHeight: '1.5' }}>
            Generated from Figma using figma-to-mitosis
          </p>
          <div style={{
            display: 'inline-flex',
            gap: '12px',
            padding: '8px 12px',
            background: '#e8f5e9',
            borderRadius: '6px',
            fontSize: '13px',
            color: '#2e7d32',
            fontWeight: 500
          }}>
            ✅ {allVariants.length} variants rendered dynamically from metadata
          </div>
        </div>

        {/* All Variants Grid */}
        <div style={{
          background: 'white',
          borderRadius: '12px',
          padding: '32px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ margin: '0 0 24px', fontSize: '18px', fontWeight: 600, color: '#333' }}>
            All Variants
          </h2>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: '24px'
          }}>
            {allVariants.map((v) => (
              <div key={v.label} style={{
                padding: '16px',
                background: '#f8f9fa',
                borderRadius: '8px',
                border: '1px solid #e0e0e0'
              }}>
                <div style={labelStyle}>{v.label}</div>
                <${componentName} {...v.props}>{v.props.label || 'Button'}</${componentName}>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}

export default App
`;
}

/**
 * Generate simple preview for components without variant metadata
 */
function generateSimplePreview(componentName: string): string {
  return `import ${componentName} from './components/${componentName}'

// Generate all variant combinations for preview
const styles = ['subtle', 'neutral', 'primary']
const sizes = ['medium', 'small']
const states = [
  { label: 'Default', props: {} },
  { label: 'Hover', props: { hover: true } },
  { label: 'Focus', props: { focus: true } },
  { label: 'Disabled', props: { disabled: true } },
  { label: 'Loading', props: { loading: true } },
]

// All variants: styles × sizes × states
const allVariants = styles.flatMap((style) =>
  sizes.flatMap((size) =>
    states.map((state) => ({
      label: \`\${style} / \${size} / \${state.label}\`,
      props: {
        ...(style !== 'subtle' ? { variant: style } : {}),
        ...(size !== 'medium' ? { size } : {}),
        ...state.props,
      },
    }))
  )
)

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
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif', background: '#f8f9fa', minHeight: '100vh' }}>
      <div style={{ maxWidth: '1600px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '40px' }}>
          <h1 style={{ margin: '0 0 8px', fontSize: '32px', fontWeight: 700, color: '#1a1a1a' }}>
            ${componentName}
          </h1>
          <p style={{ margin: '0 0 16px', color: '#666', fontSize: '16px', lineHeight: '1.5' }}>
            Generated from Figma using figma-to-mitosis
          </p>
          <div style={{
            display: 'inline-flex',
            gap: '12px',
            padding: '8px 12px',
            background: '#e8f5e9',
            borderRadius: '6px',
            fontSize: '13px',
            color: '#2e7d32',
            fontWeight: 500
          }}>
            ✅ All variants rendered with component properties
          </div>
        </div>

        {/* All Variants Grid */}
        <div style={{
          background: 'white',
          borderRadius: '12px',
          padding: '32px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ margin: '0 0 24px', fontSize: '18px', fontWeight: 600, color: '#333' }}>
            All Variants
          </h2>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: '24px'
          }}>
            {allVariants.map((v) => (
              <div key={v.label} style={{
                padding: '16px',
                background: '#f8f9fa',
                borderRadius: '8px',
                border: '1px solid #e0e0e0'
              }}>
                <div style={labelStyle}>{v.label}</div>
                <${componentName}${basePropsString}{...v.props}>Button</${componentName}>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}

export default App
`;
}

/**
 * Get preview URL (assumes dev server is running)
 */
export function getPreviewUrl(port: number = 5173): string {
  return `http://localhost:${port}`;
}
