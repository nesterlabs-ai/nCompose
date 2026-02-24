import { describe, it, expect } from 'vitest';
import { DeepSeekProvider } from '../src/llm/deepseek.js';
import { ClaudeProvider } from '../src/llm/claude.js';
import { OpenAIProvider } from '../src/llm/openai.js';
import { createLLMProvider } from '../src/llm/index.js';

describe('LLM Providers', () => {
  describe('DeepSeekProvider', () => {
    it('has correct name', () => {
      const provider = new DeepSeekProvider('test-key');
      expect(provider.name).toBe('deepseek');
    });
  });

  describe('ClaudeProvider', () => {
    it('has correct name', () => {
      const provider = new ClaudeProvider('test-key');
      expect(provider.name).toBe('claude');
    });
  });

  describe('OpenAIProvider', () => {
    it('has correct name', () => {
      const provider = new OpenAIProvider('test-key');
      expect(provider.name).toBe('openai');
    });
  });

  describe('createLLMProvider factory', () => {
    it('creates DeepSeekProvider for "deepseek"', () => {
      process.env.DEEPSEEK_API_KEY = 'test-key';
      const provider = createLLMProvider('deepseek');
      expect(provider.name).toBe('deepseek');
      delete process.env.DEEPSEEK_API_KEY;
    });

    it('creates ClaudeProvider for "claude"', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const provider = createLLMProvider('claude');
      expect(provider.name).toBe('claude');
      delete process.env.ANTHROPIC_API_KEY;
    });

    it('creates OpenAIProvider for "openai"', () => {
      process.env.OPENAI_API_KEY = 'test-key';
      const provider = createLLMProvider('openai');
      expect(provider.name).toBe('openai');
      delete process.env.OPENAI_API_KEY;
    });
  });
});
