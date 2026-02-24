/**
 * Smoke test: Calls an LLM with our assembled prompt + sample YAML
 * to verify the prompt produces reasonable .lite.tsx output.
 *
 * Usage:
 *   npx tsx test/smoke-llm.ts [deepseek|claude|openai]
 *
 * Requires a valid API key in .env or environment variables.
 */
import 'dotenv/config';
import { assembleSystemPrompt, assembleUserPrompt } from '../src/prompt/index.js';
import { createLLMProvider } from '../src/llm/index.js';
import type { LLMProviderName } from '../src/types/index.js';

const providerName = (process.argv[2] || 'claude') as LLMProviderName;

// Sample YAML — a simple card that's NOT one of our few-shot examples
const sampleYaml = `nodes:
  - id: "5:1"
    name: "AlertBanner"
    type: FRAME
    layout: layout_040
    fills: fill_040
    borderRadius: "8px"
    children:
      - id: "5:2"
        name: "Icon"
        type: FRAME
        layout: layout_041
        fills: fill_041
        borderRadius: "50%"
        children:
          - id: "5:3"
            name: "ExclamationMark"
            type: TEXT
            text: "!"
            textStyle: text_040
            fills: fill_042
            layout: layout_042
      - id: "5:4"
        name: "Content"
        type: FRAME
        layout: layout_043
        children:
          - id: "5:5"
            name: "AlertTitle"
            type: TEXT
            text: "Warning"
            textStyle: text_041
            fills: fill_043
            layout: layout_042
          - id: "5:6"
            name: "AlertMessage"
            type: TEXT
            text: "Your trial expires in 3 days. Upgrade now to keep your data."
            textStyle: text_042
            fills: fill_044
            layout: layout_044
      - id: "5:7"
        name: "DismissButton"
        type: FRAME
        layout: layout_041
        children:
          - id: "5:8"
            name: "CloseIcon"
            type: TEXT
            text: "×"
            textStyle: text_043
            fills: fill_044
            layout: layout_042
globalVars:
  styles:
    layout_040:
      mode: row
      alignItems: center
      gap: "12px"
      padding: "16px"
      sizing:
        horizontal: fill
        vertical: hug
    layout_041:
      mode: row
      justifyContent: center
      alignItems: center
      sizing:
        horizontal: hug
        vertical: hug
    layout_042:
      sizing:
        horizontal: hug
        vertical: hug
    layout_043:
      mode: column
      gap: "4px"
      sizing:
        horizontal: fill
        vertical: hug
    layout_044:
      sizing:
        horizontal: fill
        vertical: hug
    fill_040:
      - "#FEF3C7"
    fill_041:
      - "#F59E0B"
    fill_042:
      - "#FFFFFF"
    fill_043:
      - "#92400E"
    fill_044:
      - "#78350F"
    text_040:
      fontFamily: Inter
      fontWeight: 700
      fontSize: 14
      lineHeight: 1em
    text_041:
      fontFamily: Inter
      fontWeight: 600
      fontSize: 14
      lineHeight: 1.5em
    text_042:
      fontFamily: Inter
      fontWeight: 400
      fontSize: 14
      lineHeight: 1.5em
    text_043:
      fontFamily: Inter
      fontWeight: 400
      fontSize: 18
      lineHeight: 1em`;

async function main() {
  console.log(`\n🔧 Assembling prompts...`);
  const systemPrompt = assembleSystemPrompt();
  const userPrompt = assembleUserPrompt(sampleYaml, 'AlertBanner');

  console.log(`📏 System prompt: ${systemPrompt.length} chars`);
  console.log(`📏 User prompt: ${userPrompt.length} chars`);
  console.log(`\n🤖 Calling ${providerName}...\n`);

  const provider = createLLMProvider(providerName);
  const startTime = Date.now();
  const result = await provider.generate(userPrompt, systemPrompt);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`✅ Response received in ${elapsed}s (${result.length} chars)\n`);
  console.log('--- LLM Output ---');
  console.log(result);
  console.log('--- End Output ---\n');

  // Basic sanity checks
  const checks = [
    { label: 'Has export default function', pass: /export default function/.test(result) },
    { label: 'Uses css={{ }}', pass: /css=\{\{/.test(result) },
    { label: 'Has JSX return', pass: /return\s*\(/.test(result) },
    { label: 'No className usage', pass: !/className=/.test(result) },
    { label: 'No .map() usage', pass: !/\.map\(/.test(result) },
    { label: 'Contains AlertBanner or alert-related', pass: /Alert|Banner|alert/i.test(result) },
  ];

  console.log('Sanity Checks:');
  for (const check of checks) {
    console.log(`  ${check.pass ? '✅' : '❌'} ${check.label}`);
  }

  const passCount = checks.filter((c) => c.pass).length;
  console.log(`\n${passCount}/${checks.length} checks passed\n`);
}

main().catch((err) => {
  console.error('❌ Smoke test failed:', err.message);
  process.exit(1);
});
