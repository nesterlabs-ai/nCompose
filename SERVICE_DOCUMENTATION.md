# Figma-to-Mitosis Pipeline — Service Documentation

## Overview

A CLI service that converts Figma designs into **import-ready, multi-framework components**. Given a Figma URL, it produces pixel-accurate code for React, Vue, Svelte, Angular, and Solid — with deterministic CSS, exported assets, and Google Fonts loaded.

---

## Architecture Flow

```
Figma URL (input)
      |
      v
+---------------------+
| 1. Parse Figma URL  |  Extract fileKey + nodeId from any Figma URL format
+---------------------+
      |
      v
+---------------------+
| 2. Fetch from Figma |  FigmaClient.getFile() / getNode() via REST API
+---------------------+  Uses FIGMA_TOKEN for authentication
      |
      v
+---------------------+
| 3. Simplify         |  Framelink's simplifyRawFigmaObject()
+---------------------+  Produces a clean YAML with nodes, globalVars, components
      |
      v
+---------------------+
| 4. Enhance          |  Optional enhancement pass (rotation math, etc.)
+---------------------+
      |
      v
+---------------------+
| 5. Detect Path      |  Is root node a COMPONENT_SET?
+---------------------+
      |                \
      | YES             | NO
      v                 v
  PATH A             PATH B
  (Variants)         (Single Component)
      |                 |
      v                 v
  [See below]       [See below]
      |                 |
      +--------+--------+
               |
               v
+---------------------+
| 8. Compile Mitosis  |  parseJsx() + generateFrameworkCode()
+---------------------+  Produces React, Vue, Svelte, Angular, Solid
      |
      v
+---------------------+
| 9. Inject CSS       |  Framework-specific CSS injection
+---------------------+  (React: <style> tag, Vue: <style scoped>, etc.)
      |
      v
+---------------------+
| 10. Write Output    |  .lite.tsx + .jsx/.vue/.svelte/.ts/.tsx + ./assets/
+---------------------+
```

### PATH A: Component Set (Variant-Aware)

For Figma COMPONENT_SET nodes with variants (e.g., Button with Style/Size/State axes):

```
COMPONENT_SET detected
      |
      v
+---------------------------+
| Parse Variant Axes        |  Discovers axes: Style, Size, State
| Parse Variant Styles      |  Resolves CSS per variant from globalVars
| Parse Child Styles        |  Resolves per-child CSS per variant
| Discover Structure        |  Walks node tree to find children (text, icons, frames)
+---------------------------+
      |
      v
+---------------------------+
| Export SVG/Image Assets   |  FigmaClient.getImages() -> download to ./assets/
+---------------------------+  Deduplicates filenames (vector.svg, vector-2.svg, ...)
      |
      v
+---------------------------+
| Build Variant CSS         |  Deterministic CSS from design tokens:
|                           |    .base { layout }
|                           |    .base__child { child styles }
|                           |    .base--size { size overrides }
|                           |    .base--style { style visuals }
|                           |    .base--style:hover { state diffs }
|                           |    .base[disabled] .child { disabled diffs }
+---------------------------+
      |
      v
+---------------------------+
| Resolve Font Imports      |  Google Fonts @import from discovered font families
+---------------------------+
      |
      v
+---------------------------+
| Build LLM Prompt          |  Component structure + variant axes + class naming
|                           |  LLM only generates HTML structure with class="" bindings
+---------------------------+
      |
      v
+---------------------------+
| LLM Generates Mitosis     |  Claude/OpenAI/DeepSeek -> .lite.tsx
| (with retry loop)         |  Up to 3 attempts with error feedback
+---------------------------+
```

### PATH B: Single Component (Non-Variant)

For standalone Figma frames/components without variant structure:

```
Single component detected
      |
      v
+---------------------------+
| Extract Deterministic CSS |  Walk node tree, assign class names, extract all CSS
+---------------------------+
      |
      v
+---------------------------+
| Export Assets             |  Same as PATH A
+---------------------------+
      |
      v
+---------------------------+
| Build Class-Based Tree    |  ClassBasedNode tree with pre-assigned CSS classes
+---------------------------+
      |
      v
+---------------------------+
| LLM Generates Mitosis     |  Uses class-based system prompt + few-shot examples
+---------------------------+
```

---

## Key Modules

| Module | File | Purpose |
|--------|------|---------|
| CLI Entry | `src/index.ts` | Commander-based CLI, `figma-to-code convert <url>` |
| Pipeline Core | `src/convert.ts` | Orchestrates PATH A / PATH B conversion |
| Figma Client | `src/figma/fetch.ts` | REST API: getFile, getNode, getImages |
| Simplifier | `src/figma/simplify.ts` | Framelink wrapper for raw Figma data |
| Enhancer | `src/figma/enhance.ts` | Post-simplification enhancement |
| Style Extractor | `src/figma/style-extractor.ts` | Deterministic CSS from node tree (PATH B) |
| Component Set Parser | `src/figma/component-set-parser.ts` | Variant axes, styles, structure discovery (PATH A) |
| Variant Prompt Builder | `src/figma/variant-prompt-builder.ts` | LLM prompts for variant components |
| Asset Export | `src/figma/asset-export.ts` | SVG/PNG download with deduplication |
| Font Resolver | `src/compile/font-resolver.ts` | Google Fonts @import generation |
| Mitosis Parser | `src/compile/parse-and-validate.ts` | Parse LLM output into Mitosis AST |
| Code Generator | `src/compile/generate.ts` | Mitosis AST -> React/Vue/Svelte/Angular/Solid |
| CSS Injector | `src/compile/inject-css.ts` | Framework-specific CSS injection |
| Retry Loop | `src/compile/retry.ts` | LLM generate -> parse -> retry with error feedback |
| LLM Providers | `src/llm/claude.ts`, `openai.ts`, `deepseek.ts` | Claude, OpenAI, DeepSeek adapters |
| Class-Based Prompt | `src/prompt/class-based-prompt.ts` | System + user prompt assembly (PATH B) |
| URL Parser | `src/utils/figma-url-parser.ts` | Extracts fileKey and nodeId from Figma URLs |
| Output Writer | `src/output.ts` | File writing with directory creation |

---

## Supported Frameworks

| Framework | Output Extension | CSS Injection Method |
|-----------|-----------------|---------------------|
| React | `.jsx` | `<style>{css}</style>` in Fragment |
| Vue | `.vue` | `<style>` block |
| Svelte | `.svelte` | `<style>` block |
| Angular | `.ts` | `styles: [css]` in `@Component` |
| Solid | `.tsx` | `<style>{css}</style>` in Fragment |

---

## Supported LLM Providers

| Provider | Model | API Key Env Var |
|----------|-------|----------------|
| Claude (default) | `claude-sonnet-4-20250514` | `ANTHROPIC_API_KEY` |
| OpenAI | `gpt-4o` | `OPENAI_API_KEY` |
| DeepSeek | `deepseek-coder` | `DEEPSEEK_API_KEY` |

---

## CLI Usage

```bash
# Basic: React output from a Figma component
figma-to-code convert "https://www.figma.com/design/xxx/MyDesign?node-id=123-456" \
  --output ./output \
  --frameworks react

# Multi-framework with custom LLM
figma-to-code convert "https://www.figma.com/design/xxx/MyDesign?node-id=123-456" \
  --output ./components \
  --frameworks react,vue,svelte \
  --llm claude \
  --name MyComponent
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `-f, --frameworks` | `react` | Comma-separated: react, vue, svelte, angular, solid |
| `-o, --output` | `./output` | Output directory |
| `-n, --name` | auto-detected | Component name override |
| `--llm` | `claude` | LLM provider: claude, openai, deepseek |
| `--depth` | `25` | Figma tree traversal depth |

### Required Environment Variables

```bash
FIGMA_TOKEN=<figma-personal-access-token>
ANTHROPIC_API_KEY=<claude-api-key>     # if using --llm claude
OPENAI_API_KEY=<openai-api-key>        # if using --llm openai
DEEPSEEK_API_KEY=<deepseek-api-key>    # if using --llm deepseek
```

---

## What Gets Generated (Deterministically vs LLM)

| Aspect | Method | Notes |
|--------|--------|-------|
| CSS styles | **Deterministic** | Extracted from Figma tokens, zero LLM involvement |
| Font imports | **Deterministic** | Google Fonts @import from detected font families |
| Asset files (SVG/PNG) | **Deterministic** | Downloaded from Figma API |
| Variant CSS (state diffs) | **Deterministic** | Per-child style diffs computed mechanically |
| HTML structure | **LLM-generated** | Semantic HTML from component structure hints |
| Class bindings | **LLM-generated** | `class={state.classes}` pattern from prompt |
| Props interface | **LLM-generated** | Based on discovered variant axes |

---

## Key Design Decisions

1. **CSS is never hallucinated** — All styles come from Figma design tokens, resolved deterministically
2. **LLM only generates structure** — HTML elements + class bindings, nothing visual
3. **Generic structure discovery** — No hardcoded component types; children (text, icons, frames) are classified dynamically from the Figma node tree
4. **Per-child state diffs** — Each child element's CSS changes per state are computed independently
5. **Any axis combination** — Handles Style+Size+State, State-only, Style-only, or any mix
6. **Asset deduplication** — SVG filenames are deduplicated (vector.svg, vector-2.svg, ...)
7. **Multi-framework from single source** — Mitosis intermediate format compiles to 5 frameworks

---

## Test Suite

117 unit tests across 12 test files:

| Test File | Coverage |
|-----------|----------|
| `cli.test.ts` | CLI configuration and imports |
| `figma-url-parser.test.ts` | URL parsing (11 formats) |
| `figma-client.test.ts` | Figma API client |
| `enhance.test.ts` | Enhancement pass |
| `style-extractor.test.ts` | Deterministic CSS extraction (16 tests) |
| `font-resolver.test.ts` | Google Fonts URL generation (8 tests) |
| `cleanup.test.ts` | LLM output cleanup (15 tests) |
| `compile.test.ts` | Mitosis compilation (12 tests) |
| `llm-providers.test.ts` | LLM provider creation |
| `output.test.ts` | File output writing |
| `prompt-assembly.test.ts` | Prompt construction (21 tests) |
| `retry.test.ts` | Retry logic (7 tests) |

---

## Example: TextareaField Component

### Input

Figma URL:
```
https://www.figma.com/design/rAim3nrWukuYQQRmYU1L8r/SquareX-Design-System--Copy-?node-id=3425-23598&m=dev
```

This is a **COMPONENT_SET** with:
- **1 axis**: State (8 values: Default, Hover, Focused, Typing, Filled in, Filled in - Hover, Error, Disabled)
- **4 children**: Label (text), Description (text), Input (frame), Error (text)
- **8 SVG assets**: Drag icon (notches) across all states

### Pipeline Output

**Structure detected:** `State(8) | Structure: Label(text), Description(text), Input(frame), Error(text)`

**Files generated:**
```
test-output-textarea/
  TextareaField.lite.tsx    (Mitosis source)
  TextareaField.jsx         (React output with injected CSS)
  assets/
    vector.svg              (drag icon - state 1)
    vector-2.svg            (drag icon - state 2)
    vector-3.svg            (drag icon - state 3)
    vector-4.svg            (drag icon - state 4)
    vector-5.svg            (drag icon - state 5)
    vector-6.svg            (drag icon - state 6)
    vector-7.svg            (drag icon - state 7)
    vector-8.svg            (drag icon - state 8)
```

### Generated Mitosis Source (`TextareaField.lite.tsx`)

```tsx
import { useStore } from '@builder.io/mitosis';

export default function TextareaField(props) {
  const state = useStore({
    get classes() {
      const base = 'textarea-field';
      return base + (props.state ? ' ' + props.state : '') + (props.disabled ? ' disabled' : '');
    }
  });

  return (
    <div class={state.classes} disabled={props.disabled}>
      <span class="textarea-field__label">{props.label || 'Label'}</span>
      <span class="textarea-field__description">{props.description || 'Description'}</span>
      <div class="textarea-field__input">
        {props.children || 'Input'}
      </div>
      <span class="textarea-field__error">{props.error || 'Error'}</span>
    </div>
  );
}
```

### Generated React Output (`TextareaField.jsx`)

```jsx
import * as React from "react";

function TextareaField(props) {
  function classes() {
    const base = "textarea-field";
    return (
      base +
      (props.state ? " " + props.state : "") +
      (props.disabled ? " disabled" : "")
    );
  }

  return (
    <>
      <div className={classes()} disabled={props.disabled}>
        <span className="textarea-field__label">{props.label || "Label"}</span>
        <span className="textarea-field__description">
          {props.description || "Description"}
        </span>
        <div className="textarea-field__input">{props.children || "Input"}</div>
        <span className="textarea-field__error">{props.error || "Error"}</span>
      </div>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Host+Grotesk:wght@100;200;300;400;500;600;700;800;900&display=swap');

        .textarea-field {
          display: flex;
          flex-direction: column;
          gap: 8px;
          cursor: pointer;
        }

        .textarea-field__label {
          flex: 1;
          font-family: Host Grotesk;
          font-weight: 500;
          font-size: 14px;
          line-height: 1em;
          text-align: left;
          color: #2F353B;
        }

        .textarea-field__description {
          flex: 1;
          font-family: Host Grotesk;
          font-weight: 400;
          font-size: 14px;
          line-height: 1.429999896458217em;
          text-align: left;
          color: #768494;
        }

        .textarea-field__input {
          display: flex;
          flex-direction: row;
          align-self: stretch;
          gap: 16px;
          padding: 12px;
          flex: 1;
          background-color: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.4);
          border-radius: 8px;
          backdrop-filter: blur(10px);
        }

        .textarea-field__error {
          flex: 1;
          font-family: Host Grotesk;
          font-weight: 500;
          font-size: 14px;
          line-height: 1em;
          text-align: left;
          color: #EC221F;
        }

        /* Default state visuals */
        .textarea-field {
          background-color: transparent;
          border: none;
        }

        .textarea-field:hover .textarea-field__input {
          border: 1.5px solid #D6DADF;
        }

        .textarea-field.focused .textarea-field__input {
          border: 1.5px solid #4432BF;
        }

        .textarea-field.typing .textarea-field__input {
          border: 1.5px solid #4432BF;
        }

        .textarea-field.filled-in-hover .textarea-field__input {
          border: 1.5px solid #D6DADF;
        }

        .textarea-field.error .textarea-field__input {
          border: 1.5px solid #EC221F;
        }

        .textarea-field[disabled] .textarea-field__label {
          color: #CACACA;
        }

        .textarea-field[disabled] .textarea-field__description {
          color: #CACACA;
        }

        .textarea-field[disabled] .textarea-field__input {
          background-color: #DBDBDB;
          border: 1px solid #B8B8B8;
        }
      `}</style>
    </>
  );
}

export default TextareaField;
```

### Exported SVG Asset (example: `assets/vector.svg`)

```svg
<svg width="21" height="21" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M19.6896 10.9376L10.9376 19.6896M17.9392 1.31036L1.31036 17.9392"
        stroke="#2F353B" stroke-width="1.31" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

### CSS Breakdown

| CSS Selector | Source | What It Does |
|-------------|--------|-------------|
| `.textarea-field` | Default variant container layout | Flex column, 8px gap |
| `.textarea-field__label` | Default Label TEXT node | Host Grotesk 500/14px, color #2F353B |
| `.textarea-field__description` | Default Description TEXT node | Host Grotesk 400/14px, color #768494 |
| `.textarea-field__input` | Default Input FRAME node | Flex row, padding 12px, glassmorphism bg, 1px border |
| `.textarea-field__error` | Default Error TEXT node | Host Grotesk 500/14px, color #EC221F |
| `.textarea-field:hover .textarea-field__input` | Hover state diff | Border changes to 1.5px solid #D6DADF |
| `.textarea-field.focused .textarea-field__input` | Focused state diff | Border changes to 1.5px solid #4432BF |
| `.textarea-field.typing .textarea-field__input` | Typing state diff | Border changes to 1.5px solid #4432BF |
| `.textarea-field.error .textarea-field__input` | Error state diff | Border changes to 1.5px solid #EC221F |
| `.textarea-field[disabled] .textarea-field__label` | Disabled label diff | Color changes to #CACACA |
| `.textarea-field[disabled] .textarea-field__description` | Disabled desc diff | Color changes to #CACACA |
| `.textarea-field[disabled] .textarea-field__input` | Disabled input diff | Bg #DBDBDB, border 1px solid #B8B8B8 |

Every CSS value above was extracted **deterministically** from Figma design tokens. Zero LLM involvement in styling.
