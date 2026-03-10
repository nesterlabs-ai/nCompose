import OpenAI from 'openai';
import type { LLMProvider, LLMMessage } from './provider.js';
import { config, type OpenAIConfig } from '../config.js';

export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  contextWindow: number;
  maxOutputTokens: number;
  private client: OpenAI;
  private config: OpenAIConfig;

  constructor(apiKey: string, overrides?: Partial<OpenAIConfig>) {
    if (!apiKey) {
      throw new Error(
        'OpenAI API key is required.\n' +
        'Set the OPENAI_API_KEY environment variable.'
      );
    }
    this.client = new OpenAI({ apiKey });
    this.config = { ...config.llm.openai, ...overrides };
    this.contextWindow = this.config.contextWindow;
    this.maxOutputTokens = this.config.maxTokens;
  }

  async generate(userPrompt: string, systemPrompt: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI returned an empty response.');
    }
    return content;
  }

  async generateMultiTurn(messages: LLMMessage[]): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.config.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI returned an empty response.');
    }
    return content;
  }
}
