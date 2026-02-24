import { describe, it, expect, vi } from 'vitest';
import { generateWithRetry } from '../src/compile/retry.js';
import type { LLMProvider } from '../src/llm/provider.js';

const VALID_CODE = `import { useStore } from '@builder.io/mitosis';

export default function TestComp(props) {
  return <div css={{ padding: '16px' }}>Hello</div>;
}`;

const INVALID_CODE = 'this is not valid code at all {{{';

/**
 * Creates a mock LLM provider that returns predefined responses.
 */
function createMockProvider(responses: string[]): LLMProvider {
  let callIndex = 0;
  return {
    name: 'mock',
    generate: vi.fn(async () => {
      const response = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return response;
    }),
  };
}

describe('generateWithRetry', () => {
  it('returns success on first attempt with valid code', async () => {
    const provider = createMockProvider([VALID_CODE]);
    const result = await generateWithRetry(provider, 'system', 'user');

    expect(result.success).toBe(true);
    expect(result.component?.name).toBe('TestComp');
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it('retries on parse failure and succeeds on second attempt', async () => {
    const provider = createMockProvider([INVALID_CODE, VALID_CODE]);
    const result = await generateWithRetry(provider, 'system', 'user');

    expect(result.success).toBe(true);
    expect(provider.generate).toHaveBeenCalledTimes(2);
  });

  it('includes error message in retry prompt', async () => {
    const provider = createMockProvider([INVALID_CODE, VALID_CODE]);
    await generateWithRetry(provider, 'system', 'user');

    // Second call should include error feedback
    const secondCallArgs = (provider.generate as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(secondCallArgs[0]).toContain('⚠️ Your previous output failed to compile');
  });

  it('makes a final simplified attempt after MAX_RETRIES failures', async () => {
    // All 3 retries fail, then final attempt also fails
    const provider = createMockProvider([
      INVALID_CODE,
      INVALID_CODE,
      INVALID_CODE,
      INVALID_CODE, // final fallback
    ]);
    const result = await generateWithRetry(provider, 'system', 'user');

    expect(result.success).toBe(false);
    // 3 retries + 1 final = 4 calls
    expect(provider.generate).toHaveBeenCalledTimes(4);
  });

  it('final simplified attempt can succeed', async () => {
    const provider = createMockProvider([
      INVALID_CODE,
      INVALID_CODE,
      INVALID_CODE,
      VALID_CODE, // final fallback succeeds
    ]);
    const result = await generateWithRetry(provider, 'system', 'user');

    expect(result.success).toBe(true);
    expect(provider.generate).toHaveBeenCalledTimes(4);
  });

  it('calls onAttempt callback for progress tracking', async () => {
    const provider = createMockProvider([INVALID_CODE, VALID_CODE]);
    const onAttempt = vi.fn();

    await generateWithRetry(provider, 'system', 'user', onAttempt);

    expect(onAttempt).toHaveBeenCalled();
    // First call: attempt 1 start
    expect(onAttempt.mock.calls[0]).toEqual([1, 3]);
  });

  it('handles markdown-fenced LLM output', async () => {
    const fencedCode = '```tsx\n' + VALID_CODE + '\n```';
    const provider = createMockProvider([fencedCode]);
    const result = await generateWithRetry(provider, 'system', 'user');

    expect(result.success).toBe(true);
    expect(result.component?.name).toBe('TestComp');
  });
});
