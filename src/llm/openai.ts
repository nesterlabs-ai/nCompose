import OpenAI from 'openai';
import type { LLMProvider } from './provider.js';

export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  private client: OpenAI;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error(
        'OpenAI API key is required.\n' +
        'Set the OPENAI_API_KEY environment variable.'
      );
    }
    this.client = new OpenAI({ apiKey });
  }

  async generate(userPrompt: string, systemPrompt: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 8192,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI returned an empty response.');
    }
    return content;
  }
}
