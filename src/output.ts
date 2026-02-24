import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Framework, AssetEntry } from './types/index.js';
import { FRAMEWORK_EXTENSIONS } from './types/index.js';

export interface WriteOutputOptions {
  outputDir: string;
  componentName: string;
  mitosisSource: string;
  frameworkOutputs: Record<string, string>;
  /** SVG/image assets to write into outputDir/assets/ */
  assets?: AssetEntry[];
}

/**
 * Writes all generated files to the output directory.
 *
 * Creates:
 * - <componentName>.lite.tsx (Mitosis source)
 * - <componentName>.<ext> for each framework
 * - assets/<filename>.svg for each exported SVG asset
 *
 * @returns List of file paths written
 */
export function writeOutputFiles(options: WriteOutputOptions): string[] {
  const { outputDir, componentName, mitosisSource, frameworkOutputs, assets } = options;
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

  // Write SVG assets to assets/ subdirectory
  if (assets && assets.length > 0) {
    const assetsDir = join(outputDir, 'assets');
    mkdirSync(assetsDir, { recursive: true });

    for (const asset of assets) {
      if (!asset.content) continue; // skip if download failed
      const assetPath = join(assetsDir, asset.filename);
      writeFileSync(assetPath, asset.content, 'utf-8');
      writtenPaths.push(assetPath);
    }
  }

  return writtenPaths;
}
