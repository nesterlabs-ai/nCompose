/**
 * Content Extractor for shadcn/ui Codegen
 *
 * Extracts labels, placeholders, helper texts, and boolean props from Figma nodes.
 */

export interface ExtractedContent {
  label?: string;
  placeholder?: string;
  helperText?: string;
  booleanProps?: Record<string, boolean>;
  allTexts?: string[];
}

export function extractComponentContent(node: any, formRole: string): ExtractedContent {
  const content: ExtractedContent = {};
  const texts = collectTexts(node);
  content.allTexts = texts;

  // Boolean properties from componentPropertyDefinitions
  const propDefs = node?.componentPropertyDefinitions;
  if (propDefs && typeof propDefs === 'object') {
    const bp: Record<string, boolean> = {};
    for (const [name, def] of Object.entries(propDefs as Record<string, any>)) {
      if (def?.type === 'BOOLEAN') bp[name] = def.defaultValue ?? true;
    }
    if (Object.keys(bp).length > 0) content.booleanProps = bp;
  }

  if (formRole === 'button' || formRole === 'icon-button') {
    content.label = findByNameHint(node, ['label', 'text', 'title']) ?? texts[0];
  } else if (formRole === 'textInput' || formRole === 'input') {
    content.label = findByNameHint(node, ['label']);
    content.placeholder = findByNameHint(node, ['placeholder', 'hint']);
    content.helperText = findByNameHint(node, ['helper', 'description', 'error']);
  } else {
    content.label = texts[0];
  }

  return content;
}

function collectTexts(node: any): string[] {
  const texts: string[] = [];
  (function walk(n: any) {
    if (!n) return;
    if (n.type === 'TEXT' && n.characters?.trim()) texts.push(n.characters.trim());
    if (Array.isArray(n.children)) for (const c of n.children) walk(c);
  })(node);
  return texts;
}

function findByNameHint(node: any, hints: string[]): string | undefined {
  const results: Array<{ text: string; depth: number }> = [];
  (function walk(n: any, depth: number) {
    if (!n) return;
    const name = (n.name ?? '').toLowerCase();
    if (n.type === 'TEXT' && n.characters?.trim()) {
      if (hints.some(h => name.includes(h))) { results.push({ text: n.characters.trim(), depth }); return; }
    }
    if (Array.isArray(n.children)) {
      const match = hints.some(h => name.includes(h));
      for (const c of n.children) {
        if (match && c.type === 'TEXT' && c.characters?.trim()) { results.push({ text: c.characters.trim(), depth }); return; }
        walk(c, depth + 1);
      }
    }
  })(node, 0);
  if (results.length === 0) return undefined;
  results.sort((a, b) => a.depth - b.depth);
  return results[0].text;
}

export function formatContentForPrompt(content: ExtractedContent): string {
  const lines: string[] = ['## Component Content'];
  if (content.label) lines.push(`- Label: "${content.label}"`);
  if (content.placeholder) lines.push(`- Placeholder: "${content.placeholder}"`);
  if (content.helperText) lines.push(`- Helper text: "${content.helperText}"`);
  if (content.booleanProps) {
    lines.push('- Boolean properties:');
    for (const [n, v] of Object.entries(content.booleanProps)) lines.push(`  - ${n}: ${v}`);
  }
  if (content.allTexts?.length) lines.push(`- All text content: ${content.allTexts.map(t => `"${t}"`).join(', ')}`);
  return lines.join('\n');
}
