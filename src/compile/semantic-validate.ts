/**
 * Semantic HTML element validation for generated Mitosis components.
 *
 * Ensures generated code uses the correct HTML elements for each component
 * category (e.g. buttons use <button>, checkboxes use <label> + <input>, etc.).
 *
 * Two-layer defense:
 * - Layer 1 (cleanup.ts): auto-fix <div> → correct root tag before parse
 * - Layer 2 (this file): validate after parse, feed errors to LLM for retry
 */

import type { ComponentCategory } from '../figma/component-set-parser.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExpectedElement {
  /** The required root HTML tag (e.g. 'button', 'nav', 'label') */
  rootTag: string;
  /** Alternative root tags that are also acceptable (e.g. 'section' for cards) */
  altRootTags?: string[];
  /** A tag that MUST appear somewhere inside the component (e.g. 'input' for form fields) */
  containedTag?: string;
  /** Extra attribute required on the contained tag (e.g. 'type="range"' for sliders) */
  containedTagAttr?: string;
  /** ARIA role required on the root element */
  requiredRole?: string;
  /** Whether the root being a wrapper <div> is acceptable (form fields with labels) */
  wrapperOk?: boolean;
}

export interface SemanticValidationResult {
  passed: boolean;
  summary: string;
}

// ─── Category → Expected Element Mapping ─────────────────────────────────────

const EXPECTED_ELEMENTS: Partial<Record<ComponentCategory, ExpectedElement>> = {
  'button':      { rootTag: 'button' },
  'icon-button': { rootTag: 'button' },
  'checkbox':    { rootTag: 'label' },
  'radio':       { rootTag: 'label' },
  'toggle':      { rootTag: 'button', requiredRole: 'switch' },
  'switch':      { rootTag: 'button', requiredRole: 'switch' },
  'link':        { rootTag: 'a' },
  'card':        { rootTag: 'article', altRootTags: ['section'] },
  'dialog':      { rootTag: 'dialog' },
  'modal':       { rootTag: 'dialog' },
  'tab':         { rootTag: 'button', requiredRole: 'tab' },
  'menu-item':   { rootTag: 'li' },
  'menu':        { rootTag: 'ul' },
  'badge':       { rootTag: 'span' },
  'navigation':  { rootTag: 'nav' },
  'breadcrumb':  { rootTag: 'nav' },
  'pagination':  { rootTag: 'nav' },
  'header':      { rootTag: 'header' },
  'footer':      { rootTag: 'footer' },
  'sidebar':     { rootTag: 'aside' },
  'drawer':      { rootTag: 'aside' },
  'divider':     { rootTag: 'hr' },
  'list':        { rootTag: 'ul', altRootTags: ['ol'] },
  'list-item':   { rootTag: 'li' },
  'table':       { rootTag: 'table' },
  'input':       { rootTag: 'div', wrapperOk: true, containedTag: 'input' },
  'textarea':    { rootTag: 'div', wrapperOk: true, containedTag: 'textarea' },
  'select':      { rootTag: 'div', wrapperOk: true, containedTag: 'select' },
  'slider':      { rootTag: 'div', wrapperOk: true, containedTag: 'input', containedTagAttr: 'type="range"' },
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns the expected semantic element spec for a component category.
 * Returns null for 'unknown' or unmapped categories (no validation needed).
 */
export function getExpectedElement(
  category: ComponentCategory | string,
  _suggestedHtmlTag?: string,
): ExpectedElement | null {
  return EXPECTED_ELEMENTS[category as ComponentCategory] ?? null;
}

/**
 * Extracts the root JSX tag name from a Mitosis component's return statement.
 *
 * Skips Mitosis wrapper components (<Show>, <For>, <Fragment>, <>)
 * to find the actual HTML root element.
 */
export function extractRootTag(code: string): string | null {
  // Find the return statement
  const returnMatch = code.match(/\breturn\s*\(/);
  if (!returnMatch) {
    // Try return without parens: return <div>...
    const directReturn = code.match(/\breturn\s+<(\w+)/);
    return directReturn ? directReturn[1] : null;
  }

  const afterReturn = code.substring(returnMatch.index! + returnMatch[0].length);

  // Skip whitespace and look for opening tag
  const tagMatch = afterReturn.match(/^\s*<(\w+)/);
  if (!tagMatch) return null;

  const tag = tagMatch[1];

  // If it's a Mitosis wrapper, look for the real root inside
  const MITOSIS_WRAPPERS = ['Show', 'For', 'Fragment'];
  if (MITOSIS_WRAPPERS.includes(tag)) {
    // Find the first HTML tag inside this wrapper
    const wrapperClose = afterReturn.indexOf('>');
    if (wrapperClose === -1) return null;
    const insideWrapper = afterReturn.substring(wrapperClose + 1);
    const innerTag = insideWrapper.match(/^\s*<(\w+)/);
    if (innerTag && !MITOSIS_WRAPPERS.includes(innerTag[1])) {
      return innerTag[1].toLowerCase();
    }
    return tag.toLowerCase();
  }

  return tag.toLowerCase();
}

/**
 * Validates that generated code uses the correct semantic HTML elements.
 *
 * Checks:
 * 1. Root tag matches expected (or alternate) tag
 * 2. Required ARIA role is present
 * 3. Contained element exists for wrapper categories (e.g. <input> inside input wrapper)
 *
 * Returns { passed: true } if valid, or { passed: false, summary } with
 * LLM-friendly fix instructions.
 */
export function validateSemanticElement(
  rawCode: string,
  expected: ExpectedElement,
): SemanticValidationResult {
  const errors: string[] = [];
  const rootTag = extractRootTag(rawCode);

  // 1. Root tag check
  if (rootTag) {
    const validRoots = [expected.rootTag, ...(expected.altRootTags ?? [])];

    if (!expected.wrapperOk) {
      // Root must be one of the valid tags
      if (!validRoots.includes(rootTag)) {
        errors.push(
          `Root element is <${rootTag}> but MUST be <${expected.rootTag}>.` +
          (expected.altRootTags?.length
            ? ` Acceptable alternatives: ${expected.altRootTags.map(t => `<${t}>`).join(', ')}.`
            : '') +
          ` Change the outermost element tag.`
        );
      }
    }
    // For wrapper-ok categories, any root is fine — we just check contained element
  }

  // 2. Required ARIA role check
  if (expected.requiredRole) {
    const rolePattern = new RegExp(`role=["']${expected.requiredRole}["']`);
    if (!rolePattern.test(rawCode)) {
      errors.push(
        `Missing required role="${expected.requiredRole}" on the root <${expected.rootTag}> element. ` +
        `Add role="${expected.requiredRole}" to the outermost element.`
      );
    }
  }

  // 3. Contained element check (for wrapper categories like input, textarea, select, slider)
  if (expected.containedTag) {
    const containedPattern = new RegExp(`<${expected.containedTag}[\\s/>]`);
    if (!containedPattern.test(rawCode)) {
      errors.push(
        `Component MUST contain a <${expected.containedTag}> element but none was found. ` +
        `Add a real <${expected.containedTag}> element inside the wrapper — never fake it with a <div>.`
      );
    } else if (expected.containedTagAttr) {
      // Check for required attribute on the contained tag
      const attrPattern = new RegExp(
        `<${expected.containedTag}[^>]*${expected.containedTagAttr}[^>]*/?>`,
      );
      if (!attrPattern.test(rawCode)) {
        errors.push(
          `The <${expected.containedTag}> element must have ${expected.containedTagAttr}. ` +
          `Add ${expected.containedTagAttr} to the <${expected.containedTag}> element.`
        );
      }
    }
  }

  if (errors.length === 0) {
    return { passed: true, summary: '' };
  }

  return {
    passed: false,
    summary: `Semantic HTML validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`,
  };
}
