<div align="center">

<img width="959" height="299" alt="nCompose-logo" src="https://github.com/user-attachments/assets/e049d030-0ec6-4dfa-a33b-1c72041ef9a1" />

[![License: MIT](https://img.shields.io/badge/License-MIT-007ec6?style=flat-square)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org/)
[![Contributors](https://img.shields.io/github/contributors/nesterlabs-ai/nCompose?style=flat-square)](https://github.com/nesterlabs-ai/nCompose/graphs/contributors)
[![GitHub stars](https://img.shields.io/github/stars/nesterlabs-ai/nCompose?style=flat-square&logo=github&color=f59e0b)](https://github.com/nesterlabs-ai/nCompose/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/nesterlabs-ai/nCompose?style=flat-square&logo=github&color=6366f1)](https://github.com/nesterlabs-ai/nCompose/forks)
[![Visit compose.nesterlabs.com](https://img.shields.io/static/v1?label=Visit&message=compose.nesterlabs.com&color=181717&style=flat-square)](https://compose.nesterlabs.com/)

**Convert Figma designs into production-ready UI components for React, Vue, Svelte, Angular, and Solid.**

</div>

nCompose takes a Figma URL and generates framework-native code with proper CSS, accessibility, icons, and variant support. It uses LLM intelligence to interpret design intent and the [Mitosis](https://github.com/BuilderIO/mitosis) compiler to target multiple frameworks from a single intermediate representation.

https://github.com/user-attachments/assets/799a7e70-c96c-4b0f-a105-9f46458749b5

---

## Features

- **Multi-framework output** — One Figma design generates code for React, Vue, Svelte, Angular, and Solid simultaneously via Mitosis
- **Variant-aware** — Component sets with multiple variants (size, style, state) produce a single component with props, conditional CSS, and interactive states
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
- **LLM API Key** — At least one of: DeepSeek (recommended) or Anthropic (Claude)

### Installation

```bash
git clone https://github.com/nesterlabs-ai/nCompose.git
cd nCompose
npm install
```

### Quick Start

**Web UI** (recommended):

```bash
npm run web
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
  --llm <provider>             LLM provider: deepseek, claude
                               (default: deepseek)
  -o, --output <dir>           Output directory (default: ./output)
  --template                   Wire into starter app with Tailwind
  --preview                    Open preview after conversion
```

The Web UI is not a `ncompose` subcommand — start it from the repo with `npm run web` (see Quick Start). Port defaults to `3000` (override with the `PORT` environment variable).

After `npm run build`, you can also run `npx ncompose` or `npx figma-to-code` (backwards-compatible alias).

### Web UI

The web interface provides a full-featured development experience:

- **Live preview** — WebContainer boots a Vite dev server in the browser with hot reload
- **Monaco editor** — VS Code's editor with syntax highlighting, multi-tab editing, and save-to-server
- **Variant grid** — Component set previews show all variant combinations
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

> We recommend using DeepSeek for conversions — it offers the best balance of speed, cost, and output quality.

---

## How It Works

<img width="831" height="1028" alt="final_diagram drawio" src="https://github.com/user-attachments/assets/de6f8bc9-f4ae-49ab-afe1-438b4ca259ce" />

---

### Pipeline Paths

| Input Type | Path | Description |
|------------|------|-------------|
| Component Set | **PATH A** | Parses variant axes, generates deterministic BEM CSS from Figma tokens, scans all variants for icons |
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