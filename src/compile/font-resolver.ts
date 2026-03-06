/**
 * Google Fonts resolver — scans CSS for font-family declarations and
 * generates @import statements to load them from Google Fonts.
 *
 * Used by all 3 pipeline paths to ensure generated components render
 * with the correct fonts without requiring manual developer setup.
 */

// System / generic families that should never be imported
const SYSTEM_FAMILIES = new Set([
  'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy',
  'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
  'emoji', 'math', 'fangsong',
  // Common system fonts
  'arial', 'helvetica', 'helvetica neue', 'times new roman', 'times',
  'georgia', 'verdana', 'tahoma', 'trebuchet ms', 'courier new', 'courier',
  'lucida console', 'lucida sans', 'impact', 'comic sans ms',
  // Apple system fonts
  'sf pro', 'sf pro display', 'sf pro text', 'sf pro rounded',
  'sf mono', 'sf compact', 'new york',
  '-apple-system', 'blinkmacsystemfont',
  // Microsoft system fonts
  'segoe ui', 'segoe ui variable',
  // Android/Google system fonts
  'roboto',
]);

/**
 * Scans a CSS string for all font-family declarations and returns
 * a deduplicated list of custom (non-system) font family names.
 */
export function collectFontFamilies(css: string): string[] {
  if (!css) return [];

  const families = new Set<string>();

  // Match font-family declarations: `font-family: "Name", fallback;`
  const fontFamilyRegex = /font-family\s*:\s*([^;}]+)/gi;
  let match: RegExpExecArray | null;

  while ((match = fontFamilyRegex.exec(css)) !== null) {
    const declaration = match[1].trim();

    // Split by comma to get individual family names
    for (const raw of declaration.split(',')) {
      const trimmed = raw.trim();
      // Remove quotes (single or double)
      const unquoted = trimmed.replace(/^["']|["']$/g, '').trim();
      if (!unquoted) continue;

      // Skip system/generic families
      if (SYSTEM_FAMILIES.has(unquoted.toLowerCase())) continue;

      families.add(unquoted);
    }
  }

  return [...families];
}

/**
 * Builds a Google Fonts @import URL for the given font families.
 * Returns empty string if no families provided.
 */
export function buildGoogleFontsImport(families: string[]): string {
  if (families.length === 0) return '';

  const familyParams = families
    .map((name) => {
      const encoded = name.replace(/\s+/g, '+');
      return `family=${encoded}:wght@300;400;500;600;700`;
    })
    .join('&');

  return `@import url('https://fonts.googleapis.com/css2?${familyParams}&display=swap');`;
}

/**
 * Builds a Google Fonts <link> tag for use in HTML <head>.
 * Returns empty string if no families provided.
 */
export function buildGoogleFontsLink(families: string[]): string {
  if (families.length === 0) return '';

  const familyParams = families
    .map((name) => {
      const encoded = name.replace(/\s+/g, '+');
      return `family=${encoded}:wght@300;400;500;600;700`;
    })
    .join('&');

  return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${familyParams}&display=swap" />`;
}

/**
 * Convenience: scans CSS for custom font families and prepends
 * a Google Fonts @import statement. Returns CSS unchanged if
 * no custom fonts are found.
 */
export function prependFontImport(css: string): string {
  if (!css) return css;

  const families = collectFontFamilies(css);
  const importStatement = buildGoogleFontsImport(families);
  if (!importStatement) return css;

  return `${importStatement}\n\n${css}`;
}
