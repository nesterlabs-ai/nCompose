import { describe, it, expect } from 'vitest';
import { parseFigmaUrl } from '../src/utils/figma-url-parser.js';

describe('parseFigmaUrl', () => {
  // --- fileKey extraction ---

  it('extracts fileKey from /file/ URL', () => {
    const result = parseFigmaUrl('https://www.figma.com/file/ABC123xyz/My-Design');
    expect(result.fileKey).toBe('ABC123xyz');
    expect(result.nodeId).toBeUndefined();
  });

  it('extracts fileKey from /design/ URL', () => {
    const result = parseFigmaUrl('https://www.figma.com/design/XYZ789abc/My-Design');
    expect(result.fileKey).toBe('XYZ789abc');
  });

  it('handles URL without title segment', () => {
    const result = parseFigmaUrl('https://www.figma.com/file/ABC123xyz');
    expect(result.fileKey).toBe('ABC123xyz');
  });

  // --- nodeId extraction ---

  it('extracts node-id with colon separator', () => {
    const result = parseFigmaUrl('https://www.figma.com/file/ABC123/Title?node-id=123:456');
    expect(result.fileKey).toBe('ABC123');
    expect(result.nodeId).toBe('123:456');
  });

  it('extracts node-id with dash separator', () => {
    const result = parseFigmaUrl('https://www.figma.com/design/ABC123/Title?node-id=123-456');
    expect(result.nodeId).toBe('123:456');
  });

  it('extracts node-id with URL-encoded colon (%3A)', () => {
    const result = parseFigmaUrl('https://www.figma.com/design/ABC123/Title?node-id=123%3A456');
    expect(result.nodeId).toBe('123:456');
  });

  it('handles node-id with additional query params', () => {
    const result = parseFigmaUrl('https://www.figma.com/design/ABC123/Title?node-id=10:20&t=abc123&mode=dev');
    expect(result.fileKey).toBe('ABC123');
    expect(result.nodeId).toBe('10:20');
  });

  // --- no nodeId ---

  it('returns undefined nodeId when not present', () => {
    const result = parseFigmaUrl('https://www.figma.com/design/ABC123/Title');
    expect(result.nodeId).toBeUndefined();
  });

  // --- error cases ---

  it('throws on invalid URL (no figma.com)', () => {
    expect(() => parseFigmaUrl('https://google.com/something')).toThrow('Invalid Figma URL');
  });

  it('throws on invalid URL (no file or design path)', () => {
    expect(() => parseFigmaUrl('https://www.figma.com/community/plugin/123')).toThrow('Invalid Figma URL');
  });

  it('throws on invalid node-id format', () => {
    expect(() => parseFigmaUrl('https://www.figma.com/file/ABC123/Title?node-id=invalid')).toThrow('Invalid node-id format');
  });
});
