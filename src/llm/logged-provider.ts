/**
 * Logging wrapper for any LLMProvider.
 *
 * Logs every generate/generateMultiTurn call:
 *   - Provider name, model (inferred from provider.name)
 *   - Message count, system prompt length, user prompt length
 *   - Response length, duration
 *   - Errors
 *
 * Usage:
 *   const provider = withLogging(createLLMProvider('claude'));
 */

import type { LLMProvider, LLMMessage } from './provider.js';
import { log } from '../web/logger.js';

function summarizeMessages(messages: LLMMessage[]): string {
  const system = messages.filter(m => m.role === 'system');
  const user = messages.filter(m => m.role === 'user');
  const assistant = messages.filter(m => m.role === 'assistant');
  const systemLen = system.reduce((s, m) => s + m.content.length, 0);
  const userLen = user.reduce((s, m) => s + m.content.length, 0);
  const assistantLen = assistant.reduce((s, m) => s + m.content.length, 0);
  const totalLen = systemLen + userLen + assistantLen;
  return `${messages.length} msgs (system:${systemLen} user:${userLen} assistant:${assistantLen} total:${totalLen} chars)`;
}

function lastUserContent(messages: LLMMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return messages[i].content.substring(0, 150).replace(/\n/g, ' ');
    }
  }
  return '(none)';
}

export function withLogging(provider: LLMProvider): LLMProvider {
  return {
    name: provider.name,
    contextWindow: provider.contextWindow,
    maxOutputTokens: provider.maxOutputTokens,

    async generate(userPrompt: string, systemPrompt: string): Promise<string> {
      const start = Date.now();
      log.info('llm', `[${provider.name}] generate() — system: ${systemPrompt.length} chars, user: ${userPrompt.length} chars`);
      log.debug('llm', `[${provider.name}] user prompt: "${userPrompt.substring(0, 150).replace(/\n/g, ' ')}..."`);

      try {
        const result = await provider.generate(userPrompt, systemPrompt);
        const duration = ((Date.now() - start) / 1000).toFixed(1);
        log.info('llm', `[${provider.name}] generate() → ${result.length} chars in ${duration}s`);
        log.debug('llm', `[${provider.name}] response preview: "${result.substring(0, 150).replace(/\n/g, ' ')}..."`);
        return result;
      } catch (err) {
        const duration = ((Date.now() - start) / 1000).toFixed(1);
        log.error('llm', `[${provider.name}] generate() FAILED after ${duration}s`, err);
        throw err;
      }
    },

    async generateMultiTurn(messages: LLMMessage[]): Promise<string> {
      const start = Date.now();
      log.info('llm', `[${provider.name}] generateMultiTurn() — ${summarizeMessages(messages)}`);
      log.debug('llm', `[${provider.name}] last user msg: "${lastUserContent(messages)}..."`);

      try {
        const result = await provider.generateMultiTurn(messages);
        const duration = ((Date.now() - start) / 1000).toFixed(1);
        log.info('llm', `[${provider.name}] generateMultiTurn() → ${result.length} chars in ${duration}s`);
        log.debug('llm', `[${provider.name}] response preview: "${result.substring(0, 150).replace(/\n/g, ' ')}..."`);
        return result;
      } catch (err) {
        const duration = ((Date.now() - start) / 1000).toFixed(1);
        log.error('llm', `[${provider.name}] generateMultiTurn() FAILED after ${duration}s`, err);
        throw err;
      }
    },
  };
}
