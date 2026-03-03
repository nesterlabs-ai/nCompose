import OpenAI from 'openai';
import type { LLMProvider } from './provider.js';
import { config, type DeepSeekConfig } from '../config.js';

export class DeepSeekProvider implements LLMProvider {
  name = 'deepseek';
  contextWindow: number;
  maxOutputTokens: number;
  private client: OpenAI;
  private config: DeepSeekConfig;

  constructor(apiKey: string, overrides?: Partial<DeepSeekConfig>) {
    if (!apiKey) {
      throw new Error(
        'DeepSeek API key is required.\n' +
        'Set the DEEPSEEK_API_KEY environment variable.'
      );
    }
    this.config = { ...config.llm.deepseek, ...overrides };
    this.client = new OpenAI({
      baseURL: this.config.baseURL,
      apiKey,
    });
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
      throw new Error('DeepSeek returned an empty response.');
    }
    return content;
  }
}
