import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeOutputFiles } from '../src/output.js';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const TEST_OUTPUT_DIR = join(import.meta.dirname, '__test_output__');

describe('writeOutputFiles', () => {
  beforeEach(() => {
    // Clean up before each test
    if (existsSync(TEST_OUTPUT_DIR)) {
      rmSync(TEST_OUTPUT_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up after each test
    if (existsSync(TEST_OUTPUT_DIR)) {
      rmSync(TEST_OUTPUT_DIR, { recursive: true });
    }
  });

  it('creates output directory if it does not exist', () => {
    writeOutputFiles({
      outputDir: TEST_OUTPUT_DIR,
      componentName: 'TestBtn',
      mitosisSource: 'export default function TestBtn() {}',
      frameworkOutputs: { react: '<div>react</div>' },
    });

    expect(existsSync(TEST_OUTPUT_DIR)).toBe(true);
  });

  it('writes Mitosis source file', () => {
    writeOutputFiles({
      outputDir: TEST_OUTPUT_DIR,
      componentName: 'MyCard',
      mitosisSource: 'export default function MyCard() { return <div />; }',
      frameworkOutputs: {},
    });

    const mitosisPath = join(TEST_OUTPUT_DIR, 'MyCard.lite.tsx');
    expect(existsSync(mitosisPath)).toBe(true);
    expect(readFileSync(mitosisPath, 'utf-8')).toContain('MyCard');
  });

  it('writes framework output files with correct extensions', () => {
    const paths = writeOutputFiles({
      outputDir: TEST_OUTPUT_DIR,
      componentName: 'Widget',
      mitosisSource: 'mitosis source',
      frameworkOutputs: {
        react: 'react code',
        vue: 'vue code',
        svelte: 'svelte code',
        angular: 'angular code',
        solid: 'solid code',
      },
    });

    expect(existsSync(join(TEST_OUTPUT_DIR, 'Widget.lite.tsx'))).toBe(true);
    expect(existsSync(join(TEST_OUTPUT_DIR, 'Widget.jsx'))).toBe(true);
    expect(existsSync(join(TEST_OUTPUT_DIR, 'Widget.vue'))).toBe(true);
    expect(existsSync(join(TEST_OUTPUT_DIR, 'Widget.svelte'))).toBe(true);
    expect(existsSync(join(TEST_OUTPUT_DIR, 'Widget.ts'))).toBe(true);
    expect(existsSync(join(TEST_OUTPUT_DIR, 'Widget.tsx'))).toBe(true);

    // 1 mitosis + 5 frameworks = 6 files
    expect(paths).toHaveLength(6);
  });

  it('skips framework outputs that are error messages', () => {
    const paths = writeOutputFiles({
      outputDir: TEST_OUTPUT_DIR,
      componentName: 'Broken',
      mitosisSource: 'source',
      frameworkOutputs: {
        react: 'valid react code',
        vue: '// Error generating vue code: something broke',
      },
    });

    expect(existsSync(join(TEST_OUTPUT_DIR, 'Broken.jsx'))).toBe(true);
    expect(existsSync(join(TEST_OUTPUT_DIR, 'Broken.vue'))).toBe(false);
    // 1 mitosis + 1 react = 2 files (vue skipped)
    expect(paths).toHaveLength(2);
  });

  it('returns list of written file paths', () => {
    const paths = writeOutputFiles({
      outputDir: TEST_OUTPUT_DIR,
      componentName: 'Nav',
      mitosisSource: 'source',
      frameworkOutputs: { react: 'react', svelte: 'svelte' },
    });

    expect(paths).toContain(join(TEST_OUTPUT_DIR, 'Nav.lite.tsx'));
    expect(paths).toContain(join(TEST_OUTPUT_DIR, 'Nav.jsx'));
    expect(paths).toContain(join(TEST_OUTPUT_DIR, 'Nav.svelte'));
  });
});
