import { describe, it, expect } from 'vitest';
import {
  stripMarkdownFences,
  fixMissingImports,
  cleanLLMOutput,
} from '../src/compile/cleanup.js';

describe('stripMarkdownFences', () => {
  it('removes ```tsx fences', () => {
    const input = '```tsx\nconst x = 1;\n```';
    expect(stripMarkdownFences(input)).toBe('const x = 1;');
  });

  it('removes ```typescript fences', () => {
    const input = '```typescript\nconst x = 1;\n```';
    expect(stripMarkdownFences(input)).toBe('const x = 1;');
  });

  it('removes ```jsx fences', () => {
    const input = '```jsx\nconst x = 1;\n```';
    expect(stripMarkdownFences(input)).toBe('const x = 1;');
  });

  it('removes plain ``` fences', () => {
    const input = '```\nconst x = 1;\n```';
    expect(stripMarkdownFences(input)).toBe('const x = 1;');
  });

  it('returns code unchanged when no fences', () => {
    const input = 'const x = 1;';
    expect(stripMarkdownFences(input)).toBe('const x = 1;');
  });

  it('handles extra whitespace around fences', () => {
    const input = '  ```tsx\nconst x = 1;\n```  ';
    expect(stripMarkdownFences(input)).toBe('const x = 1;');
  });

  it('preserves internal code content', () => {
    const code = `import { useStore } from '@builder.io/mitosis';

export default function Button(props) {
  return <button>Click</button>;
}`;
    const input = '```tsx\n' + code + '\n```';
    expect(stripMarkdownFences(input)).toBe(code);
  });
});

describe('fixMissingImports', () => {
  it('adds useStore import when used but not imported', () => {
    const code = `export default function Foo(props) {
  const state = useStore({ count: 0 });
  return <div>{state.count}</div>;
}`;
    const fixed = fixMissingImports(code);
    expect(fixed).toContain("import { useStore } from '@builder.io/mitosis'");
  });

  it('adds Show to existing import when used but missing', () => {
    const code = `import { useStore } from '@builder.io/mitosis';

export default function Foo(props) {
  const state = useStore({ visible: true });
  return <Show when={state.visible}><div>Hi</div></Show>;
}`;
    const fixed = fixMissingImports(code);
    expect(fixed).toContain("import { useStore, Show } from '@builder.io/mitosis'");
  });

  it('adds For to existing import when used but missing', () => {
    const code = `import { useStore } from '@builder.io/mitosis';

export default function List(props) {
  const state = useStore({ items: [] });
  return <For each={state.items}>{(item) => <div>{item}</div>}</For>;
}`;
    const fixed = fixMissingImports(code);
    expect(fixed).toContain("import { useStore, For } from '@builder.io/mitosis'");
  });

  it('adds multiple missing imports at once', () => {
    const code = `import { useStore } from '@builder.io/mitosis';

export default function Foo(props) {
  const state = useStore({ items: [], visible: true });
  return (
    <Show when={state.visible}>
      <For each={state.items}>{(item) => <div>{item}</div>}</For>
    </Show>
  );
}`;
    const fixed = fixMissingImports(code);
    expect(fixed).toContain('Show');
    expect(fixed).toContain('For');
    expect(fixed).toContain('useStore');
  });

  it('does not duplicate already-imported symbols', () => {
    const code = `import { useStore, Show, For } from '@builder.io/mitosis';

export default function Foo(props) {
  const state = useStore({ items: [], visible: true });
  return (
    <Show when={state.visible}>
      <For each={state.items}>{(item) => <div>{item}</div>}</For>
    </Show>
  );
}`;
    const fixed = fixMissingImports(code);
    // Should be unchanged
    expect(fixed).toBe(code);
  });

  it('returns code unchanged when no Mitosis features used', () => {
    const code = `export default function Foo(props) {
  return <div>Hello</div>;
}`;
    const fixed = fixMissingImports(code);
    expect(fixed).toBe(code);
  });

  it('adds full import line when no mitosis import exists', () => {
    const code = `export default function Foo(props) {
  const state = useStore({ count: 0 });
  return <Show when={state.count > 0}><div>{state.count}</div></Show>;
}`;
    const fixed = fixMissingImports(code);
    expect(fixed).toMatch(/^import \{ useStore, Show \} from '@builder\.io\/mitosis'/);
  });
});

describe('cleanLLMOutput', () => {
  it('strips fences and fixes imports in one pass', () => {
    const input = `\`\`\`tsx
export default function Alert(props) {
  const state = useStore({ visible: true });
  return <Show when={state.visible}><div>Alert!</div></Show>;
}
\`\`\``;
    const { jsx: cleaned } = cleanLLMOutput(input);
    expect(cleaned).not.toContain('```');
    expect(cleaned).toContain("import { useStore, Show } from '@builder.io/mitosis'");
    expect(cleaned).toContain('export default function Alert');
  });

  it('extracts CSS from ---CSS--- delimiter', () => {
    const input = `export default function Card(props) {
  return <div class="card"><h2 class="card__title">Hello</h2></div>;
}
---CSS---
.card { padding: 16px; }
.card__title { font-size: 24px; }`;
    const { jsx, css } = cleanLLMOutput(input);
    expect(jsx).toContain('export default function Card');
    expect(jsx).not.toContain('---CSS---');
    expect(jsx).not.toContain('.card {');
    expect(css).toContain('.card { padding: 16px; }');
    expect(css).toContain('.card__title { font-size: 24px; }');
  });

  it('returns empty css when no CSS block present', () => {
    const input = `export default function Simple(props) {
  return <div>Hello</div>;
}`;
    const { jsx, css } = cleanLLMOutput(input);
    expect(jsx).toContain('export default function Simple');
    expect(css).toBe('');
  });
});
