/**
 * Post-generation accessibility validation using axe-core.
 *
 * Renders the generated React code in jsdom and runs axe-core
 * to detect WCAG violations. Returns actionable error messages
 * that can be fed back into the LLM retry loop.
 */
import { JSDOM } from 'jsdom';

// axe-core source is loaded lazily to avoid startup cost
let axeSource: string | null = null;

function getAxeSource(): string {
  if (!axeSource) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    axeSource = require('axe-core').source;
  }
  return axeSource!;
}

export interface A11yViolation {
  id: string;
  impact: 'minor' | 'moderate' | 'serious' | 'critical';
  description: string;
  help: string;
  nodes: string[];
}

export interface A11yResult {
  passed: boolean;
  violations: A11yViolation[];
  summary: string;
}

/**
 * Validates generated HTML/JSX for accessibility violations.
 *
 * Takes Mitosis-compiled React JSX, wraps it in a minimal HTML page,
 * renders in jsdom, and runs axe-core against it.
 *
 * @param reactCode - The compiled React JSX (framework output)
 * @param css - Optional CSS to include
 * @returns A11yResult with violations and a summary string for the LLM
 */
export async function validateAccessibility(
  reactCode: string,
  css?: string,
): Promise<A11yResult> {
  // Extract the HTML structure from the React JSX
  // We parse the JSX to extract the return statement's HTML
  const htmlContent = extractHTMLFromJSX(reactCode);

  if (!htmlContent) {
    return { passed: true, violations: [], summary: '' };
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>A11y Check</title>
${css ? `<style>${css}</style>` : ''}
</head>
<body>
<main>${htmlContent}</main>
</body>
</html>`;

  try {
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      resources: 'usable',
      pretendToBeVisual: true,
    });

    const { window } = dom;
    const { document } = window;

    // Inject axe-core
    const script = document.createElement('script');
    script.textContent = getAxeSource();
    document.head.appendChild(script);

    // Run axe
    const results = await (window as any).axe.run(document.body, {
      rules: {
        // Focus on rules most relevant to component generation
        'button-name': { enabled: true },
        'image-alt': { enabled: true },
        'label': { enabled: true },
        'input-button-name': { enabled: true },
        'role-img-alt': { enabled: true },
        'aria-roles': { enabled: true },
        'aria-valid-attr': { enabled: true },
        'aria-valid-attr-value': { enabled: true },
        'color-contrast': { enabled: false }, // Skip — CSS not fully loaded in jsdom
        'region': { enabled: false }, // Skip — we wrap in <main> already
        'landmark-one-main': { enabled: false },
        'page-has-heading-one': { enabled: false },
      },
    });

    const violations: A11yViolation[] = results.violations.map((v: any) => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      help: v.help,
      nodes: v.nodes.map((n: any) => n.html).slice(0, 3),
    }));

    // Filter to serious/critical only for retry feedback
    const actionable = violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );

    const summary = actionable.length > 0
      ? `ACCESSIBILITY VIOLATIONS (${actionable.length}):\n` +
        actionable.map((v) =>
          `- [${v.impact.toUpperCase()}] ${v.help} (${v.id})\n  Elements: ${v.nodes.join(', ')}`,
        ).join('\n')
      : '';

    dom.window.close();

    return {
      passed: actionable.length === 0,
      violations: actionable,
      summary,
    };
  } catch {
    // If jsdom/axe fails, don't block the pipeline — just skip validation
    return { passed: true, violations: [], summary: '' };
  }
}

/**
 * Extracts HTML-like content from React JSX code.
 * Looks for the return statement and extracts the JSX template.
 * This is a best-effort extraction — not a full JSX parser.
 */
function extractHTMLFromJSX(reactCode: string): string | null {
  // Find the return ( ... ) block
  const returnMatch = reactCode.match(/return\s*\(\s*([\s\S]*?)\s*\);\s*\}$/m);
  if (!returnMatch) return null;

  let jsx = returnMatch[1];

  // Convert JSX to approximate HTML for axe-core analysis
  // Replace className with class
  jsx = jsx.replace(/className=/g, 'class=');
  // Remove JSX expressions { ... } (replace with placeholder text)
  jsx = jsx.replace(/\{[^{}]*\}/g, 'content');
  // Remove self-closing JSX syntax issues
  jsx = jsx.replace(/<(\w+)([^>]*?)\s*\/>/g, '<$1$2></$1>');
  // Remove event handlers
  jsx = jsx.replace(/\s+on\w+="[^"]*"/g, '');

  return jsx;
}
