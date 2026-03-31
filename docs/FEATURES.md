# Nester Labs — Feature Overview

**Transform Figma into Engineering-Grade Code**

Nester Labs is an AI-powered design-to-code platform that converts Figma designs into production-ready, multi-framework components with pixel-perfect fidelity.

---

## Supported Frameworks

| Framework | Output |
|-----------|--------|
| React | JSX with useState hooks |
| Vue 3 | Composition API SFC |
| Svelte | Variables-based component |
| Angular | Standalone component |
| Solid | Store-based component |
| Mitosis | Universal .lite.tsx source |

Generate for one or all frameworks simultaneously from a single Figma design.

---

## Core Conversion Engine

### One-Click Figma Import
- Paste any Figma design URL to start conversion
- Supports individual components, component sets (variants), and full page layouts
- Automatic node type detection routes to the optimal conversion pipeline

### Intelligent Path Detection
- **Component Sets** — Variant-aware generation with prop axes, interactive states (hover, focus, disabled), and BEM-structured CSS
- **Single Components** — Standalone component generation with deterministic CSS extracted directly from Figma tokens
- **Full Pages** — Multi-section page layouts with per-section parallel generation and automatic stitching into a unified component
- **Charts & Graphs** — Auto-detected and generated as Recharts components (pie, bar, line, area, donut)

### Deterministic CSS from Figma
- CSS properties extracted directly from Figma design tokens — no LLM guessing
- BEM naming convention for class-based styling
- Interactive states: `:hover`, `:focus`, `:active`, `[disabled]`, `[aria-busy]` with proper guards (`:not([disabled])`)
- Web behavioral properties: `cursor`, `transition`, `user-select` added automatically for interactive elements
- Spinner `@keyframes` animation auto-detected and emitted

### Smart Asset Export
- SVG icons automatically detected and exported from all component variants
- Intelligent deduplication by position, shape, and color signature
- Color-aware grouping: same icon shape with different fills gets separate SVG files
- Visibility-aware: hidden icon slots (e.g., loading states) are correctly skipped
- Deterministic filenames: `{position}-{icon-name}.svg`

---

## Web Application

### Design Workspace
- **Split-panel layout** with resizable preview and code editor side-by-side
- **Component stats bar** showing bundle size (KB), lines of code, accessibility score, and live preview status
- **Dark / Light theme** toggle with persistent preference

### Live Preview

Three preview modes, automatically selected by priority:

1. **WebContainer Live Preview** — Full Vite dev server running in the browser with hot module reload. Edit code and see changes reflected instantly.
2. **Server Static Preview** — CDN-rendered React preview with in-browser JSX transpilation and asset serving.
3. **Offline Inline Preview** — Reconstructed from local storage with embedded data-URI assets. Works without any server connection.

### Variant Grid
- Renders every variant combination for component sets
- Rows for property axes (Style, Size, Color) and columns for states (Default, Hover, Focus, Disabled)
- Each variant is labeled and independently clickable for targeted editing
- Boolean prop toggles (Show Icon, Loading, etc.) reflected in the grid

### Code Editor
- **Monaco Editor** with full syntax highlighting for TypeScript, JSX, Vue, Svelte, and Angular
- **Multi-file tabs** — switch between Mitosis source and all framework outputs
- **Copy to clipboard** with one click
- **Save edits** — modified code persists to server and syncs to live preview
- **Wired App view** — toggle between generated component and full project file explorer

### Wired Starter App
- One-click integration into a complete Next.js starter project
- Pre-configured with Tailwind CSS, CSS variables, and shadcn/ui components
- Full file explorer with folder tree navigation and file-type icons
- Runnable project — download and `npm install && npm run dev`
- Recharts dependency auto-added when charts are detected

---

## Iterative Refinement

### Chat-Based Refinement
- Send natural language instructions to refine the generated component
- Multi-turn conversation with context maintained across turns
- AI understands the full component structure and modifies accordingly
- CSS is preserved if the AI omits it during refinement
- All framework outputs are automatically recompiled after each refinement

### Visual Edit Mode
- Click any element in the live preview to select it
- **Property controls** for the selected element:
  - Text content
  - Text color and background color (with color picker)
  - Font size, weight, and style
  - Margin (all sides or individual)
  - Padding (all sides or individual)
  - Text alignment and flex direction
- **Floating AI prompt** — type a natural language instruction targeting the selected element
- **Variant-aware** — when editing inside a variant grid, the AI receives variant context (e.g., "Primary / Hover")
- **Unsaved edits bar** — see count of pending changes with Discard / Save actions

---

## Project Management

### Project History
- Last 8 converted projects displayed in sidebar with thumbnails and timestamps
- One-click restoration of any previous project (code, preview, chat history, assets)
- Duplicate detection — alerts when the same Figma URL has already been converted
- Delete individual projects from history

### Session Persistence
- All project data automatically saved to browser localStorage
- Authenticated users get server-side persistence via DynamoDB
- Smart storage management: progressively trims assets, chat history, then oldest projects when storage quota is reached
- Server sessions maintained for 1 hour with automatic disk fallback after expiry

### Figma Token Management
- Save Figma Personal Access Token securely in browser
- Token reused across conversions with visibility toggle
- Status indicator showing token availability

---

## Export & Download

### ZIP Download
- **Component ZIP** — Mitosis source + all framework outputs + SVG assets
- **Full Project ZIP** — Complete runnable Next.js starter app with component integrated

### GitHub Integration
- Push generated code directly to a GitHub repository
- OAuth-based GitHub authentication
- File list API for selective push

### Output Structure
Every conversion produces:
- `ComponentName.lite.tsx` — Mitosis universal source
- `ComponentName.jsx` — React
- `ComponentName.vue` — Vue 3
- `ComponentName.svelte` — Svelte
- `ComponentName.ts` — Angular
- `ComponentName.tsx` — Solid
- `ComponentName.meta.json` — Component metadata and variant axes
- `ComponentName.fidelity.json` — Quality diagnostics report
- `assets/*.svg` — Exported and deduplicated SVG icons

---

## Quality Assurance

### Automated Validation Pipeline
Every generated component passes through six validation checks before delivery:

| Check | What It Validates |
|-------|-------------------|
| **Accessibility** | WCAG compliance via axe-core — flags serious and critical violations |
| **BEM Consistency** | All class names in JSX have matching CSS rules |
| **Semantic HTML** | Correct HTML elements for component category (buttons use `<button>`, etc.) |
| **CSS Fidelity** | CSS property coverage matches original Figma design data |
| **Text Fidelity** | All text content from Figma appears in the generated output |
| **Layout Fidelity** | CSS class coverage for all child layout elements |

### Smart Retry
- Failed validations automatically trigger LLM retry (up to 3 attempts)
- Each retry includes the specific validation errors as context for the AI
- Final attempt returns the best result even if some checks still report issues

### Fidelity Report
- Per-component JSON report with pass/fail status for each check
- Coverage percentages for layout and CSS fidelity
- Lists of missing elements or classes for debugging

---

## LLM Provider Options

| Provider | Model | Best For |
|----------|-------|----------|
| **Claude** | claude-sonnet-4-5 | Highest quality output |
| **OpenAI** | GPT-4o | Broad compatibility |
| **DeepSeek** | DeepSeek | Cost-effective generation |

Switch providers per conversion — no lock-in.

---

## CLI

### Quick Start
```
figma-to-code convert <figma-url> -f react,vue,svelte --llm claude -o ./output
```

### Options
| Flag | Description |
|------|-------------|
| `-f, --frameworks` | Target frameworks (comma-separated) |
| `-o, --output` | Output directory |
| `-n, --name` | Override component name |
| `--llm` | LLM provider (claude, openai, deepseek) |
| `--depth` | Figma tree traversal depth |
| `--template` | Wire into Next.js starter app |
| `--preview` | Set up live preview app |

### Web Server
```
figma-to-code serve
```
Starts the full web application at `localhost:3000`.

---

## Free Tier & Authentication

- **Free tier** — Up to 10 conversions without an account
- **GitHub OAuth** — Sign in to unlock unlimited conversions and server-side project persistence
- **Login prompt** — Appears when free tier is exhausted with clear upgrade path

---

## Real-Time Conversion Experience

The entire conversion process streams progress in real-time:

1. Fetching Figma design data
2. Extracting design tokens and layout
3. Detecting component type and routing pipeline
4. Exporting and deduplicating SVG assets
5. Generating deterministic CSS from Figma tokens
6. AI-powered component structure generation
7. Parsing and validating Mitosis output
8. Running accessibility and fidelity checks
9. Compiling to all target frameworks
10. Injecting CSS per framework convention

Each step is displayed live with progress indicators and retry attempt counts.

---

*Built by Nester Labs*
