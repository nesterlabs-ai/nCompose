import OpenAI from 'openai';
import type { LLMProvider, LLMMessage } from './provider.js';
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
    let response;
    try {
      response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = (err as { status?: number })?.status;
      if (status === 401) {
        throw new Error(
          `DeepSeek authentication failed (401). ` +
          `Check DEEPSEEK_API_KEY or OPENAI_API_KEY in your .env file.\nDetails: ${msg}`
        );
      }
      if (status === 404) {
        throw new Error(
          `DeepSeek model "${this.config.model}" not found (404). ` +
          `Check the DEEPSEEK_MODEL env var (current: "${this.config.model}").\nDetails: ${msg}`
        );
      }
      if (status === 429) {
        throw new Error(
          `DeepSeek rate limit exceeded (429). ` +
          `Reduce request frequency or upgrade your plan.\nDetails: ${msg}`
        );
      }
      if (status === 500 || status === 503) {
        throw new Error(
          `DeepSeek service unavailable (${status}). Try again later.\nDetails: ${msg}`
        );
      }
      throw new Error(`DeepSeek API request failed: ${msg}`);
    }

    const content = response.choices[0]?.message?.content;
    if (!content) {
      const finishReason = response.choices[0]?.finish_reason;
      throw new Error(
        `DeepSeek returned an empty response` +
        (finishReason ? ` (finish_reason: ${finishReason})` : '.') +
        '\nPossible causes: content filtered, model refused request, or max_tokens too low.'
      );
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
      throw new Error('DeepSeek returned an empty response.');
    }
    return content;
  }
}
