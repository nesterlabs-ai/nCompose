/**
 * BEM class name consistency validation.
 *
 * Checks that CSS class names used in JSX match the classes defined
 * in the generated CSS. Catches common LLM mistakes like:
 *   - JSX uses `className="frame-1"` but CSS defines `.checkbox-field__frame-1`
 *   - JSX uses `checkbox__box` but CSS defines `.checkbox-field__box`
 */

export interface BEMValidationResult {
  passed: boolean;
  /** Classes used in JSX but not found in CSS */
  missingInCSS: string[];
  /** Summary string suitable for feeding back to the LLM */
  summary: string;
}

/**
 * Validates that class names used in the JSX code exist in the CSS.
 *
 * @param jsxCode - The Mitosis .lite.tsx source code
 * @param css - The generated CSS string
 * @returns Validation result with any mismatches
 */
export function validateBEMConsistency(
  jsxCode: string,
  css: string,
): BEMValidationResult {
  // Extract class names from JSX: class="foo" or class={state.classes}
  // We look for static class strings in the JSX
  const jsxClassPattern = /class="([^"]+)"/g;
  const jsxClasses = new Set<string>();
  let match;

  while ((match = jsxClassPattern.exec(jsxCode)) !== null) {
    // Split compound classes (e.g. "btn btn--primary")
    for (const cls of match[1].split(/\s+/)) {
      if (cls && !cls.includes('{') && !cls.includes('$')) {
        jsxClasses.add(cls);
      }
    }
  }

  // Extract class names from CSS: .class-name { ... }
  const cssClassPattern = /\.([a-zA-Z0-9_-]+(?:__[a-zA-Z0-9_-]+)?(?:--[a-zA-Z0-9_-]+)?)/g;
  const cssClasses = new Set<string>();

  while ((match = cssClassPattern.exec(css)) !== null) {
    cssClasses.add(match[1]);
  }

  // If no CSS classes found, skip validation (CSS might be inline-styled)
  if (cssClasses.size === 0) {
    return { passed: true, missingInCSS: [], summary: '' };
  }

  // Derive the root base class from CSS (the class that has no __ or -- suffix)
  const cssBase = [...cssClasses]
    .filter((c) => !c.includes('__') && !c.includes('--') && !c.includes(':'))
    .sort((a, b) => a.length - b.length)[0]; // shortest = most likely the root

  // All element classes defined in CSS for the base component
  const cssElementClasses = cssBase
    ? [...cssClasses].filter(
        (c) => c.startsWith(cssBase + '__') && !c.includes('--') && !c.includes(':'),
      )
    : [];

  // Find JSX classes that don't exist in CSS
  // Allow dynamic classes (from state.classes getter) — only check static ones
  const missingInCSS: string[] = [];

  for (const cls of jsxClasses) {
    // Skip if the class exists directly in CSS
    if (cssClasses.has(cls)) continue;

    // Skip if it's a BEM modifier that might be applied dynamically
    if (cls.includes('--')) continue;

    // Case 1: BEM element without the base prefix
    // e.g. JSX has "frame-1" but CSS has "checkbox-field__frame-1"
    const matchesWithPrefix = [...cssClasses].some(
      (cssClass) => cssClass.endsWith(`__${cls}`),
    );
    if (matchesWithPrefix) {
      const correctClass = [...cssClasses].find(
        (cssClass) => cssClass.endsWith(`__${cls}`),
      );
      missingInCSS.push(
        `"${cls}" should be "${correctClass}" (use full BEM path)`,
      );
      continue;
    }

    // Case 2: Completely invented BEM element class — not in CSS at all
    // e.g. JSX uses "toast__content" but CSS only has "toast__frame-2147225756"
    if (cssBase && cls.startsWith(cssBase + '__')) {
      const suggestions = cssElementClasses.slice(0, 5);
      missingInCSS.push(
        `"${cls}" is not defined in CSS.` +
        (suggestions.length > 0
          ? ` Available element classes: ${suggestions.join(', ')}`
          : ` No element classes found for base ".${cssBase}"`),
      );
    }
  }

  const summary = missingInCSS.length > 0
    ? `BEM CLASS NAME MISMATCHES (${missingInCSS.length}):\n` +
      `The following class names in JSX don't match the CSS:\n` +
      missingInCSS.map((m) => `- ${m}`).join('\n') +
      `\n\nFix: Only use class names that appear in the CSS. ` +
      `Available element classes: ${cssElementClasses.slice(0, 8).join(', ')}`
    : '';

  return {
    passed: missingInCSS.length === 0,
    missingInCSS,
    summary,
  };
}
