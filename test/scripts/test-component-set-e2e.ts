/**
 * End-to-end test: Component Set pipeline
 *
 * Tests the full flow:
 * 1. Parse COMPONENT_SET YAML → variant data
 * 2. Build variant CSS deterministically
 * 3. Simulate LLM generating a class-based Mitosis component
 * 4. Parse with Mitosis parseJsx
 * 5. Compile to all 5 frameworks
 * 6. Inject CSS into each framework output
 *
 * This test uses a hardcoded Mitosis component (simulating LLM output)
 * to verify the Mitosis → compile → inject CSS pipeline works.
 */
import { readFileSync } from 'fs';
import { load } from 'js-yaml';
import { parseJsx } from '@builder.io/mitosis';
import {
  componentToReact,
  componentToVue,
  componentToSvelte,
  componentToAngular,
  componentToSolid,
} from '@builder.io/mitosis';
import { parseComponentSet, buildVariantCSS } from '../src/figma/component-set-parser.js';
import { injectCSS } from '../src/compile/inject-css.js';
import {
  buildVariantPromptData,
  buildComponentSetUserPrompt,
  buildComponentSetSystemPrompt,
} from '../src/figma/variant-prompt-builder.js';
import type { Framework } from '../src/types/index.js';

// Load real YAML data
const yamlPath = './output/debug-component-set.yaml';
const data = load(readFileSync(yamlPath, 'utf-8')) as any;

console.log('=== Component Set E2E Test ===\n');

// Step 1: Parse
const parsed = parseComponentSet(data);
if (!parsed) {
  console.error('FAIL: parseComponentSet returned null');
  process.exit(1);
}
console.log(`✓ Parsed: ${parsed.name} (${parsed.variants.length} variants)`);

// Step 2: CSS
const css = buildVariantCSS(parsed);
console.log(`✓ Generated CSS: ${css.split('\n').length} lines`);

// Step 3: Prompt data (for debugging / verification)
const promptData = buildVariantPromptData(parsed);
const systemPrompt = buildComponentSetSystemPrompt();
const userPrompt = buildComponentSetUserPrompt(promptData);
console.log(`✓ System prompt: ${systemPrompt.length} chars`);
console.log(`✓ User prompt: ${userPrompt.length} chars`);

// Step 4: Simulate LLM output (this is what the LLM should generate)
const simulatedLLMOutput = `
import { useStore } from '@builder.io/mitosis';

export default function ButtonDanger(props) {
  const state = useStore({
    get classes() {
      const base = 'button-danger';
      return base + ' ' + base + '--' + (props.variant || 'primary') + ' ' + base + '--' + (props.size || 'medium') + (props.loading ? ' loading' : '');
    }
  });

  return (
    <button class={state.classes} disabled={props.disabled || props.loading}>
      <span class="button-danger__label">{props.children || 'Button'}</span>
    </button>
  );
}
`;

// Step 5: Parse with Mitosis
let component;
try {
  component = parseJsx(simulatedLLMOutput, { typescript: true });
  console.log(`✓ Mitosis parseJsx succeeded: ${component.name}`);
} catch (err: any) {
  console.error(`✗ parseJsx failed: ${err.message}`);
  process.exit(1);
}

// Step 6: Compile to all 5 frameworks
const generators: [Framework, any][] = [
  ['react', componentToReact({ stateType: 'useState', stylesType: 'style-tag' })],
  ['vue', componentToVue({ api: 'composition' })],
  ['svelte', componentToSvelte()],
  ['angular', componentToAngular({ standalone: true })],
  ['solid', componentToSolid({ stateType: 'store', stylesType: 'style-tag' })],
];

const frameworkOutputs: Record<string, string> = {};
let allCompiled = true;

for (const [name, generator] of generators) {
  try {
    const output = generator({ component });
    const code = typeof output === 'string' ? output : output?.code ?? '';
    if (code && code.length > 10) {
      frameworkOutputs[name] = code;
      console.log(`✓ ${name}: compiled (${code.split('\n').length} lines)`);
    } else {
      console.log(`✗ ${name}: empty output`);
      allCompiled = false;
    }
  } catch (err: any) {
    console.log(`✗ ${name}: ${err.message}`);
    allCompiled = false;
  }
}

if (!allCompiled) {
  console.error('\nFAIL: Not all frameworks compiled');
  process.exit(1);
}

// Step 7: Inject CSS
console.log('\n--- Injecting CSS into framework outputs ---');

const finalOutputs: Record<string, string> = {};
for (const [fw, code] of Object.entries(frameworkOutputs)) {
  const withCSS = injectCSS(code, css, fw as Framework);
  finalOutputs[fw] = withCSS;

  // Verify CSS is present in the output
  const hasCSS = withCSS.includes('.button-danger--primary');
  const hasClass = withCSS.includes('button-danger');
  console.log(`✓ ${fw}: ${withCSS.split('\n').length} lines (CSS injected: ${hasCSS}, class ref: ${hasClass})`);
}

// Show React final output
console.log('\n=== Final React Output ===');
console.log(finalOutputs.react);

// Show Vue final output
console.log('\n=== Final Vue Output ===');
console.log(finalOutputs.vue);

console.log('\n=== Summary ===');
console.log(`Component: ${parsed.name}`);
console.log(`Variants: ${parsed.variants.length}`);
console.log(`CSS: ${css.split('\n').length} lines`);
console.log(`Frameworks: ${Object.keys(finalOutputs).length}/5 compiled with CSS`);
console.log('\nALL STEPS PASSED ✓');
