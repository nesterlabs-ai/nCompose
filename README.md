# figma-to-code

Convert Figma designs into production-ready, import-ready components for **React**, **Vue**, **Svelte**, **Angular**, and **Solid** — powered by LLM intelligence and the [Mitosis](https://github.com/BuilderIO/mitosis) compiler.

Paste a Figma URL, get framework-native code with proper CSS, accessibility, icons, and variant support.

---

## Features

- **Multi-framework output** — One Figma design generates code for React, Vue, Svelte, Angular, and Solid simultaneously via Mitosis
- **Variant-aware** — COMPONENT_SETs with multiple variants (size, style, state) produce a single component with props, conditional CSS, and interactive states
- **Multi-section pages** — Full page designs (header, hero, features, footer) are split into sections, processed in parallel, and stitched into one component
- **Chart detection** — Pie, line, bar, and area charts are detected automatically and converted to interactive [Recharts](https://recharts.org/) components
- **Icon handling** — SVG icons are exported from all variants, deduplicated by position + shape + color, and embedded with proper conditional rendering
- **Accessibility** — Generated code is validated with [axe-core](https://github.com/dequelabs/axe-core) for WCAG compliance (serious/critical violations trigger auto-fix)
- **Fidelity validation** — CSS coverage, text content, layout structure, BEM consistency, and semantic HTML are all validated against the Figma source
- **Live preview** — WebContainer-powered Vite dev server in the browser with hot reload, or server-rendered static preview with full variant grid
- **Iterative refinement** — Chat with the LLM to refine generated code after initial conversion
- **Project persistence** — Projects persist across browser reloads with full variant grid, icons, code tabs, and chat history
- **Template wiring** — Wire generated components into a starter app with Tailwind CSS, `cn()` utility, and CSS variables
- **GitHub push** — Push generated code directly to GitHub via OAuth

---

## Quick Start

### Prerequisites

- **Node.js** 18+
- **Figma Personal Access Token** — [Generate here](https://www.figma.com/developers/api#access-tokens)
- **LLM API Key** — Anthropic (Claude), OpenAI (GPT-4o), or DeepSeek

### Installation

```bash
git clone https://github.com/AyushSinghal9020/Figma-Design-UI-Automator.git
cd Figma-Design-UI-Automator
npm install
```

### Environment Setup

Create a `.env` file in the project root:

```env
FIGMA_TOKEN=your_figma_personal_access_token

# At least one LLM provider is required:
ANTHROPIC_API_KEY=your_anthropic_key      # For --llm claude (default)
OPENAI_API_KEY=your_openai_key            # For --llm openai or deepseek
```

### Usage

#### Web UI (Recommended)

```bash
npm run dev -- serve
```

Open [http://localhost:3000](http://localhost:3000) — paste a Figma URL, select frameworks, and click Convert.

#### CLI

```bash
npm run dev -- convert "https://www.figma.com/design/XXXX/...?node-id=123-456" \
  -f react,vue,svelte \
  --llm claude \
  -o ./output
```

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

### Pipeline Paths

| Input Type | Path | Description |
|------------|------|-------------|
| `COMPONENT_SET` | **PATH A** | Parses variant axes (Style, Size, State), generates deterministic BEM CSS from Figma tokens, scans all variants for icons |
| Single node | **PATH B** | Serializes design to CSS-ready YAML, generates class-based component with extracted CSS |
| Multi-section page | **PATH C** | Detects sections, processes each in parallel (routing to PATH A/B per section), stitches into single page component |
| Chart/graph | **Chart codegen** | Detects chart patterns (arcs, grids), extracts data via LLM, generates Recharts component deterministically |

### Validation Pipeline

Every generated component passes through up to 6 validators before output:

1. **Accessibility** — axe-core WCAG audit (serious/critical)
2. **BEM Consistency** — CSS class names in JSX match the stylesheet
3. **Semantic HTML** — Correct elements for detected component type
4. **CSS Fidelity** — CSS properties match Figma design data
5. **Text Fidelity** — Text content from Figma appears in output
6. **Layout Fidelity** — Layout structure matches Figma hierarchy

Failures are fed back to the LLM for automatic correction (up to 3 retries).

---

## Web UI

The web interface provides a full-featured development experience:

- **Live preview** — WebContainer boots a Vite dev server in the browser; edits in the Monaco code editor sync to preview in real-time
- **Monaco editor** — VS Code's editor with syntax highlighting, multi-tab editing, and save-to-server
- **Variant grid** — COMPONENT_SET previews show all variant combinations (size x style x state)
- **Project sidebar** — Recent projects with thumbnails, click to restore, delete
- **Code view modes** — Switch between generated component code and wired starter app
- **File explorer** — Tree view with folder expand/collapse and file type icons
- **Chat refinement** — Iteratively refine code by chatting with the LLM
- **GitHub push** — Push to GitHub via OAuth
- **Download** — ZIP download of all generated files
- **Light/dark theme** — Toggle with persistence

### Session Persistence

- Projects persist in localStorage across browser reloads — preview, code tabs, chat history, and active file are all restored
- Server sessions have a 1-hour TTL with automatic disk fallback from the `output/` directory
- localStorage quota is managed automatically — assets and chat history are progressively trimmed from oldest projects when space runs low

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
    │   ├── left-icon-star.svg
    │   ├── right-icon-chevron.svg
    │   └── ...
    └── app/                         # Wired starter app (--template)
```

---

## CLI Reference

```
figma-to-code convert <url> [options]

Arguments:
  url                          Figma design URL with node-id parameter

Options:
  -f, --frameworks <list>      Comma-separated frameworks: react,vue,svelte,angular,solid
                               (default: react)
  --llm <provider>             LLM provider: claude, openai, deepseek
                               (default: claude)
  -o, --output <dir>           Output directory (default: ./output)
  --template                   Wire into starter app with Tailwind
  --preview                    Open preview after conversion

figma-to-code serve [options]

Options:
  -p, --port <number>          Server port (default: 3000)
```

---

## LLM Providers

| Provider | Flag | Model | Env Variable |
|----------|------|-------|-------------|
| Anthropic | `--llm claude` | Claude Sonnet 4.5 | `ANTHROPIC_API_KEY` |
| OpenAI | `--llm openai` | GPT-4o | `OPENAI_API_KEY` |
| DeepSeek | `--llm deepseek` | DeepSeek | `OPENAI_API_KEY` |

---

## Development

```bash
npm run dev       # Run CLI via tsx (no build step)
npm run build     # Compile TypeScript → dist/
npm test          # Run tests (vitest)
npm run test:watch # Watch mode
```

### Project Structure

```
src/
├── index.ts                    # CLI entry point
├── convert.ts                  # Pipeline orchestrator (path detection + routing)
├── output.ts                   # File writing
├── config.ts                   # Centralized configuration
├── types/                      # TypeScript types
├── figma/                      # Figma data extraction & parsing
│   ├── fetch.ts                # REST API client
│   ├── component-set-parser.ts # Variant parsing, BEM CSS
│   ├── asset-export.ts         # Icon export & deduplication
│   ├── chart-detection.ts      # Chart/graph detection
│   └── page-layout.ts          # Page layout extraction
├── figma-complete/             # Complete design data extractor
├── compile/                    # Compilation, validation, CSS injection
│   ├── retry.ts                # LLM → parse → validate → retry loop
│   ├── generate.ts             # Mitosis framework generators
│   ├── inject-css.ts           # Per-framework CSS injection
│   ├── stitch.ts               # PATH C section stitching
│   ├── chart-codegen.ts        # Recharts code generation
│   ├── a11y-validate.ts        # Accessibility validation
│   └── ...                     # BEM, semantic, fidelity validators
├── llm/                        # LLM provider implementations
├── prompt/                     # Prompt assembly
├── web/                        # Web UI server & client
│   ├── server.ts               # Express server (SSE, preview, download)
│   ├── preview.ts              # Preview HTML generator
│   ├── refine.ts               # Chat-based refinement
│   └── public/                 # Client-side app (app.js, index.html)
└── template/                   # Starter app wiring
```

For detailed architecture documentation, see [docs/WORKFLOW.md](docs/WORKFLOW.md).

---

## Dependencies

| Package | Purpose |
|---------|---------|
| [@builder.io/mitosis](https://github.com/BuilderIO/mitosis) | Multi-framework compiler (.lite.tsx → React/Vue/Svelte/Angular/Solid) |
| [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript) | Claude LLM provider |
| [openai](https://github.com/openai/openai-node) | OpenAI / DeepSeek LLM provider |
| [axe-core](https://github.com/dequelabs/axe-core) | WCAG accessibility validation |
| [jsdom](https://github.com/jsdom/jsdom) | DOM environment for validation |
| [recharts](https://recharts.org/) | React charting library (used in generated chart components) |
| [express](https://expressjs.com/) | Web server |
| [archiver](https://github.com/archiverjs/node-archiver) | ZIP download generation |
| [commander](https://github.com/tj/commander.js) | CLI framework |

---

## License

MIT
