export type { LLMProvider } from './provider.js';
export { DeepSeekProvider } from './deepseek.js';
export { ClaudeProvider } from './claude.js';
export { OpenAIProvider } from './openai.js';

import type { LLMProvider } from './provider.js';
import type { LLMProviderName } from '../types/index.js';
import { DeepSeekProvider } from './deepseek.js';
import { ClaudeProvider } from './claude.js';
import { OpenAIProvider } from './openai.js';

/**
 * Factory: create an LLM provider by name, reading the API key from env.
 */
export function createLLMProvider(name: LLMProviderName): LLMProvider {
  switch (name) {
    case 'deepseek':
      return new DeepSeekProvider(process.env.DEEPSEEK_API_KEY ?? '');
    case 'claude':
      return new ClaudeProvider(process.env.ANTHROPIC_API_KEY ?? '');
    case 'openai':
      return new OpenAIProvider(process.env.OPENAI_API_KEY ?? '');
    default: {
      const exhaustive: never = name;
      throw new Error(`Unknown LLM provider: ${exhaustive}`);
    }
  }
}
