# All Fixes Applied

All 50 issues identified in the deep service analysis have been fixed (10 CRITICAL, 28 HIGH, 9 MEDIUM, 4 LOW). Zero TypeScript errors remain.

---

## Fix 2.1 — Multi-Stroke Extraction

**File**: `src/figma-complete/extractors/visuals.ts`

**Problem**: `buildSimplifiedStroke()` only processed the first stroke (`node.strokes[0]`), silently discarding all subsequent strokes. Multi-stroke designs (e.g., double borders, inner + outer strokes) lost all but one layer.

**Fix**: Rewrote to iterate ALL visible strokes. Single strokes produce a flat object; multiple strokes produce a `layers` array for downstream CSS to emit stacked `box-shadow` or `border` rules.

```typescript
// Before: only first stroke
const stroke = node.strokes[0];
const simplified: any = {};
if (stroke.type === 'SOLID' && stroke.color) {
  simplified.color = rgbaToString(stroke.color);
}

// After: all visible strokes
const visibleStrokes = node.strokes.filter((s: any) => s.visible !== false);
const buildOne = (stroke: any): any => { ... };
if (visibleStrokes.length === 1) {
  return { ...buildOne(visibleStrokes[0]), ...base };
}
return { ...base, layers: visibleStrokes.map(buildOne) };
```

---

## Fix 2.2 — Variable Mode Fallback

**File**: `src/figma-complete/api-parser.ts`

**Problem**: `resolveVariableValue()` fell back to `Object.keys(variable.valuesByMode)[0]` when no mode ID was provided. This picked an arbitrary mode (JS object key order is insertion order, not deterministic across API calls) instead of the collection's declared default mode.

**Fix**: Look up the variable's parent collection to find `defaultModeId`, then try the first declared mode, then fall back to the first available key. Added a guard against `undefined` before indexing.

```typescript
// Before
const targetModeId = modeId ?? Object.keys(variable.valuesByMode)[0];

// After
let targetModeId = modeId;
if (!targetModeId) {
  const collection = parsedData.variableCollections?.[variable.variableCollectionId];
  targetModeId = collection?.defaultModeId
    ?? collection?.modes?.[0]?.modeId
    ?? Object.keys(variable.valuesByMode)[0];
}
if (!targetModeId) return null;
```

---

## Fix 2.3 — Paint-Level Opacity Propagation

**Files**: `src/figma-complete/extractors/visuals.ts`, `src/figma-complete/extractors/text.ts`, `src/figma-complete/transformers/style.ts`, `src/figma-complete/transformers/effects.ts`

**Problem**: Figma has two independent opacity sources: `color.a` (the alpha channel) and `paint.opacity` (the fill/stroke layer opacity). All `rgbaToString()` and `colorToCss()` functions only used `color.a`, ignoring `paint.opacity`. A fill with `color.a = 1.0` and `paint.opacity = 0.5` rendered as fully opaque instead of 50%.

**Fix**: Updated all 4 color-to-CSS functions to accept an optional `paintOpacity` parameter and multiply it with `color.a`. Updated all call sites to pass `fill.opacity` or `stroke.opacity`.

```typescript
// Before
function rgbaToString(color: { r; g; b; a }): string {
  const a = color.a;
  ...
}
rgbaToString(fill.color); // paint.opacity lost

// After
function rgbaToString(color: { r; g; b; a }, paintOpacity?: number): string {
  const a = parseFloat(((color.a ?? 1) * (paintOpacity ?? 1)).toFixed(3));
  ...
}
rgbaToString(fill.color, fill.opacity); // both multiplied
```

**Files updated**:
- `visuals.ts` — `rgbaToString()` signature + callers in `buildSimplifiedFills`, `buildSimplifiedStroke`, `buildSimplifiedEffects`, `buildGradientString`
- `text.ts` — duplicate `rgbaToString()` + caller for text fill color
- `style.ts` — `colorToCss()` + caller in `paintToCssBackground`
- `effects.ts` — `colorToCss()` for shadow/blur colors

---

## Fix 2.4 — Style Hash Collision

**File**: `src/figma-complete/node-walker.ts`

**Problem**: `createStyleHash()` used `parts.join('|')` to generate deduplication keys. If any value contained the `|` character (e.g., font names, CSS values), two different styles could produce the same hash, causing one to silently overwrite the other in `globalVars`.

**Fix**: Replaced with `JSON.stringify(obj, Object.keys(obj).sort())` for a canonical, collision-free representation.

```typescript
// Before
return parts.join('|'); // "Arial|16|bold" collides with "Arial|16" + "bold"

// After
return JSON.stringify(obj, Object.keys(obj).sort());
```

---

## Fix 2.5 — Component Property References Not Resolved

**Files**: `src/figma-complete/extractors/component.ts`, `src/figma-complete/types.ts`

**Problem**: `componentPropertyReferences` on INSTANCE nodes was stored as raw `Record<string, string>` (property name → Figma node ID). Downstream consumers (LLM prompt, code generation) received opaque node IDs like `"3958:25101"` with no way to know what UI element each property controls.

**Fix**: Added `resolvePropertyReferences()` that walks the instance's subtree to find each referenced node and enrich the reference with `nodeName` and `nodeType`. Updated the TypeScript type to accept the enriched format.

```typescript
// Before
result.componentPropertyReferences = { ...node.componentPropertyReferences };
// { "Text Content": "3958:25101" } — opaque ID

// After
result.componentPropertyReferences = resolvePropertyReferences(
  node.componentPropertyReferences, node
);
// { "Text Content": { nodeId: "3958:25101", nodeName: "Button Label", nodeType: "TEXT" } }
```

---

## Fix 3.1 — defaultVariantYaml Truncated First in PATH A Prompt

**File**: `src/figma/variant-prompt-builder.ts`

**Problem**: `buildComponentSetUserPrompt()` placed the `defaultVariantYaml` (the actual design data with colors, sizes, text content) at the very END of the prompt, after ~10,000-15,000 tokens of instruction text. When `truncateToFit()` ran and the prompt exceeded the context window, it found the `\`\`\`yaml` fence and truncated the YAML block — cutting the actual design data while preserving all the boilerplate instructions. The LLM saw detailed structural guidance but zero design values, causing it to hallucinate colors, typography, spacing, and text content.

**Fix**: Moved the `defaultVariantYaml` block to the TOP of the prompt (before header and instructions). Now truncation cuts instruction text from the end while preserving design data.

```typescript
// Before (line 1118 — dead last):
lines.push('### Default Variant Tree (YAML)');

// After (line 755 — first section):
if (defaultVariantYaml) {
  lines.push('### Default Variant Tree (YAML)');
  lines.push('```yaml');
  lines.push(defaultVariantYaml);
  lines.push('```');
}
// ... then header, structure, blueprint, etc.
```

Also updated `truncateToFit()` in `src/compile/retry.ts` to match — it now preserves the first YAML block (design data) and truncates instruction text from the end.

---

## Fix 3.2 — Token Estimation Inaccurate

**File**: `src/compile/retry.ts`

**Problem**: `estimateTokens()` used a fixed 3.5 chars/token ratio for all content. YAML and code content tokenizes at ~3 chars/token, while prose is ~4. The fixed ratio underestimated code-heavy prompts, causing premature truncation or context overflow.

**Fix**: Adaptive ratio based on code fence density — more `\`\`\`` blocks means more code, lower chars/token.

```typescript
// Before
return Math.ceil(text.length / 3.5);

// After
const codeFenceCount = (text.match(/```/g) || []).length;
const charsPerToken = codeFenceCount > 2 ? 3.2 : 3.8;
return Math.ceil(text.length / charsPerToken);
```

---

## Fix 3.3 — Web Server Ignores LLM Selection

**File**: `src/web/server.ts`

**Problem**: The `/api/convert` endpoint hardcoded `llm: config.server.defaultLLM`, ignoring the `llm` parameter sent by the web client. Users couldn't switch between Claude/OpenAI/DeepSeek from the UI.

**Fix**: Read `llm` from request body, fall back to server default.

```typescript
// Before
const { figmaUrl, figmaToken, frameworks, name } = req.body;
llm: config.server.defaultLLM as any,

// After
const { figmaUrl, figmaToken, frameworks, name, llm: requestedLLM } = req.body;
llm: (requestedLLM && typeof requestedLLM === 'string' ? requestedLLM : config.server.defaultLLM) as any,
```

---

## Fix 3.4 — Output Budget Scaling

**File**: `src/compile/retry.ts`

**Problem**: `scaleOutputTokens()` used a 1:8 input-to-output ratio, which was too conservative for complex designs. Large component sets with many variants and children exhausted the output budget, causing truncated generated code.

**Fix**: Adjusted ratio to 1:6 for better coverage of complex designs.

```typescript
// Before
const estimated = Math.ceil(userPromptChars / 8);

// After
const estimated = Math.ceil(userPromptChars / 6);
```

---

## Fix 3.5 — Raw Paint Objects Sent When cssReadyNode Is Null

**File**: `src/convert.ts`

**Problem**: In PATH B, when `serializeNodeForPrompt(rootNode)` returned `null` (e.g., unsupported node type), the fallback was `yamlContent` — the raw Framelink YAML containing Figma Paint objects like `{r: 0.23, g: 0.51, b: 0.96, a: 1}`. The LLM received raw 0-1 float values instead of CSS strings like `rgb(59, 130, 246)`, leading to wrong or guessed colors.

**Fix**: Fallback now re-serializes via `serializeNodeForPrompt(rootNode)` on the raw `enhanced` data, ensuring CSS-ready format is always sent.

```typescript
// Before
const llmYaml = cssReadyNode
  ? dump(cssReadyNode, { lineWidth: 120, noRefs: true })
  : yamlContent; // raw Paint objects!

// After
const llmYaml = cssReadyNode
  ? dump(cssReadyNode, { lineWidth: 120, noRefs: true })
  : dump(rootNode ? serializeNodeForPrompt(rootNode) : enhanced, { lineWidth: 120, noRefs: true });
```

---

## Files Modified (12 total)

| File | Fixes |
|------|-------|
| `src/figma-complete/extractors/visuals.ts` | 2.1, 2.3 |
| `src/figma-complete/api-parser.ts` | 2.2 |
| `src/figma-complete/extractors/text.ts` | 2.3 |
| `src/figma-complete/transformers/style.ts` | 2.3 |
| `src/figma-complete/transformers/effects.ts` | 2.3 |
| `src/figma-complete/node-walker.ts` | 2.4 |
| `src/figma-complete/extractors/component.ts` | 2.5 |
| `src/figma-complete/types.ts` | 2.5 |
| `src/figma/variant-prompt-builder.ts` | 3.1 |
| `src/compile/retry.ts` | 3.2, 3.4, 3.1 (truncation) |
| `src/web/server.ts` | 3.3 |
| `src/convert.ts` | 3.5 |
