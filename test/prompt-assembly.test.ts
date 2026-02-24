import { describe, it, expect } from 'vitest';
import {
  loadSystemPrompt,
  loadFewShotExamples,
  getExampleCount,
  assembleSystemPrompt,
  assembleUserPrompt,
} from '../src/prompt/index.js';

describe('System Prompt', () => {
  it('loads system prompt from markdown file', () => {
    const prompt = loadSystemPrompt();
    expect(prompt).toContain('Figma-to-code converter');
    expect(prompt).toContain('Output Format Rules');
    expect(prompt).toContain('UNTRUSTED design data');
  });

  it('contains Mitosis-specific rules', () => {
    const prompt = loadSystemPrompt();
    expect(prompt).toContain('useStore');
    expect(prompt).toContain('<For');
    expect(prompt).toContain('<Show');
    expect(prompt).toContain('css={{');
  });

  it('returns same instance on repeated calls (caching)', () => {
    const first = loadSystemPrompt();
    const second = loadSystemPrompt();
    expect(first).toBe(second);
  });
});

describe('Few-Shot Examples', () => {
  it('loads all example files', () => {
    const count = getExampleCount();
    expect(count).toBe(4); // button, card, form, navbar
  });

  it('returns concatenated examples with separators', () => {
    const examples = loadFewShotExamples();
    expect(examples).toContain('Simple Button');
    expect(examples).toContain('Card Component');
    expect(examples).toContain('Contact Form');
    expect(examples).toContain('Navigation Bar');
    expect(examples).toContain('---'); // separator
  });

  it('each example contains Input and Output sections', () => {
    const examples = loadFewShotExamples();
    // 4 examples, each has Input and Output
    const inputMatches = examples.match(/\*\*Input:\*\*/g);
    const outputMatches = examples.match(/\*\*Output:\*\*/g);
    expect(inputMatches?.length).toBe(4);
    expect(outputMatches?.length).toBe(4);
  });

  it('examples contain YAML input blocks', () => {
    const examples = loadFewShotExamples();
    expect(examples).toContain('nodes:');
    expect(examples).toContain('globalVars:');
  });

  it('examples contain .lite.tsx output blocks', () => {
    const examples = loadFewShotExamples();
    expect(examples).toContain("from '@builder.io/mitosis'");
    expect(examples).toContain('export default function');
    expect(examples).toContain('css={{');
  });
});

describe('assembleSystemPrompt', () => {
  it('combines system prompt with examples', () => {
    const full = assembleSystemPrompt();
    // Contains base system prompt content
    expect(full).toContain('Output Format Rules');
    expect(full).toContain('Styling Mappings');
    // Contains the "Few-Shot Examples" header
    expect(full).toContain('## Few-Shot Examples');
    // Contains actual example content
    expect(full).toContain('PrimaryButton');
    expect(full).toContain('ContactForm');
  });

  it('system prompt comes before examples', () => {
    const full = assembleSystemPrompt();
    const rulesIndex = full.indexOf('Output Format Rules');
    const examplesIndex = full.indexOf('## Few-Shot Examples');
    expect(rulesIndex).toBeLessThan(examplesIndex);
  });
});

describe('assembleUserPrompt', () => {
  const sampleYaml = `nodes:
  - id: "1:1"
    name: "TestComponent"
    type: FRAME`;

  it('wraps YAML in code block with instructions', () => {
    const prompt = assembleUserPrompt(sampleYaml);
    expect(prompt).toContain('Convert the following Figma design');
    expect(prompt).toContain('```yaml');
    expect(prompt).toContain('TestComponent');
    expect(prompt).toContain('```');
  });

  it('includes component name hint when provided', () => {
    const prompt = assembleUserPrompt(sampleYaml, 'MyWidget');
    expect(prompt).toContain('Component name: MyWidget');
  });

  it('omits component name when not provided', () => {
    const prompt = assembleUserPrompt(sampleYaml);
    expect(prompt).not.toContain('Component name:');
  });

  it('trims whitespace from YAML content', () => {
    const prompt = assembleUserPrompt('  \n  nodes:\n    - id: "1:1"\n  \n');
    expect(prompt).toContain('```yaml\nnodes:');
  });
});
