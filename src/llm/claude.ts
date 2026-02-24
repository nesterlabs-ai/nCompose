import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider } from './provider.js';

export class ClaudeProvider implements LLMProvider {
  name = 'claude';
  private client: Anthropic;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error(
        'Anthropic API key is required.\n' +
        'Set the ANTHROPIC_API_KEY environment variable.'
      );
    }
    this.client = new Anthropic({ apiKey });
  }

  async generate(userPrompt: string, systemPrompt: string): Promise<string> {
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
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
