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

  // Find JSX classes that don't exist in CSS
  // Allow dynamic classes (from state.classes getter) — only check static ones
  const missingInCSS: string[] = [];

  for (const cls of jsxClasses) {
    // Skip if the class exists directly in CSS
    if (cssClasses.has(cls)) continue;

    // Skip if it's a BEM modifier that might be applied dynamically
    if (cls.includes('--')) continue;

    // Check if this might be a BEM element without the base prefix
    // e.g. JSX has "frame-1" but CSS has "checkbox-field__frame-1"
    const matchesWithPrefix = [...cssClasses].some(
      (cssClass) => cssClass.endsWith(`__${cls}`),
    );

    if (matchesWithPrefix) {
      // The class exists in CSS but with a BEM prefix — this is the mismatch
      const correctClass = [...cssClasses].find(
        (cssClass) => cssClass.endsWith(`__${cls}`),
      );
      missingInCSS.push(
        `"${cls}" should be "${correctClass}" (use full BEM path)`,
      );
    }
  }

  const summary = missingInCSS.length > 0
    ? `BEM CLASS NAME MISMATCHES (${missingInCSS.length}):\n` +
      `The following class names in JSX don't match the CSS:\n` +
      missingInCSS.map((m) => `- ${m}`).join('\n') +
      `\n\nFix: Always use the full BEM path from the root class. ` +
      `E.g. use "component-name__child" not just "child".`
    : '';

  return {
    passed: missingInCSS.length === 0,
    missingInCSS,
    summary,
  };
}
