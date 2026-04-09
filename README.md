# nCompose

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org/)
[![npm version](https://img.shields.io/npm/v/ncompose.svg)](https://www.npmjs.com/package/ncompose)
[![Build Status](https://img.shields.io/github/actions/workflow/status/nesterlabs-ai/nCompose/deploy.yml?branch=main)](https://github.com/nesterlabs-ai/nCompose/actions)

**Convert Figma designs into production-ready UI components for React, Vue, Svelte, Angular, and Solid.**

nCompose takes a Figma URL and generates framework-native code with proper CSS, accessibility, icons, and variant support. It uses LLM intelligence to interpret design intent and the [Mitosis](https://github.com/BuilderIO/mitosis) compiler to target multiple frameworks from a single intermediate representation.

<!-- TODO: Add a demo GIF or screenshot here -->
<!-- ![nCompose Demo](docs/assets/demo.gif) -->

---

## Features

- **Multi-framework output** — One Figma design generates code for React, Vue, Svelte, Angular, and Solid simultaneously via Mitosis
- **Variant-aware** — COMPONENT_SETs with multiple variants (size, style, state) produce a single component with props, conditional CSS, and interactive states
- **Multi-section pages** — Full page designs (header, hero, features, footer) are split into sections, processed in parallel, and stitched into one component
- **Chart detection** — Pie, line, bar, and area charts are detected automatically and converted to interactive [Recharts](https://recharts.org/) components
- **Icon handling** — SVG icons are exported from all variants, deduplicated by position + shape + color, and embedded with proper conditional rendering
- **Accessibility** — Generated code is validated with [axe-core](https://github.com/dequelabs/axe-core) for WCAG compliance (serious/critical violations trigger auto-fix)
- **Fidelity validation** — CSS coverage, text content, layout structure, BEM consistency, and semantic HTML are validated against the Figma source
- **Live preview** — WebContainer-powered Vite dev server in the browser with hot reload, or server-rendered static preview with full variant grid
- **Visual edit mode** — Click any element in the preview to target it, then describe changes in natural language or edit CSS properties directly
- **Iterative refinement** — Chat with the LLM to refine generated code after initial conversion
- **Template wiring** — Wire generated components into a starter app with Tailwind CSS, `cn()` utility, and CSS variables
- **GitHub push** — Push generated code directly to GitHub via OAuth
- **Security hardened** — SSRF protection, SVG sanitization, prompt injection defense, rate limiting, and security headers

---

## Getting Started

### Prerequisites

- **Node.js** 22+
- **Figma Personal Access Token** — [Generate here](https://www.figma.com/developers/api#access-tokens)
- **LLM API Key** — At least one of: Anthropic (Claude), OpenAI (GPT-4o), or DeepSeek

### Installation

```bash
git clone https://github.com/nesterlabs-ai/nCompose.git
cd nCompose
npm install
```

### Quick Start

**Web UI** (recommended):

```bash
npm run dev -- serve
```

Open [http://localhost:3000](http://localhost:3000) — paste a Figma URL, select frameworks, and click Convert.

**CLI**:

```bash
npm run dev -- convert "https://www.figma.com/design/XXXX/...?node-id=123-456" \
  -f react,vue,svelte \
  --llm deepseek \
  -o ./output
```

---

## Usage

### CLI Reference

```
ncompose convert <url> [options]

Arguments:
  url                          Figma design URL with node-id parameter

Options:
  -f, --frameworks <list>      Comma-separated frameworks: react,vue,svelte,angular,solid
                               (default: react)
  --llm <provider>             LLM provider: claude, openai, deepseek
                               (default: deepseek)
  -o, --output <dir>           Output directory (default: ./output)
  --template                   Wire into starter app with Tailwind
  --preview                    Open preview after conversion

ncompose serve [options]

Options:
  -p, --port <number>          Server port (default: 3000)
```

After `npm run build`, you can also run `npx ncompose` or `npx figma-to-code` (backwards-compatible alias).

### Web UI

The web interface provides a full-featured development experience:

- **Live preview** — WebContainer boots a Vite dev server in the browser with hot reload
- **Monaco editor** — VS Code's editor with syntax highlighting, multi-tab editing, and save-to-server
- **Variant grid** — COMPONENT_SET previews show all variant combinations
- **Project sidebar** — Recent projects with thumbnails, click to restore
- **Visual edit** — Click elements in the preview, then describe changes or edit CSS directly
- **Chat refinement** — Iteratively refine code by chatting with the LLM
- **GitHub push** — Push to GitHub via OAuth
- **Download** — ZIP download of all generated files
- **Light/dark theme** — Toggle with persistence

### LLM Providers

| Provider | Flag | Model | Env Variable |
|----------|------|-------|-------------|
| DeepSeek | `--llm deepseek` (default) | deepseek-chat | `DEEPSEEK_API_KEY` |
| Anthropic | `--llm claude` | claude-sonnet-4-20250514 | `ANTHROPIC_API_KEY` |
| OpenAI | `--llm openai` | GPT-4o | `OPENAI_API_KEY` |

---

## How It Works

```
Figma URL → Figma REST API → Design Data Extraction → Path Detection
                                                           │
                     ┌─────────────────────────────────────┼──────────────────┐
                     │                                     │                  │
               PATH A                                PATH B             PATH C
           COMPONENT_SET                          Single Node       Multi-Section
          (variant-aware)                        (any element)         Page
                     │                                     │                  │
                     └─────────────────────────────────────┼──────────────────┘
                                                           │
                                                    LLM Generation
                                                (with retry + validation)
                                                           │
                                                  Mitosis .lite.tsx
                                                           │
                                            ┌──────────────┼──────────────┐
                                          React    Vue   Svelte  Angular  Solid
                                            │              │              │
                                            └──────────────┼──────────────┘
                                                           │
                                                   CSS Injection +
                                                   Font Resolution
                                                           │
                                                     Output Files
```

| Input Type | Path | Description |
|------------|------|-------------|
| `COMPONENT_SET` | **PATH A** | Parses variant axes, generates deterministic BEM CSS from Figma tokens, scans all variants for icons |
| Single node | **PATH B** | Serializes design to CSS-ready YAML, generates class-based component with extracted CSS |
| Multi-section page | **PATH C** | Detects sections, processes each in parallel, stitches into single page component |
| Chart/graph | **Chart** | Detects chart patterns, extracts data via LLM, generates Recharts component |

### Validation Pipeline

Every generated component passes through up to 6 validators:

1. **Accessibility** — axe-core WCAG audit (serious/critical)
2. **BEM Consistency** — CSS class names in JSX match the stylesheet
3. **Semantic HTML** — Correct elements for detected component type
4. **CSS Fidelity** — CSS properties match Figma design data
5. **Text Fidelity** — Text content from Figma appears in output
6. **Layout Fidelity** — Layout structure matches Figma hierarchy

Failures are fed back to the LLM for automatic correction (up to 3 retries).

---

## Output Structure

```
output/
└── ComponentName-{sessionId}/
    ├── ComponentName.lite.tsx       # Mitosis source
    ├── ComponentName.jsx            # React
    ├── ComponentName.vue            # Vue
    ├── ComponentName.svelte         # Svelte
    ├── ComponentName.ts             # Angular
    ├── ComponentName.tsx            # Solid
    ├── ComponentName.meta.json      # Variant metadata
    ├── ComponentName.fidelity.json  # Validation report
    ├── assets/
    │   └── *.svg                    # Exported icons
    └── app/                         # Wired starter app (--template)
```

---

## Roadmap

- [ ] Publish to npm as a standalone CLI package
- [ ] Tailwind utility class output mode (alongside BEM CSS)
- [ ] Storybook export with variant stories auto-generated
- [ ] Additional framework targets (Qwik, Lit)

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, branch naming, commit conventions, and PR process.

---

## License

[MIT](LICENSE) — Nester Labs
