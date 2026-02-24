/**
 * Test component set code generation for all 5 frameworks.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { load } from 'js-yaml';
import { parseComponentSet } from '../src/figma/component-set-parser.js';
import { generateComponentSetCode } from '../src/compile/component-set-codegen.js';
import type { Framework } from '../src/types/index.js';

const yamlPath = './output/debug-component-set.yaml';
const yamlContent = readFileSync(yamlPath, 'utf-8');
const data = load(yamlContent) as any;

const parsed = parseComponentSet(data);
if (!parsed) {
  console.error('FAIL: parseComponentSet returned null');
  process.exit(1);
}

const frameworks: Framework[] = ['react', 'vue', 'svelte', 'angular', 'solid'];
const result = generateComponentSetCode(parsed, frameworks);

console.log(`Component: ${result.componentName}`);
console.log(`CSS lines: ${result.css.split('\n').length}`);
console.log('');

// Save outputs
const outDir = './output/component-set-test';
mkdirSync(outDir, { recursive: true });

const extensions: Record<Framework, string> = {
  react: '.jsx',
  vue: '.vue',
  svelte: '.svelte',
  angular: '.ts',
  solid: '.tsx',
};

for (const fw of frameworks) {
  const code = result.frameworkOutputs[fw];
  const filename = `${result.componentName}${extensions[fw]}`;
  writeFileSync(`${outDir}/${filename}`, code);
  console.log(`✓ ${fw}: ${filename} (${code.split('\n').length} lines)`);
}

// Show React output as sample
console.log('\n=== React Output ===');
console.log(result.frameworkOutputs.react);
