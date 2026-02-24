import { describe, it, expect } from 'vitest';
import { calculateOriginalRect, isAbsolutePositioned } from '../src/figma/enhance.js';

describe('calculateOriginalRect', () => {
  it('returns same dimensions when rotation is 0', () => {
    const result = calculateOriginalRect(200, 100, 0);
    expect(result.width).toBe(200);
    expect(result.height).toBe(100);
  });

  it('reverses a 90-degree rotation (width/height swap)', () => {
    // A 200x100 rect rotated 90° has a bounding box of 100x200
    const result = calculateOriginalRect(100, 200, 90);
    expect(result.width).toBeCloseTo(200, 0);
    expect(result.height).toBeCloseTo(100, 0);
  });

  it('handles a 30-degree rotation', () => {
    // For a known rect (200x100) rotated 30°:
    // bboxW = 200*cos30 + 100*sin30 = 173.2 + 50 = 223.2
    // bboxH = 200*sin30 + 100*cos30 = 100 + 86.6 = 186.6
    const result = calculateOriginalRect(223.2, 186.6, 30);
    expect(result.width).toBeCloseTo(200, 0);
    expect(result.height).toBeCloseTo(100, 0);
  });

  it('falls back to bounding box at ~45 degrees', () => {
    const result = calculateOriginalRect(150, 150, 45);
    expect(result.width).toBe(150);
    expect(result.height).toBe(150);
  });

  it('handles negative rotation', () => {
    const result = calculateOriginalRect(100, 200, -90);
    expect(result.width).toBeCloseTo(200, 0);
    expect(result.height).toBeCloseTo(100, 0);
  });
});

describe('isAbsolutePositioned', () => {
  it('returns false for undefined layout', () => {
    expect(isAbsolutePositioned(undefined)).toBe(false);
  });

  it('returns false for auto-layout (row/column)', () => {
    expect(isAbsolutePositioned({ mode: 'row' })).toBe(false);
    expect(isAbsolutePositioned({ mode: 'column' })).toBe(false);
  });

  it('returns true for mode "none"', () => {
    expect(isAbsolutePositioned({ mode: 'none' })).toBe(true);
  });

  it('returns true for explicit position "absolute"', () => {
    expect(isAbsolutePositioned({ mode: 'row', position: 'absolute' })).toBe(true);
  });
});
