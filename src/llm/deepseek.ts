import OpenAI from 'openai';
import type { LLMProvider } from './provider.js';

export class DeepSeekProvider implements LLMProvider {
  name = 'deepseek';
  private client: OpenAI;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error(
        'DeepSeek API key is required.\n' +
        'Set the DEEPSEEK_API_KEY environment variable.'
      );
    }
    this.client = new OpenAI({
      baseURL: 'https://api.deepseek.com',
      apiKey,
    });
  }

  async generate(userPrompt: string, systemPrompt: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: 'deepseek-coder',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 8192,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('DeepSeek returned an empty response.');
    }
    return content;
  }
}
