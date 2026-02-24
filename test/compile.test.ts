import { describe, it, expect } from 'vitest';
import { parseMitosisCode } from '../src/compile/parse-and-validate.js';
import { generateFrameworkCode } from '../src/compile/generate.js';

// A minimal valid Mitosis component for testing
const VALID_MITOSIS_CODE = `
import { useStore } from '@builder.io/mitosis';

export default function TestButton(props) {
  return (
    <button
      css={{
        padding: '12px 24px',
        backgroundColor: '#3B82F6',
        borderRadius: '8px',
        border: 'none',
        color: '#FFFFFF',
        cursor: 'pointer',
      }}
    >
      Click Me
    </button>
  );
}
`;

// Code wrapped in markdown fences (common LLM output)
const FENCED_CODE = '```tsx\n' + VALID_MITOSIS_CODE.trim() + '\n```';

// Code with missing imports
const MISSING_IMPORT_CODE = `export default function TestButton(props) {
  const state = useStore({ clicked: false });
  return (
    <button
      css={{ padding: '12px 24px', backgroundColor: '#3B82F6' }}
    >
      Click Me
    </button>
  );
}`;

// Invalid code that should fail to parse
const INVALID_CODE = `
this is not valid jsx at all {{{ broken
`;

describe('parseMitosisCode', () => {
  it('successfully parses valid Mitosis code', () => {
    const result = parseMitosisCode(VALID_MITOSIS_CODE);
    expect(result.success).toBe(true);
    expect(result.component).toBeDefined();
    expect(result.component?.name).toBe('TestButton');
    expect(result.error).toBeUndefined();
  });

  it('handles markdown-fenced code', () => {
    const result = parseMitosisCode(FENCED_CODE);
    expect(result.success).toBe(true);
    expect(result.component?.name).toBe('TestButton');
  });

  it('fixes missing imports before parsing', () => {
    const result = parseMitosisCode(MISSING_IMPORT_CODE);
    expect(result.success).toBe(true);
    expect(result.rawCode).toContain("from '@builder.io/mitosis'");
  });

  it('returns failure with error for invalid code', () => {
    const result = parseMitosisCode(INVALID_CODE);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.length).toBeGreaterThan(0);
  });

  it('stores cleaned code in rawCode', () => {
    const result = parseMitosisCode(FENCED_CODE);
    expect(result.rawCode).not.toContain('```');
  });
});

describe('generateFrameworkCode', () => {
  it('generates React code from a parsed component', () => {
    const parsed = parseMitosisCode(VALID_MITOSIS_CODE);
    expect(parsed.success).toBe(true);

    const output = generateFrameworkCode(parsed.component!, ['react']);
    expect(output.react).toBeDefined();
    expect(output.react).toContain('function');
    expect(output.react.length).toBeGreaterThan(50);
  });

  it('generates Vue code from a parsed component', () => {
    const parsed = parseMitosisCode(VALID_MITOSIS_CODE);
    const output = generateFrameworkCode(parsed.component!, ['vue']);
    expect(output.vue).toBeDefined();
    expect(output.vue).toContain('template');
  });

  it('generates Svelte code from a parsed component', () => {
    const parsed = parseMitosisCode(VALID_MITOSIS_CODE);
    const output = generateFrameworkCode(parsed.component!, ['svelte']);
    expect(output.svelte).toBeDefined();
  });

  it('generates Angular code from a parsed component', () => {
    const parsed = parseMitosisCode(VALID_MITOSIS_CODE);
    const output = generateFrameworkCode(parsed.component!, ['angular']);
    expect(output.angular).toBeDefined();
    expect(output.angular).toContain('Component');
  });

  it('generates Solid code from a parsed component', () => {
    const parsed = parseMitosisCode(VALID_MITOSIS_CODE);
    const output = generateFrameworkCode(parsed.component!, ['solid']);
    expect(output.solid).toBeDefined();
    expect(output.solid).toContain('function');
  });

  it('generates multiple frameworks at once', () => {
    const parsed = parseMitosisCode(VALID_MITOSIS_CODE);
    const output = generateFrameworkCode(parsed.component!, [
      'react',
      'vue',
      'svelte',
      'angular',
      'solid',
    ]);
    expect(Object.keys(output)).toHaveLength(5);
    for (const [fw, code] of Object.entries(output)) {
      expect(code.length).toBeGreaterThan(0);
    }
  });

  it('handles generation errors gracefully', () => {
    // Pass an empty/malformed component — should not throw, should return error comment
    const emptyComponent = { name: 'Bad' } as any;
    const output = generateFrameworkCode(emptyComponent, ['react']);
    expect(output.react).toContain('Error generating react code');
  });
});
