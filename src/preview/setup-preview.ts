/**
 * Preview Setup Utility
 *
 * Sets up the preview-app to display a generated component
 * - Cleans old components and assets
 * - Copies component to preview-app/src/components/
 * - Copies assets to preview-app/public/assets/
 * - Updates App.jsx to render the component
 */

import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, unlinkSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Clean preview app before setting up new component
 * Removes old components and assets to prevent interference
 */
export function cleanPreviewApp(previewAppDir: string): void {
  // Clean components directory
  const componentsDir = join(previewAppDir, 'src', 'components');
  if (existsSync(componentsDir)) {
    const files = readdirSync(componentsDir);
    for (const file of files) {
      if (file.endsWith('.jsx') || file.endsWith('.tsx')) {
        unlinkSync(join(componentsDir, file));
      }
    }
    console.log(`✓ Cleaned ${files.length} old component(s)`);
  }

  // Clean assets directory
  const assetsDir = join(previewAppDir, 'public', 'assets');
  if (existsSync(assetsDir)) {
    const files = readdirSync(assetsDir);
    for (const file of files) {
      if (file.endsWith('.svg') || file.endsWith('.png') || file.endsWith('.jpg')) {
        unlinkSync(join(assetsDir, file));
      }
    }
    if (files.length > 0) {
      console.log(`✓ Cleaned ${files.length} old asset(s)`);
    }
  }
}

export interface PreviewSetupOptions {
  componentName: string;
  componentPath: string;  // Path to generated .jsx file
  assetsDir?: string;      // Path to assets directory
  previewAppDir: string;   // Path to preview-app
  componentPropertyDefinitions?: Record<string, any>;  // Figma component properties
}

/**
 * Set up preview app to display generated component
 */
export async function setupPreview(options: PreviewSetupOptions): Promise<void> {
  const { componentName, componentPath, assetsDir, previewAppDir } = options;

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

  // 3. Copy assets if they exist
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

  // 4. Generate App.jsx to display the component
  const appContent = generateAppContent(componentName, options.componentPropertyDefinitions, assetFiles);
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
 */
function generateAppContent(componentName: string, componentPropertyDefinitions?: Record<string, any>, assetFiles: string[] = []): string {
  // Build base props that should always be passed (from component properties)
  const basePropsLines: string[] = [];

  if (componentPropertyDefinitions) {
    for (const [propName, propDef] of Object.entries(componentPropertyDefinitions)) {
      // Skip VARIANT properties (they're handled separately via variant combinations)
      if (propDef.type === 'VARIANT') continue;

      const camelName = toCamelCase(propName);

      if (propDef.type === 'BOOLEAN' && propDef.defaultValue === true) {
        // BOOLEAN props with default=true should be passed as true
        basePropsLines.push(`  ${camelName}={true}`);
      } else if (propDef.type === 'INSTANCE_SWAP') {
        // INSTANCE_SWAP props get a matching icon asset if available
        // Try to find a matching asset file based on property name
        const propNameLower = propName.toLowerCase();
        let iconPath = '/assets/star.svg'; // fallback

        // Look for matching asset file (e.g., "Choose Left Icon" -> "left-icon.svg")
        for (const assetFile of assetFiles) {
          const fileNameLower = assetFile.toLowerCase().replace('.svg', '');
          if (propNameLower.includes(fileNameLower) || fileNameLower.includes('left') && propNameLower.includes('left') || fileNameLower.includes('right') && propNameLower.includes('right')) {
            iconPath = `/assets/${assetFile}`;
            break;
          }
        }

        basePropsLines.push(`  ${camelName}={<img src="${iconPath}" alt="icon" />}`);
      } else if (propDef.type === 'TEXT' && propDef.defaultValue) {
        // TEXT props with defaults (usually handled via children, but can be explicit)
        // Skip for now as they're typically passed via children
      }
    }
  }

  const basePropsString = basePropsLines.length > 0 ? '\n' + basePropsLines.join('\n') + '\n        ' : '';

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
