/**
 * CSS Fidelity Validator
 *
 * Compares expected visual values from the YAML design data against the
 * generated CSS to catch missing colors, fonts, borders, and shadows.
 * Advisory-only — feeds back to LLM but doesn't block compilation.
 */

export interface CSSFidelityResult {
  passed: boolean;
  /** 0-1, percentage of expected values found in the generated CSS */
  coverage: number;
  /** Values from YAML not found in CSS */
  missingValues: string[];
  /** LLM-friendly error message */
  summary: string;
}

/**
 * Normalize a CSS value for fuzzy matching.
 * - Lowercases
 * - Strips whitespace inside rgb()/rgba()
 * - Trims
 */
function normalizeCSSValue(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/\s*,\s*/g, ',')
    .replace(/\s+/g, ' ');
}

/**
 * Parse an rgb/rgba string into numeric components.
 * Returns null if not an rgb/rgba value.
 */
function parseRGB(v: string): { r: number; g: number; b: number; a?: number } | null {
  const match = v.match(/rgba?\((\d+),(\d+),(\d+)(?:,([0-9.]+))?\)/);
  if (!match) return null;
  return {
    r: parseInt(match[1]),
    g: parseInt(match[2]),
    b: parseInt(match[3]),
    a: match[4] !== undefined ? parseFloat(match[4]) : undefined,
  };
}

/**
 * Check if two values match with ±1 RGB tolerance for colors.
 */
function fuzzyMatch(expected: string, actualSet: Set<string>): boolean {
  const norm = normalizeCSSValue(expected);
  if (actualSet.has(norm)) return true;

  // Try ±1 tolerance for RGB colors
  const rgb = parseRGB(norm);
  if (!rgb) return false;

  for (let dr = -1; dr <= 1; dr++) {
    for (let dg = -1; dg <= 1; dg++) {
      for (let db = -1; db <= 1; db++) {
        const r = rgb.r + dr;
        const g = rgb.g + dg;
        const b = rgb.b + db;
        if (r < 0 || g < 0 || b < 0 || r > 255 || g > 255 || b > 255) continue;
        const candidate = rgb.a !== undefined
          ? `rgba(${r},${g},${b},${rgb.a})`
          : `rgb(${r},${g},${b})`;
        if (actualSet.has(candidate)) return true;
      }
    }
  }

  return false;
}

/**
 * Walk YAML parsed content and extract expected CSS values.
 * Looks for fills, textStyle colors/fonts, borders, shadows, borderRadius, opacity.
 */
function extractExpectedValues(yaml: string): Set<string> {
  const values = new Set<string>();

  // Extract color values: rgb(...), rgba(...), #hex
  const colorRe = /(?:rgb|rgba)\([^)]+\)|#[0-9a-fA-F]{3,8}/g;
  let match;
  while ((match = colorRe.exec(yaml)) !== null) {
    values.add(normalizeCSSValue(match[0]));
  }

  // Extract font sizes: e.g. fontSize: "16px" or fontSize: 16px
  const fontSizeRe = /fontSize:\s*['"]?(\d+(?:\.\d+)?px)['"]?/g;
  while ((match = fontSizeRe.exec(yaml)) !== null) {
    values.add(normalizeCSSValue(match[1]));
  }

  // Extract font weights: fontWeight: 700
  const fontWeightRe = /fontWeight:\s*['"]?(\d{3})['"]?/g;
  while ((match = fontWeightRe.exec(yaml)) !== null) {
    values.add(match[1]);
  }

  // Extract border radius: borderRadius: "8px"
  const brRe = /borderRadius:\s*['"]?([0-9]+(?:\.\d+)?px(?:\s+[0-9]+(?:\.\d+)?px)*)['"]?/g;
  while ((match = brRe.exec(yaml)) !== null) {
    values.add(normalizeCSSValue(match[1]));
  }

  // Extract gradients: linear-gradient(...), radial-gradient(...)
  const gradRe = /(?:linear|radial|conic)-gradient\([^)]+\)/g;
  while ((match = gradRe.exec(yaml)) !== null) {
    // For gradients, just check that the individual color stops are present
    const innerColors = match[0].match(/(?:rgb|rgba)\([^)]+\)|#[0-9a-fA-F]{3,8}/g);
    if (innerColors) {
      for (const c of innerColors) values.add(normalizeCSSValue(c));
    }
  }

  return values;
}

/**
 * Extract all CSS values from generated CSS text.
 */
function extractCSSValues(css: string): Set<string> {
  const values = new Set<string>();

  // Colors
  const colorRe = /(?:rgb|rgba)\([^)]+\)|#[0-9a-fA-F]{3,8}/g;
  let match;
  while ((match = colorRe.exec(css)) !== null) {
    values.add(normalizeCSSValue(match[0]));
  }

  // Font sizes
  const fontSizeRe = /font-size:\s*([0-9]+(?:\.\d+)?px)/g;
  while ((match = fontSizeRe.exec(css)) !== null) {
    values.add(normalizeCSSValue(match[1]));
  }

  // Font weights
  const fontWeightRe = /font-weight:\s*(\d{3})/g;
  while ((match = fontWeightRe.exec(css)) !== null) {
    values.add(match[1]);
  }

  // Border radius
  const brRe = /border-radius:\s*([0-9]+(?:\.\d+)?px(?:\s+[0-9]+(?:\.\d+)?px)*)/g;
  while ((match = brRe.exec(css)) !== null) {
    values.add(normalizeCSSValue(match[1]));
  }

  // Shorthand font
  const shorthandFontRe = /font:\s*[^;]+/g;
  while ((match = shorthandFontRe.exec(css)) !== null) {
    const sizes = match[0].match(/\d+(?:\.\d+)?px/g);
    if (sizes) for (const s of sizes) values.add(normalizeCSSValue(s));
    const weights = match[0].match(/\b(\d{3})\b/g);
    if (weights) for (const w of weights) values.add(w);
  }

  return values;
}

/**
 * Validate that expected CSS values from the YAML appear in the generated CSS.
 *
 * @param yamlContent - The YAML design data sent to the LLM
 * @param generatedCSS - The CSS output (from LLM-generated code or deterministic CSS)
 * @param threshold - Minimum coverage ratio (0-1) to pass. Default 0.5
 */
export function validateCSSFidelity(
  yamlContent: string,
  generatedCSS: string,
  threshold: number = 0.5,
): CSSFidelityResult {
  const expected = extractExpectedValues(yamlContent);
  if (expected.size === 0) {
    return { passed: true, coverage: 1, missingValues: [], summary: '' };
  }

  const actual = extractCSSValues(generatedCSS);
  const missing: string[] = [];

  for (const val of expected) {
    if (!fuzzyMatch(val, actual)) {
      missing.push(val);
    }
  }

  const coverage = (expected.size - missing.length) / expected.size;
  const passed = coverage >= threshold;

  let summary = '';
  if (!passed) {
    const top = missing.slice(0, 8);
    summary =
      `CSS fidelity: ${Math.round(coverage * 100)}% of expected design values found (need ${Math.round(threshold * 100)}%).\n` +
      `Missing values: ${top.join(', ')}${missing.length > 8 ? ` and ${missing.length - 8} more` : ''}.\n` +
      `Ensure ALL colors, font sizes, font weights, border-radius, and shadows from the YAML appear in your CSS.`;
  }

  return { passed, coverage, missingValues: missing, summary };
}
