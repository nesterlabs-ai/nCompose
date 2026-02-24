/**
 * Smoke test: Full pipeline through Phase 3.
 *
 * Figma YAML → Prompt Assembly → LLM Call → Cleanup → Parse (Mitosis) → Generate (5 frameworks)
 *
 * Usage:
 *   npx tsx test/smoke-full-pipeline.ts [deepseek|claude|openai]
 *
 * Requires a valid API key in .env or environment variables.
 */
import 'dotenv/config';
import { assembleSystemPrompt, assembleUserPrompt } from '../src/prompt/index.js';
import { createLLMProvider } from '../src/llm/index.js';
import { parseMitosisCode } from '../src/compile/parse-and-validate.js';
import { generateFrameworkCode } from '../src/compile/generate.js';
import { SUPPORTED_FRAMEWORKS } from '../src/types/index.js';
import type { LLMProviderName } from '../src/types/index.js';

const providerName = (process.argv[2] || 'claude') as LLMProviderName;

// A pricing card component — NOT in our few-shot examples
const sampleYaml = `nodes:
  - id: "6:1"
    name: "PricingCard"
    type: FRAME
    layout: layout_050
    fills: fill_050
    borderRadius: "16px"
    effects: effect_050
    strokes: stroke_050
    strokeWeight: "1px"
    children:
      - id: "6:2"
        name: "PlanName"
        type: TEXT
        text: "Pro Plan"
        textStyle: text_050
        fills: fill_051
        layout: layout_051
      - id: "6:3"
        name: "Price"
        type: FRAME
        layout: layout_052
        children:
          - id: "6:4"
            name: "Amount"
            type: TEXT
            text: "$29"
            textStyle: text_051
            fills: fill_052
            layout: layout_051
          - id: "6:5"
            name: "Period"
            type: TEXT
            text: "/month"
            textStyle: text_052
            fills: fill_053
            layout: layout_051
      - id: "6:6"
        name: "Divider"
        type: RECTANGLE
        layout: layout_053
        fills: fill_054
      - id: "6:7"
        name: "Features"
        type: FRAME
        layout: layout_054
        children:
          - id: "6:8"
            name: "Feature"
            type: TEXT
            text: "Unlimited projects"
            textStyle: text_053
            fills: fill_053
            layout: layout_055
          - id: "6:9"
            name: "Feature"
            type: TEXT
            text: "Priority support"
            textStyle: text_053
            fills: fill_053
            layout: layout_055
          - id: "6:10"
            name: "Feature"
            type: TEXT
            text: "Advanced analytics"
            textStyle: text_053
            fills: fill_053
            layout: layout_055
      - id: "6:11"
        name: "CTAButton"
        type: FRAME
        layout: layout_056
        fills: fill_055
        borderRadius: "8px"
        children:
          - id: "6:12"
            name: "Label"
            type: TEXT
            text: "Get Started"
            textStyle: text_054
            fills: fill_056
            layout: layout_051
globalVars:
  styles:
    layout_050:
      mode: column
      alignItems: center
      gap: "24px"
      padding: "32px"
      sizing:
        horizontal: fixed
        vertical: hug
      dimensions:
        width: 300
    layout_051:
      sizing:
        horizontal: hug
        vertical: hug
    layout_052:
      mode: row
      alignItems: baseline
      gap: "2px"
      sizing:
        horizontal: hug
        vertical: hug
    layout_053:
      sizing:
        horizontal: fill
        vertical: fixed
      dimensions:
        height: 1
    layout_054:
      mode: column
      alignItems: flex-start
      gap: "12px"
      sizing:
        horizontal: fill
        vertical: hug
    layout_055:
      sizing:
        horizontal: fill
        vertical: hug
    layout_056:
      mode: row
      justifyContent: center
      alignItems: center
      padding: "12px 24px"
      sizing:
        horizontal: fill
        vertical: hug
    fill_050:
      - "#FFFFFF"
    fill_051:
      - "#6366F1"
    fill_052:
      - "#111827"
    fill_053:
      - "#4B5563"
    fill_054:
      - "#E5E7EB"
    fill_055:
      - "#6366F1"
    fill_056:
      - "#FFFFFF"
    text_050:
      fontFamily: Inter
      fontWeight: 600
      fontSize: 14
      lineHeight: 1.5em
      textAlignHorizontal: CENTER
    text_051:
      fontFamily: Inter
      fontWeight: 700
      fontSize: 48
      lineHeight: 1.2em
    text_052:
      fontFamily: Inter
      fontWeight: 400
      fontSize: 16
      lineHeight: 1.5em
    text_053:
      fontFamily: Inter
      fontWeight: 400
      fontSize: 14
      lineHeight: 1.5em
    text_054:
      fontFamily: Inter
      fontWeight: 600
      fontSize: 16
      lineHeight: 1.5em
      textAlignHorizontal: CENTER
    stroke_050:
      colors:
        - "#E5E7EB"
    effect_050:
      boxShadow: "0px 4px 6px -1px rgba(0, 0, 0, 0.1)"`;

async function main() {
  console.log('========================================');
  console.log('  Full Pipeline Smoke Test (Phase 1-3)');
  console.log('========================================\n');

  // --- Step 1: Prompt Assembly ---
  console.log('Step 1: Assembling prompts...');
  const systemPrompt = assembleSystemPrompt();
  const userPrompt = assembleUserPrompt(sampleYaml, 'PricingCard');
  console.log(`  System prompt: ${systemPrompt.length} chars`);
  console.log(`  User prompt:   ${userPrompt.length} chars`);

  // --- Step 2: LLM Call ---
  console.log(`\nStep 2: Calling ${providerName}...`);
  const provider = createLLMProvider(providerName);
  const startLLM = Date.now();
  const rawOutput = await provider.generate(userPrompt, systemPrompt);
  const llmTime = ((Date.now() - startLLM) / 1000).toFixed(1);
  console.log(`  Response: ${rawOutput.length} chars in ${llmTime}s`);

  // --- Step 3: Parse through Mitosis ---
  console.log('\nStep 3: Parsing through Mitosis parseJsx()...');
  const parseResult = parseMitosisCode(rawOutput);

  if (!parseResult.success) {
    console.log(`  ❌ PARSE FAILED: ${parseResult.error}`);
    console.log('\n--- Raw LLM Output ---');
    console.log(rawOutput);
    console.log('--- End ---\n');
    process.exit(1);
  }

  console.log(`  ✅ Parse succeeded!`);
  console.log(`  Component name: ${parseResult.component!.name}`);

  // --- Step 4: Generate all 5 frameworks ---
  console.log('\nStep 4: Generating framework code...');
  const startGen = Date.now();
  const frameworkOutputs = generateFrameworkCode(parseResult.component!, [...SUPPORTED_FRAMEWORKS]);
  const genTime = ((Date.now() - startGen) / 1000).toFixed(1);
  console.log(`  Generated in ${genTime}s\n`);

  // --- Results ---
  console.log('========================================');
  console.log('  Results');
  console.log('========================================\n');

  console.log('--- Mitosis Source (.lite.tsx) ---');
  console.log(parseResult.rawCode);
  console.log('--- End Mitosis Source ---\n');

  for (const fw of SUPPORTED_FRAMEWORKS) {
    const code = frameworkOutputs[fw];
    const isError = code.startsWith('// Error');
    const status = isError ? '❌' : '✅';
    console.log(`--- ${fw.toUpperCase()} ${status} (${code.length} chars) ---`);
    console.log(code);
    console.log(`--- End ${fw.toUpperCase()} ---\n`);
  }

  // --- Summary ---
  console.log('========================================');
  console.log('  Summary');
  console.log('========================================');
  console.log(`  LLM Provider:    ${providerName}`);
  console.log(`  LLM Time:        ${llmTime}s`);
  console.log(`  Mitosis Parse:   ✅ Success`);
  console.log(`  Component Name:  ${parseResult.component!.name}`);

  let passCount = 0;
  for (const fw of SUPPORTED_FRAMEWORKS) {
    const isError = frameworkOutputs[fw].startsWith('// Error');
    console.log(`  ${fw.padEnd(15)} ${isError ? '❌ Failed' : '✅ ' + frameworkOutputs[fw].length + ' chars'}`);
    if (!isError) passCount++;
  }

  console.log(`\n  Frameworks:      ${passCount}/${SUPPORTED_FRAMEWORKS.length} generated`);
  console.log('========================================\n');
}

main().catch((err) => {
  console.error('❌ Smoke test failed:', err.message);
  process.exit(1);
});
