/**
 * Integration test runner for real Figma designs.
 *
 * Tests the full pipeline (Figma URL → LLM → Mitosis → frameworks)
 * against a list of known component URLs and reports results.
 *
 * Usage:
 *   npx tsx test/integration-runner.ts
 *   npx tsx test/integration-runner.ts --llm claude
 *   npx tsx test/integration-runner.ts --frameworks react,vue
 *
 * Requires FIGMA_TOKEN and at least one LLM API key in .env
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseFigmaUrl } from '../src/utils/figma-url-parser.js';
import { FigmaClient } from '../src/figma/fetch.js';
import { simplifyFigmaData } from '../src/figma/simplify.js';
import { createLLMProvider } from '../src/llm/index.js';
import { assembleSystemPrompt, assembleUserPrompt } from '../src/prompt/index.js';
import { generateWithRetry } from '../src/compile/retry.js';
import { generateFrameworkCode } from '../src/compile/generate.js';
import { SUPPORTED_FRAMEWORKS } from '../src/types/index.js';
import type { Framework, LLMProviderName } from '../src/types/index.js';
import { dump } from 'js-yaml';

// ---------- Test Cases ----------
// Add real Figma URLs here as you discover test cases.
// Each entry has a name, URL, and expected component characteristics.

interface TestCase {
  name: string;
  url: string;
  expectedName?: string;
  complexity: 'low' | 'medium' | 'high';
  notes?: string;
}

const TEST_CASES: TestCase[] = [
  {
    name: 'ButtonDanger',
    url: 'https://www.figma.com/design/rAim3nrWukuYQQRmYU1L8r/SquareX-Design-System--Copy-?node-id=8119-29710&m=dev',
    complexity: 'medium',
    notes: 'Design system button with variants — should render default state only',
  },
  // Add more test cases as you test different designs:
  // {
  //   name: 'NavBar',
  //   url: 'https://www.figma.com/design/...',
  //   complexity: 'medium',
  // },
];

// ---------- Runner ----------

interface TestResult {
  name: string;
  complexity: string;
  fetchOk: boolean;
  simplifyOk: boolean;
  llmOk: boolean;
  parseOk: boolean;
  componentName: string | null;
  frameworks: Record<string, { ok: boolean; chars: number }>;
  llmTime: number;
  totalTime: number;
  error?: string;
  notes?: string;
}

async function runTestCase(
  testCase: TestCase,
  llmName: LLMProviderName,
  frameworks: Framework[],
  outputDir: string,
): Promise<TestResult> {
  const start = Date.now();
  const result: TestResult = {
    name: testCase.name,
    complexity: testCase.complexity,
    fetchOk: false,
    simplifyOk: false,
    llmOk: false,
    parseOk: false,
    componentName: null,
    frameworks: {},
    llmTime: 0,
    totalTime: 0,
    notes: testCase.notes,
  };

  try {
    // Step 1: Parse + Fetch
    const { fileKey, nodeId } = parseFigmaUrl(testCase.url);
    const client = new FigmaClient(process.env.FIGMA_TOKEN!);
    const rawData = nodeId
      ? await client.getNode(fileKey, nodeId, 25)
      : await client.getFile(fileKey, 25);
    result.fetchOk = true;

    // Step 2: Simplify
    const simplified = simplifyFigmaData(rawData);
    const yamlContent = dump(simplified, { lineWidth: 120, noRefs: true });
    result.simplifyOk = true;

    // Save YAML for debugging
    const caseDir = join(outputDir, testCase.name);
    mkdirSync(caseDir, { recursive: true });
    writeFileSync(join(caseDir, 'input.yaml'), yamlContent);

    // Step 3: LLM
    const systemPrompt = assembleSystemPrompt();
    const userPrompt = assembleUserPrompt(yamlContent, testCase.name);
    const llm = createLLMProvider(llmName);

    const llmStart = Date.now();
    const parseResult = await generateWithRetry(llm, systemPrompt, userPrompt);
    result.llmTime = Date.now() - llmStart;
    result.llmOk = true;

    // Save raw LLM output
    writeFileSync(join(caseDir, 'raw-llm-output.tsx'), parseResult.rawCode);

    if (!parseResult.success || !parseResult.component) {
      result.parseOk = false;
      result.error = parseResult.error;
      writeFileSync(join(caseDir, 'error.txt'), parseResult.error ?? 'Unknown error');
      return result;
    }

    result.parseOk = true;
    result.componentName = parseResult.component.name;

    // Save Mitosis source
    writeFileSync(join(caseDir, `${parseResult.component.name}.lite.tsx`), parseResult.rawCode);

    // Step 4: Generate frameworks
    const fwOutputs = generateFrameworkCode(parseResult.component, frameworks);
    for (const fw of frameworks) {
      const code = fwOutputs[fw];
      const isError = code.startsWith('// Error');
      result.frameworks[fw] = { ok: !isError, chars: code.length };

      // Save framework output
      const ext: Record<string, string> = {
        react: '.jsx', vue: '.vue', svelte: '.svelte',
        angular: '.ts', solid: '.tsx',
      };
      writeFileSync(join(caseDir, `${parseResult.component.name}${ext[fw] ?? '.tsx'}`), code);
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  result.totalTime = Date.now() - start;
  return result;
}

async function main() {
  // Parse CLI args
  const args = process.argv.slice(2);
  const llmFlag = args.find((a) => a.startsWith('--llm='))?.split('=')[1]
    ?? args[args.indexOf('--llm') + 1]
    ?? 'claude';
  const fwFlag = args.find((a) => a.startsWith('--frameworks='))?.split('=')[1]
    ?? args[args.indexOf('--frameworks') + 1]
    ?? 'react';

  const llm = llmFlag as LLMProviderName;
  const frameworks = fwFlag.split(',').map((f) => f.trim()) as Framework[];
  const outputDir = join(import.meta.dirname, '__integration_output__');

  console.log('============================================');
  console.log('  Integration Test Runner');
  console.log('============================================');
  console.log(`  LLM:        ${llm}`);
  console.log(`  Frameworks: ${frameworks.join(', ')}`);
  console.log(`  Test cases: ${TEST_CASES.length}`);
  console.log(`  Output:     ${outputDir}`);
  console.log('============================================\n');

  const results: TestResult[] = [];

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i];
    console.log(`[${i + 1}/${TEST_CASES.length}] Testing: ${tc.name} (${tc.complexity})...`);

    const result = await runTestCase(tc, llm, frameworks, outputDir);
    results.push(result);

    // Print result
    const status = result.parseOk ? '✅' : '❌';
    const fwStatus = Object.entries(result.frameworks)
      .map(([fw, r]) => `${fw}: ${r.ok ? '✅' : '❌'}`)
      .join(', ');

    console.log(`  ${status} Parse: ${result.parseOk ? 'OK' : 'FAILED'} | ${fwStatus}`);
    console.log(`  Component: ${result.componentName ?? 'N/A'} | LLM: ${(result.llmTime / 1000).toFixed(1)}s | Total: ${(result.totalTime / 1000).toFixed(1)}s`);
    if (result.error) console.log(`  Error: ${result.error}`);
    console.log();
  }

  // Summary
  console.log('============================================');
  console.log('  Summary');
  console.log('============================================');

  const passed = results.filter((r) => r.parseOk).length;
  const fwPassCounts: Record<string, number> = {};
  for (const r of results) {
    for (const [fw, fwr] of Object.entries(r.frameworks)) {
      fwPassCounts[fw] = (fwPassCounts[fw] ?? 0) + (fwr.ok ? 1 : 0);
    }
  }

  console.log(`  Parse:  ${passed}/${results.length} passed`);
  for (const [fw, count] of Object.entries(fwPassCounts)) {
    console.log(`  ${fw.padEnd(10)} ${count}/${results.length} passed`);
  }
  console.log(`  Avg LLM time: ${(results.reduce((s, r) => s + r.llmTime, 0) / results.length / 1000).toFixed(1)}s`);
  console.log('============================================\n');

  // Save full report
  writeFileSync(
    join(outputDir, 'report.json'),
    JSON.stringify(results, null, 2),
  );
  console.log(`Full report: ${join(outputDir, 'report.json')}\n`);
}

main().catch((err) => {
  console.error('Runner failed:', err.message);
  process.exit(1);
});
