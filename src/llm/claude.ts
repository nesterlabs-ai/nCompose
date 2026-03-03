import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider } from './provider.js';
import { config, type ClaudeConfig } from '../config.js';

export class ClaudeProvider implements LLMProvider {
  name = 'claude';
  contextWindow: number;
  maxOutputTokens: number;
  private client: Anthropic;
  private config: ClaudeConfig;

  constructor(apiKey: string, overrides?: Partial<ClaudeConfig>) {
    if (!apiKey) {
      throw new Error(
        'Anthropic API key is required.\n' +
        'Set the ANTHROPIC_API_KEY environment variable.'
      );
    }
    this.client = new Anthropic({ apiKey });
    this.config = { ...config.llm.claude, ...overrides };
    this.contextWindow = this.config.contextWindow;
    this.maxOutputTokens = this.config.maxTokens;
  }

  async generate(userPrompt: string, systemPrompt: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    );
    if (!textBlock?.text) {
      throw new Error('Claude returned an empty response.');
    }
    return textBlock.text;
  }
}
