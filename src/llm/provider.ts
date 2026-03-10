/**
 * A single message in a multi-turn LLM conversation.
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Common interface for all LLM providers.
 * Each provider wraps a different API (DeepSeek, Claude, OpenAI)
 * behind this single contract.
 */
export interface LLMProvider {
  /** Provider name for display purposes */
  name: string;

  /** Total context window size in tokens (input + output) */
  contextWindow: number;

  /** Maximum output tokens reserved for the response */
  maxOutputTokens: number;

  /**
   * Send a prompt to the LLM and get back a raw string response.
   * @param userPrompt - The user message (simplified Figma YAML + instructions)
   * @param systemPrompt - The system message (Mitosis rules + examples)
   * @returns The raw LLM text output (expected to be .lite.tsx code)
   */
  generate(userPrompt: string, systemPrompt: string): Promise<string>;

  /**
   * Send a multi-turn conversation to the LLM and get back a response.
   * Used for iterative refinement where context from previous turns matters.
   * @param messages - Array of system/user/assistant messages
   * @returns The raw LLM text output
   */
  generateMultiTurn(messages: LLMMessage[]): Promise<string>;
}
