import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Framework, AssetEntry, FidelityReport, ChartComponent, ShadcnSubComponent, VariantSpec } from './types/index.js';
import { FRAMEWORK_EXTENSIONS } from './types/index.js';
import { stripDataVeIds } from './compile/strip-ve-ids.js';

export interface WriteOutputOptions {
  outputDir: string;
  componentName: string;
  mitosisSource: string;
  frameworkOutputs: Record<string, string>;
  /** SVG/image assets to write into outputDir/assets/ */
  assets?: AssetEntry[];
  /** Component property definitions from Figma */
  componentPropertyDefinitions?: Record<string, any>;
  /** Variant axes metadata */
  variantMetadata?: {
    axes: Array<{ name: string; values: string[]; default: string }>;
    variants: Array<{ name: string; props: Record<string, string> }>;
  };
  /** Fidelity diagnostics report */
  fidelityReport?: FidelityReport;
  /** Standalone chart components generated from chart sections */
  chartComponents?: ChartComponent[];
  /** LLM-customized shadcn component source (.tsx) */
  updatedShadcnSource?: string;
  /** shadcn component name (e.g. "button") */
  shadcnComponentName?: string;
  /** shadcn sub-components generated from child nodes in a composite component */
  shadcnSubComponents?: ShadcnSubComponent[];
  /** Element-to-code map for visual edit (data-ve-id → metadata) */
  elementMap?: Record<string, { path: string; tagName: string; textContent?: string; className?: string; id?: string }>;
  /** Per-variant visual specifications (base + axis diffs) for scoped visual edits */
  variantSpec?: VariantSpec;
}

/**
 * Writes all generated files to the output directory.
 *
 * Creates:
 * - <componentName>.lite.tsx (Mitosis source)
 * - <componentName>.<ext> for each framework
 * - <componentName>.meta.json (variant metadata for preview app)
 * - <componentName>.fidelity.json (generation fidelity diagnostics)
 * - assets/<filename>.svg for each exported SVG asset
 *
 * @returns List of file paths written
 */
export function writeOutputFiles(options: WriteOutputOptions): string[] {
  const {
    outputDir,
    componentName,
    mitosisSource,
    frameworkOutputs,
    assets,
    componentPropertyDefinitions,
    variantMetadata,
    fidelityReport,
    chartComponents,
  } = options;
  const writtenPaths: string[] = [];

  // Ensure output directory exists
  mkdirSync(outputDir, { recursive: true });

  // Write Mitosis source
  const mitosisPath = join(outputDir, `${componentName}.lite.tsx`);
  writeFileSync(mitosisPath, mitosisSource, 'utf-8');
  writtenPaths.push(mitosisPath);

  // Write framework outputs — strip data-ve-id (preview-only attribute) before writing
  for (const [fw, code] of Object.entries(frameworkOutputs)) {
    // Skip error outputs
    if (code.startsWith('// Error generating')) continue;

    const ext = FRAMEWORK_EXTENSIONS[fw as Framework] ?? '.tsx';
    const filePath = join(outputDir, `${componentName}${ext}`);
    writeFileSync(filePath, stripDataVeIds(code), 'utf-8');
    writtenPaths.push(filePath);
  }

  // Write variant metadata for preview app (includes elementMap for visual edit)
  if (variantMetadata || componentPropertyDefinitions || options.elementMap) {
    const metadataPath = join(outputDir, `${componentName}.meta.json`);
    const metadata = {
      componentName,
      axes: variantMetadata?.axes || [],
      variants: variantMetadata?.variants || [],
      componentPropertyDefinitions: componentPropertyDefinitions || {},
      elementMap: options.elementMap || undefined,
    };
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    writtenPaths.push(metadataPath);
  }

  // Write per-variant visual specifications for scoped visual edits
  if (options.variantSpec) {
    const specPath = join(outputDir, `${componentName}.variant-spec.json`);
    writeFileSync(specPath, JSON.stringify(options.variantSpec, null, 2), 'utf-8');
    writtenPaths.push(specPath);
  }

  // Write LLM-customized shadcn component source
  if (options.updatedShadcnSource && options.shadcnComponentName) {
    const shadcnPath = join(outputDir, `${options.shadcnComponentName}.tsx`);
    writeFileSync(shadcnPath, options.updatedShadcnSource, 'utf-8');
    writtenPaths.push(shadcnPath);
  }

  // Write shadcn sub-components (composite delegation)
  if (options.shadcnSubComponents?.length) {
    for (const sub of options.shadcnSubComponents) {
      const shadcnPath = join(outputDir, `${sub.shadcnComponentName}.tsx`);
      writeFileSync(shadcnPath, sub.updatedShadcnSource, 'utf-8');
      writtenPaths.push(shadcnPath);
    }
  }

  // Write fidelity diagnostics report
  if (fidelityReport) {
    const fidelityPath = join(outputDir, `${componentName}.fidelity.json`);
    writeFileSync(fidelityPath, JSON.stringify(fidelityReport, null, 2), 'utf-8');
    writtenPaths.push(fidelityPath);
  }

  // Write standalone chart component files (JSX + CSS)
  if (chartComponents && chartComponents.length > 0) {
    for (const chart of chartComponents) {
      if (chart.reactCode) {
        const jsxPath = join(outputDir, `${chart.name}.jsx`);
        writeFileSync(jsxPath, chart.reactCode, 'utf-8');
        writtenPaths.push(jsxPath);
      }
      if (chart.css) {
        const cssPath = join(outputDir, `${chart.name}.css`);
        writeFileSync(cssPath, chart.css, 'utf-8');
        writtenPaths.push(cssPath);
      }
    }
  }

  // Write SVG assets to assets/ subdirectory (deduplicated by filename)
  if (assets && assets.length > 0) {
    const assetsDir = join(outputDir, 'assets');
    mkdirSync(assetsDir, { recursive: true });

    const writtenFilenames = new Set<string>();
    for (const asset of assets) {
      if (!asset.content) {
        continue; // download failed or content is empty
      }
      if (writtenFilenames.has(asset.filename)) continue; // already written
      writtenFilenames.add(asset.filename);
      const assetPath = join(assetsDir, asset.filename);
      writeFileSync(assetPath, asset.content, 'utf-8');
      writtenPaths.push(assetPath);
    }
  }

  return writtenPaths;
}
