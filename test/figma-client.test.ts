import { describe, it, expect } from 'vitest';
import { FigmaClient } from '../src/figma/fetch.js';

describe('FigmaClient', () => {
  it('throws when constructed with empty token', () => {
    expect(() => new FigmaClient('')).toThrow('Figma token is required');
  });

  it('constructs successfully with a token', () => {
    const client = new FigmaClient('test-token-123');
    expect(client).toBeDefined();
  });
});
