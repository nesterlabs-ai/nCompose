/**
 * Quick test to validate component-set-parser against real Figma YAML data.
 * Tests both ButtonDanger (3 axes) to verify regression, and logs
 * the new universal fields (classifiedStates, booleanProps, defaultVariantNode).
 */
import { readFileSync } from 'fs';
import { load } from 'js-yaml';
import { parseComponentSet, buildVariantCSS } from '../src/figma/component-set-parser.js';

const yamlPath = './output/debug-component-set.yaml';
const yamlContent = readFileSync(yamlPath, 'utf-8');
const data = load(yamlContent) as any;

console.log('=== Testing parseComponentSet (ButtonDanger) ===\n');

const result = parseComponentSet(data);
if (!result) {
  console.error('FAIL: parseComponentSet returned null');
  process.exit(1);
}

console.log(`Component name: ${result.name}`);
console.log(`Axes: ${result.axes.map((a) => `${a.name}=[${a.values.join(', ')}]`).join(' | ')}`);
console.log(`Prop axes: ${result.propAxes.map((a) => a.name).join(', ')}`);
console.log(`State axis: ${result.stateAxis ? result.stateAxis.values.join(', ') : 'none'}`);
console.log(`Classified states: ${result.classifiedStates.map((s) => `${s.originalValue}→bool:${s.booleanCondition ?? '-'},css:${s.cssSelector || '-'}`).join(', ')}`);
console.log(`Boolean props: ${result.booleanProps.join(', ') || 'none'}`);
console.log(`Total variants: ${result.variants.length}`);
console.log(`Default variant props: ${JSON.stringify(result.defaultVariant.props)}`);
console.log(`Default variant node name: ${result.defaultVariantNode?.name ?? 'MISSING'}`);

// Check default variant styles
console.log('\n=== Default Variant Styles ===');
console.log('Container:', JSON.stringify(result.defaultVariant.styles.container, null, 2));
console.log('Text:', JSON.stringify(result.defaultVariant.styles.text, null, 2));

// Verify counts
const checks = [
  ['Axes count', result.axes.length, 3],
  ['Variant count', result.variants.length, 30],
  ['Prop axes count', result.propAxes.length, 2], // Style, Size (State excluded)
  ['State axis exists', !!result.stateAxis, true],
  ['State values count', result.stateAxis?.values.length, 5],
  ['classifiedStates count', result.classifiedStates.length, 5],
  ['booleanProps includes disabled', result.booleanProps.includes('disabled'), true],
  ['booleanProps includes loading', result.booleanProps.includes('loading'), true],
  ['defaultVariantNode exists', !!result.defaultVariantNode, true],
  ['Default has State=Default', result.defaultVariant.props.State, 'Default'],
] as [string, any, any][];

console.log('\n=== Checks ===');
let allPassed = true;
for (const [name, actual, expected] of checks) {
  const pass = actual === expected;
  console.log(`${pass ? '✓' : '✗'} ${name}: ${actual} (expected ${expected})`);
  if (!pass) allPassed = false;
}

// Generate CSS
console.log('\n=== Generated CSS (first 80 lines) ===');
const css = buildVariantCSS(result);
const cssLines = css.split('\n');
console.log(cssLines.slice(0, 80).join('\n'));
console.log(`... (${cssLines.length} total lines)`);

console.log(`\n${allPassed ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}`);
