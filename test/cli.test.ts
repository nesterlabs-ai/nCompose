import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_FRAMEWORKS,
  SUPPORTED_LLM_PROVIDERS,
  FRAMEWORK_EXTENSIONS,
} from '../src/types/index.js';

describe('CLI configuration', () => {
  it('supports all 5 frameworks', () => {
    expect(SUPPORTED_FRAMEWORKS).toEqual(['react', 'vue', 'svelte', 'angular', 'solid']);
  });

  it('supports all 3 LLM providers', () => {
    expect(SUPPORTED_LLM_PROVIDERS).toEqual(['deepseek', 'claude', 'openai']);
  });

  it('has correct file extensions for all frameworks', () => {
    expect(FRAMEWORK_EXTENSIONS.react).toBe('.jsx');
    expect(FRAMEWORK_EXTENSIONS.vue).toBe('.vue');
    expect(FRAMEWORK_EXTENSIONS.svelte).toBe('.svelte');
    expect(FRAMEWORK_EXTENSIONS.angular).toBe('.ts');
    expect(FRAMEWORK_EXTENSIONS.solid).toBe('.tsx');
  });
});

describe('convert module imports', () => {
  it('can import convertFigmaToCode', async () => {
    const mod = await import('../src/convert.js');
    expect(typeof mod.convertFigmaToCode).toBe('function');
  });

  it('can import writeOutputFiles', async () => {
    const mod = await import('../src/output.js');
    expect(typeof mod.writeOutputFiles).toBe('function');
  });
});
