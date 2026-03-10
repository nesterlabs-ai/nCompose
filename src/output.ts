import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Framework, AssetEntry, FidelityReport, ChartComponent } from './types/index.js';
import { FRAMEWORK_EXTENSIONS } from './types/index.js';

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

  // Write framework outputs
  for (const [fw, code] of Object.entries(frameworkOutputs)) {
    // Skip error outputs
    if (code.startsWith('// Error generating')) continue;

    const ext = FRAMEWORK_EXTENSIONS[fw as Framework] ?? '.tsx';
    const filePath = join(outputDir, `${componentName}${ext}`);
    writeFileSync(filePath, code, 'utf-8');
    writtenPaths.push(filePath);
  }

  // Write variant metadata for preview app
  if (variantMetadata || componentPropertyDefinitions) {
    const metadataPath = join(outputDir, `${componentName}.meta.json`);
    const metadata = {
      componentName,
      axes: variantMetadata?.axes || [],
      variants: variantMetadata?.variants || [],
      componentPropertyDefinitions: componentPropertyDefinitions || {},
    };
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    writtenPaths.push(metadataPath);
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

  // Write SVG assets to assets/ subdirectory
  if (assets && assets.length > 0) {
    const assetsDir = join(outputDir, 'assets');
    mkdirSync(assetsDir, { recursive: true });

    for (const asset of assets) {
      if (!asset.content) {
        console.warn(`[output] Skipping asset "${asset.filename}" — download failed or content is empty`);
        continue;
      }
      const assetPath = join(assetsDir, asset.filename);
      writeFileSync(assetPath, asset.content, 'utf-8');
      writtenPaths.push(assetPath);
    }
  }

  return writtenPaths;
}
