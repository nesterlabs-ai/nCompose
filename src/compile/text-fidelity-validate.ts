/**
 * Text fidelity validation for generated Mitosis code.
 *
 * Goal: prevent generic placeholder copy ("Label", "Item", "Button", etc.)
 * when real Figma text literals are known.
 */

export interface TextFidelityValidationResult {
  passed: boolean;
  offenders: string[];
  summary: string;
}

const GENERIC_PLACEHOLDERS = new Set([
  'label',
  'labels',
  'item',
  'items',
  'button',
  'buttons',
  'title',
  'description',
  'helper text',
  'text',
  'content',
  'name',
  'value',
  'link',
  'tab',
  'chip',
  'action',
  'placeholder',
  'error',
]);

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function unescapeLiteral(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\'/g, '\'')
    .replace(/\\"/g, '"')
    .replace(/\\`/g, '`');
}

/**
 * Extract likely user-visible text literals from generated JSX/code.
 */
export function extractLikelyTextLiterals(code: string): string[] {
  const literals = new Set<string>();

  // Common pattern in generated output: {props.foo || 'Fallback text'}
  const fallbackRegex = /(?:\|\||\?\?)\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let match: RegExpExecArray | null;
  while ((match = fallbackRegex.exec(code)) !== null) {
    const raw = unescapeLiteral(match[2]).trim();
    if (raw) literals.add(raw);
  }

  // Direct text nodes: >Some text<
  const textNodeRegex = />\s*([^<>{\n][^<>{\n]{0,200})\s*</g;
  while ((match = textNodeRegex.exec(code)) !== null) {
    const raw = match[1].trim();
    if (raw) literals.add(raw);
  }

  return [...literals].filter((text) => {
    if (text.length === 0 || text.length > 120) return false;
    if (!/[a-zA-Z]/.test(text)) return false;
    // Ignore obvious non-copy strings
    if (/(^https?:)|(\.svg$)|(\.png$)|(__)|(--)|(rgb\()|(rgba\()|(var\()|(px\b)/i.test(text)) {
      return false;
    }
    return true;
  });
}

/**
 * Blocks generic placeholder text when it is not part of expected Figma text.
 */
export function validateTextFidelity(
  rawCode: string,
  expectedTextLiterals?: string[],
): TextFidelityValidationResult {
  const expected = new Set(
    (expectedTextLiterals ?? [])
      .map((t) => normalizeText(String(t)))
      .filter((t) => t.length > 0),
  );

  if (expected.size === 0) {
    return { passed: true, offenders: [], summary: '' };
  }

  const literals = extractLikelyTextLiterals(rawCode);
  const offenders = literals.filter((literal) => {
    const normalized = normalizeText(literal);
    return GENERIC_PLACEHOLDERS.has(normalized) && !expected.has(normalized);
  });

  if (offenders.length === 0) {
    return { passed: true, offenders: [], summary: '' };
  }

  const expectedPreview = [...expected].slice(0, 10).join(', ');
  return {
    passed: false,
    offenders,
    summary:
      `Text fidelity validation failed: generated generic placeholder text not present in Figma: ` +
      `${offenders.map((o) => `"${o}"`).join(', ')}.\n` +
      `Use exact text content from Figma defaults/props. Expected text literals include: ${expectedPreview}`,
  };
}

