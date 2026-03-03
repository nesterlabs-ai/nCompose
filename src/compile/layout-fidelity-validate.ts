/**
 * Layout fidelity validation for class-based generation.
 *
 * Ensures generated JSX actually uses the deterministic BEM element classes
 * from Figma-derived CSS, and blocks inline sizing styles that can override
 * exact dimensions/spacing.
 */

export interface LayoutFidelityOptions {
  /** Minimum fraction of expected BEM element classes that must appear in JSX */
  minimumElementCoverage?: number;
  /** Block inline css/style objects that set size/spacing/typography properties */
  forbidInlineSizing?: boolean;
}

export interface LayoutFidelityValidationResult {
  passed: boolean;
  missingElementClasses: string[];
  coverage: number;
  summary: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractCSSClassNames(css: string): string[] {
  const classPattern = /\.([a-zA-Z0-9_-]+(?:__[a-zA-Z0-9_-]+)?(?:--[a-zA-Z0-9_-]+)?)/g;
  const classes = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = classPattern.exec(css)) !== null) {
    classes.add(match[1]);
  }
  return [...classes];
}

function detectBaseClass(cssClasses: string[]): string | null {
  const base = cssClasses
    .filter((c) => !c.includes('__') && !c.includes('--') && !c.includes(':'))
    .sort((a, b) => a.length - b.length)[0];
  return base || null;
}

function extractExpectedElementClasses(css: string): string[] {
  const cssClasses = extractCSSClassNames(css);
  const base = detectBaseClass(cssClasses);
  if (!base) return [];

  return cssClasses
    .filter((c) => c.startsWith(`${base}__`) && !c.includes('--') && !c.includes(':'))
    .sort();
}

function containsClassToken(code: string, className: string): boolean {
  const tokenPattern = new RegExp(`\\b${escapeRegExp(className)}\\b`);
  return tokenPattern.test(code);
}

function hasInlineSizingStyle(code: string): boolean {
  const inlineBlocks = code.match(/(?:\bcss|\bstyle)\s*=\s*\{\{[\s\S]*?\}\}/g) ?? [];
  if (inlineBlocks.length === 0) return false;

  const sizingPropPattern =
    /\b(width|height|minWidth|minHeight|maxWidth|maxHeight|padding|margin|gap|fontSize|lineHeight|letterSpacing)\b/;

  return inlineBlocks.some((block) => sizingPropPattern.test(block));
}

export function validateLayoutFidelity(
  rawCode: string,
  css: string,
  options: LayoutFidelityOptions = {},
): LayoutFidelityValidationResult {
  const {
    minimumElementCoverage = 0.9,
    forbidInlineSizing = true,
  } = options;

  const errors: string[] = [];
  const expected = extractExpectedElementClasses(css);
  const used = expected.filter((cls) => containsClassToken(rawCode, cls));
  const missing = expected.filter((cls) => !containsClassToken(rawCode, cls));
  const coverage = expected.length > 0 ? used.length / expected.length : 1;

  if (expected.length > 0 && coverage < minimumElementCoverage) {
    errors.push(
      `Layout class coverage too low: ${(coverage * 100).toFixed(1)}% ` +
      `(${used.length}/${expected.length}). Missing classes include: ` +
      `${missing.slice(0, 8).join(', ')}`,
    );
  }

  if (forbidInlineSizing && hasInlineSizingStyle(rawCode)) {
    errors.push(
      'Inline sizing/spacing styles detected in JSX (`css={{...}}` or `style={{...}}`). ' +
      'For fidelity, rely on deterministic Figma-derived CSS classes only.',
    );
  }

  return {
    passed: errors.length === 0,
    missingElementClasses: missing,
    coverage,
    summary: errors.length > 0 ? `Layout fidelity validation failed:\n- ${errors.join('\n- ')}` : '',
  };
}

