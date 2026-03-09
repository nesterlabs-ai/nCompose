# Part 4 — Chart Pipeline (Pages with Graphs)

When a multi-section page (PATH C) contains a chart/graph section, the pipeline bypasses the regular LLM-to-Mitosis flow and generates a **Recharts** React component directly from the Figma node tree.

---

## Pipeline Flow

```
Figma Page (multi-section)
  │
  ▼  Section loop
  ┌──────────────────────────────────────────────┐
  │  isChartSection(node)?                       │
  │    ├─ YES → Chart Pipeline (below)           │
  │    └─ NO  → Regular LLM → Mitosis flow       │
  └──────────────────────────────────────────────┘

Chart Pipeline:

  ① DETECT ─── isChartSection(node)
                 Two-tier detection:
                   Tier 1: Node name contains chart|graph|plot|pie|donut|analytics
                   Tier 2: Has axis frames (x axis / y axis) + graph group with VECTORs

  ② EXTRACT ── extractChartMetadata(node, llm)
                 Walks raw Figma tree → extracts:
                   - dimensions, background color
                   - series color (from VECTOR stroke)
                   - x/y axis labels (from TEXT nodes)
                   - data point count (from LegendNode FRAMEs)
                   - series name (from Legends TEXT)
                   - period options (from switchers/tabs)
                 LLM decides chart type (line/area/bar/pie)
                   via buildNodeSummary() → compact tree text → LLM prompt

  ③ CODEGEN ── generateChartCode(metadata)
                 Produces:
                   - React JSX with recharts (LineChart/AreaChart/BarChart/PieChart)
                   - useState for period switcher
                   - Synthetic CHART_DATA from axis labels + y-range
                   - BEM-scoped CSS (colors, spacing from Figma)

  ④ STITCH ─── stitchPageComponent()
                 Chart section emits a placeholder:
                   <section class="page__chart-section">
                     <div class="chart-section-InterestEarnedChart" />
                   </section>
                 Other sections stitch normally via extractJSXBody()

  ⑤ INLINE ─── Step C6 in convert.ts (React only)
                 For each chart component:
                   - Replace placeholder div with <ChartName />
                   - Strip imports from chart code
                   - Merge recharts imports (deduplicated) at top
                   - Prepend chart function definition to page code
                   - Merge chart CSS into page CSS
                 Result: single self-contained .jsx file
```

---

## Key Files

| File | What it does |
|------|-------------|
| `src/figma/chart-detection.ts` | `isChartSection()` — detects chart nodes; `extractChartMetadata()` — walks Figma tree for colors, labels, axes; `detectChartTypeWithLLM()` — asks LLM to classify chart type |
| `src/compile/chart-codegen.ts` | `generateChartCode()` — produces React + Recharts JSX and BEM CSS from metadata |
| `src/compile/stitch.ts` | `stitchPageComponent()` — emits placeholder `<div>` for chart sections wrapped in semantic tag with layout class |
| `src/convert.ts` | PATH C section loop (line ~1302) — chart detection branch; Step C6 (line ~1449) — inlines chart code into main React output |

---

## How LLM Decides Chart Type

The pipeline sends a compact text summary of the Figma node tree to the LLM:

```
FRAME "chart" 350×321
  FRAME "Frame 249" 350×259
    FRAME "y axis" 18×209
      TEXT "120" fill=#A1A1A1
      TEXT "110" fill=#A1A1A1
      ...
    GROUP "graph 1" 353×103
      VECTOR "bg" fills=[GRADIENT_LINEAR]
      VECTOR "line" strokes=[SOLID #7C3AED]
    FRAME "x axis" 350×12
      TEXT "Jan" ... TEXT "Dec"
  FRAME "Legends"
    TEXT "Interest earned"
  INSTANCE "switchers"
    TEXT "Lifetime"  TEXT "Year-to-date"
```

LLM returns: `{ "chartType": "line" }`

Rules in the LLM prompt:
- VECTOR named "line" → always `line` chart
- "bg" with gradient fill is decorative, NOT an area indicator
- Only return `area` if the primary data series is explicitly named "area"

Falls back to structural heuristics if LLM call fails.

---

## Generated Output (single file)

```jsx
import { useState, useMemo } from 'react';
import { LineChart, Line, ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts';

const CHART_DATA = {
  "Lifetime": [
    { name: "Jan", value: 100 }, { name: "Feb", value: 107 }, ...
  ],
  "Year-to-date": [
    { name: "Jan", value: 107 }, { name: "Feb", value: 99 }, ...
  ]
};

function InterestEarnedChart() {
  const [view, setView] = useState('Year-to-date');
  const data = useMemo(() => CHART_DATA[view] ?? CHART_DATA['Year-to-date'], [view]);

  return (
    <figure className="interest-earned-chart">
      {/* legends, chart, period switcher */}
    </figure>
  );
}

// Main page component (from Mitosis compilation)
export default function HomeMainMobile(props) {
  return (
    <div className="home-main-mobile">
      {/* ...other sections... */}
      <section className="home-main-mobile__chart">
        <InterestEarnedChart />
      </section>
      {/* ...other sections... */}
    </div>
  );
}
```

Everything — imports, chart function, page component, CSS — lives in **one `.jsx` file**. No separate chart files are created.

---

## How We Get the Page Image from Figma

The pipeline uses the **Figma Images API** to get rendered screenshots of any node. This is the same API used for SVG icon export, but with `format=png`.

### API Endpoint

```
GET https://api.figma.com/v1/images/{file_key}?ids={node_id}&format=png&scale=2
```

### How it works in code

`FigmaClient.getImages()` in `src/figma/fetch.ts`:

```typescript
async getImages(
  fileKey: string,
  nodeIds: string[],        // e.g. ["0-1203"]
  format: 'png' | 'svg',   // 'png' for screenshots, 'svg' for icons
  scale: number = 2,        // 2x for retina quality
): Promise<Record<string, string | null>>
```

**Request:**
```
GET https://api.figma.com/v1/images/iXD0U4acUlOL5KCGN44LWf?ids=0-1203&format=png&scale=2
Headers: X-Figma-Token: <token>
```

**Response:**
```json
{
  "err": null,
  "images": {
    "0:1203": "https://figma-alpha-api.s3.us-west-2.amazonaws.com/images/4c165346-..."
  }
}
```

The response contains a temporary S3 URL for each requested node. Download the image from that URL (no auth needed — the URL itself is the credential, expires after a short time).

### Download step

```typescript
const imageUrls = await client.getImages(fileKey, [nodeId], 'png', 2);
const s3Url = imageUrls[nodeId.replace('-', ':')];  // API returns "0:1203" not "0-1203"
const response = await fetch(s3Url);
const buffer = await response.arrayBuffer();
// Save to disk or send to LLM as base64
```

### Current usage in the pipeline

| Use case | Format | Scale | Where |
|----------|--------|-------|-------|
| SVG icon export | `svg` | 1 | `src/figma/asset-export.ts` — `exportAssets()`, `exportAssetsFromAllVariants()` |
| Page/section screenshot | `png` | 2 | **Not yet used** — the LLM currently receives only the Figma JSON tree, not a visual screenshot |

### Key details

- **Node ID format**: Figma URLs use `node-id=0-1203` (hyphen), but the API returns `"0:1203"` (colon). Convert with `nodeId.replace('-', ':')`.
- **Scale**: `scale=2` gives 2x resolution (good for retina). Max is `scale=4`.
- **Batch**: You can request multiple node IDs in one call: `ids=0-1203,10-456`.
- **URL expiry**: The S3 URLs are temporary — download immediately, don't cache the URL.
- **Auth**: Only the initial API call needs the `X-Figma-Token` header. The S3 download URL is pre-signed (no auth).

---

## Why Not Mitosis?

Chart components use `useState` (for period switcher) and Recharts library components. Mitosis cannot handle:
- Third-party component imports (Recharts)
- Complex hooks beyond basic `useStore`

So chart sections bypass Mitosis entirely and generate raw React JSX directly.
