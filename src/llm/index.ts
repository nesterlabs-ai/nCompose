export type { LLMProvider, LLMMessage } from './provider.js';
export { DeepSeekProvider } from './deepseek.js';
export { ClaudeProvider } from './claude.js';
export { OpenAIProvider } from './openai.js';

import type { LLMProvider } from './provider.js';
import type { LLMProviderName } from '../types/index.js';
import { config } from '../config.js';
import { DeepSeekProvider } from './deepseek.js';
import { ClaudeProvider } from './claude.js';
import { OpenAIProvider } from './openai.js';
import { withLogging } from './logged-provider.js';

/**
 * Factory: create an LLM provider by name, reading the API key from env.
 * All providers are automatically wrapped with request/response logging.
 */
export function createLLMProvider(name: LLMProviderName): LLMProvider {
  let provider: LLMProvider;
  switch (name) {
    case 'deepseek':
      provider = new DeepSeekProvider(process.env.DEEPSEEK_API_KEY ?? '', config.llm.deepseek);
      break;
    case 'claude':
      provider = new ClaudeProvider(process.env.ANTHROPIC_API_KEY ?? '', config.llm.claude);
      break;
    case 'openai':
      provider = new OpenAIProvider(process.env.OPENAI_API_KEY ?? '', config.llm.openai);
      break;
    default: {
      const exhaustive: never = name;
      throw new Error(`Unknown LLM provider: ${exhaustive}`);
    }
  }
  return withLogging(provider);
}
