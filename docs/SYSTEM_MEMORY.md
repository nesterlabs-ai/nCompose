# System Memory - Comprehensive Icon Export Implementation

**Last Updated:** 2026-02-24
**Status:** ✅ Production Ready

---

## Core System Purpose

Convert Figma COMPONENT_SET designs to production-ready React/Vue/Svelte/Angular/Solid components via Mitosis, with **comprehensive icon handling** that preserves all unique icons across all variant states.

---

## Critical Implementation Details

### 1. Icon Collection Strategy (ALL Variants)

**Problem Solved:** Original system only scanned default variant, missing icons that appear only in specific states (e.g., loading spinner).

**Solution:**
```typescript
// src/convert.ts:156-174
const rootNode = enhanced?.nodes?.[0];
const variantNodes = rootNode?.children || []; // All 30 variants

const variantContexts = collectAssetNodesFromAllVariants(
  variantNodes.map((variantNode: any) => ({
    node: variantNode,
    variantName: variantNode.name, // e.g., "Style=Subtle, State=Loading, Size=Medium"
  }))
);
```

**Key Insight:** Access variant nodes from `rootNode.children`, NOT from `componentSetData.variants` (which only has `{props, styles}`, no node data).

### 2. Position-Aware Icon Extraction

**Problem Solved:** Icons named generically ("Star", "Spinner") but need position context ("Left Icon", "Right Icon").

**Solution:**
```typescript
// src/figma/asset-export.ts:162-177
if (isAssetNode(node) && node.id) {
  // Extract actual icon name from first child (Star, Spinner)
  let iconName = node.name ?? 'vector';
  if (node.children && node.children.length > 0 && node.children[0].name) {
    iconName = node.children[0].name; // "Star" or "Spinner"
  }

  // Use parent frame name for position (Left Icon, Right Icon)
  const useParentName = parentName && !parentName.includes('=') ? parentName : undefined;

  result.push({
    id: node.id,
    name: iconName,        // Inner child: "Star" or "Spinner"
    parentName: useParentName, // Frame name: "Left Icon" or "Right Icon"
  });
}
```

**Structure in Figma:**
```
Variant: Style=Subtle, State=Loading, Size=Medium
  ├─ Left Icon (FRAME) ← parentName
  │   └─ Spinner (INSTANCE) ← iconName
  ├─ Button (TEXT)
  └─ Right Icon (FRAME) ← parentName
      └─ Spinner (INSTANCE) ← iconName
```

### 3. Smart Deduplication (Position + Content)

**Problem Solved:** Need to avoid duplicating identical icons BUT preserve position information.

**Solution:**
```typescript
// src/figma/asset-export.ts:575-618
// Group by: position (Left Icon, Right Icon) + SVG path signature
const groups = new Map<string, AssetEntry[]>();

for (const entry of entries) {
  const position = entry.parentName || 'icon';
  const contentSignature = extractSVGPathSignature(entry.content);
  const groupKey = `${position}::${contentSignature}`;

  if (!groups.has(groupKey)) {
    groups.set(groupKey, []);
  }
  groups.get(groupKey)!.push(entry);
}

// Generate filename: position-iconname.svg
const position = toKebabCase(canonical.parentName); // "left-icon"
const iconName = toKebabCase(canonical.nodeName);   // "spinner"
const filename = `${position}-${iconName}.svg`;     // "left-icon-spinner.svg"
```

**Result:**
- 60 icon instances → 4 unique files
- `left-icon-spinner.svg` (6 variants)
- `right-icon-spinner.svg` (6 variants)
- `left-icon-star.svg` (24 variants)
- `right-icon-star.svg` (24 variants)

### 4. Variant Tracking for Conditional Rendering

**Problem Solved:** LLM needs to know which icons appear in which states to generate correct conditional logic.

**Solution:**
```typescript
// Track which variants each icon appears in
const allVariants = new Set<string>();
for (const entry of group) {
  if (entry.variants) {
    entry.variants.forEach(v => allVariants.add(v));
  }
}
canonical.variants = Array.from(allVariants);

// Pass to LLM via buildVariantPromptData
const promptData = buildVariantPromptData(componentSetData, assetMap, assets);
```

**LLM Receives:**
```markdown
### Icon/Asset Conditional Rendering

**left-icon-spinner** (left-icon-spinner.svg):
  - Only appears in LOADING state
  - Use conditional rendering: {props.loading && <img src="./assets/left-icon-spinner.svg" />}
  - Appears in 6/30 variants

**left-icon-star** (left-icon-star.svg):
  - Appears in 24/30 variants (non-loading states)
  - This SVG uses `currentColor` and can be recolored via CSS
```

**Generated Code:**
```jsx
{props.loading ? (
  <img src="./assets/left-icon-spinner.svg" />
) : (
  <img src="./assets/left-icon-star.svg" />
)}
```

### 5. CSS Color Control

**Problem Solved:** Icons need variant-specific colors (red for subtle, pink for primary, gray for disabled).

**Solution:**
```typescript
// Replace hardcoded colors with currentColor
function makeColorInheritable(svgContent: string): string {
  result = result.replace(/stroke="[^"]*(?:#[0-9A-Fa-f]{3,8}|rgb[^"]*)"/g, 'stroke="currentColor"');
  result = result.replace(/fill="(?!none)[^"]*(?:#[0-9A-Fa-f]{3,8}|rgb[^"]*)"/g, 'fill="currentColor"');
  return result;
}
```

**CSS applies colors:**
```css
.button-danger__left-icon {
  color: #EC221F; /* Subtle default */
}

.button-danger--primary .button-danger__left-icon {
  color: #FDE9E9; /* Primary variant */
}

.button-danger__left-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
```

**SVG inherits color:**
```svg
<path d="M7 10.3409..." stroke="currentColor" stroke-width="1.31" />
```

---

## Data Flow Diagram

```
User provides Figma URL (COMPONENT_SET)
  ↓
Fetch from Figma API → 30 variant nodes
  ↓
For each variant node:
  - Traverse children to find icon frames (Left Icon, Right Icon)
  - Extract inner child name (Star, Spinner)
  - Track: nodeId, name, parentName, variantName
  ↓
Group 60 icon nodes by (position + SVG path content)
  → 4 unique groups
  ↓
Download SVGs from Figma (scale=1, 14×14)
  ↓
Replace colors with currentColor
  ↓
Generate filenames: left-icon-spinner.svg, right-icon-star.svg, etc.
  ↓
Build asset map: nodeId → "./assets/filename.svg"
  ↓
Build variant tracking: each asset knows which variants it appears in
  ↓
Pass to LLM with enhanced prompt:
  - Component structure
  - Variant axes
  - Icon conditional rendering guidance
  ↓
LLM generates .lite.tsx with:
  - Conditional rendering: {props.loading ? <Spinner/> : <Star/>}
  - Custom icon props: chooseLeftIcon, chooseRightIcon
  - Visibility props: showLeftIcon, showRightIcon
  ↓
Compile to React/Vue/Svelte/Angular/Solid
  ↓
Inject deterministic CSS with variant-specific icon colors
  ↓
Output: ComponentName.jsx + 4 SVG assets
```

---

## Key Files Modified

### src/convert.ts (Lines 156-185)
- Changed from `collectAssetNodes(defaultVariantNode)` to `collectAssetNodesFromAllVariants(allVariantNodes)`
- Access variant nodes from `rootNode.children` (actual Figma nodes)
- Added debug logging for icon collection

### src/figma/asset-export.ts
**Added:**
- `collectAssetNodesFromAllVariants()` — Scans all variants
- `exportAssetsFromAllVariants()` — Downloads and deduplicates by position + content
- `extractSVGPathSignature()` — Compares SVG shapes ignoring colors
- Inner child name extraction for icon identification

**Modified:**
- `collectAssetNodes()` — Extracts inner child name, skips variant names in parentName
- Icon grouping logic — Groups by (position + content signature)
- Filename generation — Uses position + icon name pattern

### src/figma/variant-prompt-builder.ts (Lines 397-437)
**Added:**
- `assets?: AssetEntry[]` to `VariantPromptData` interface
- "Icon/Asset Conditional Rendering" section in user prompt
- Automatic detection of loading-state-only icons
- Guidance for LLM on conditional rendering patterns

### src/figma/component-set-parser.ts
**Enhanced:**
- Vector color extraction from deep VECTOR children (Lines 576-628)
- RGB to hex conversion
- Icon container detection (small FRAMEs ≤32px with vector content)

---

## Testing & Validation

### Test Case: ButtonDanger Component

**Input:**
- Figma URL: `https://www.figma.com/design/rAim3nrWukuYQQRmYU1L8r/.../node-id=8119-29710`
- 30 variants (3 styles × 5 states × 2 sizes)

**Expected Output:**
- 4 SVG files: left-icon-spinner.svg, right-icon-spinner.svg, left-icon-star.svg, right-icon-star.svg
- Spinners appear only in loading states (6 variants)
- Stars appear in non-loading states (24 variants)
- Generated code has conditional rendering based on `props.loading`

**Actual Output:** ✅ All expectations met

**Command:**
```bash
npm run dev -- convert "FIGMA_URL" -f react --llm claude -o ./output
```

**Verification:**
```bash
# Check output
ls output/ButtonDanger-*/assets/
# Should show: left-icon-spinner.svg, right-icon-spinner.svg, left-icon-star.svg, right-icon-star.svg

# Check component
cat output/ButtonDanger-*/ButtonDanger.jsx | grep "loading"
# Should show conditional: {props.loading ? <img src="./assets/left-icon-spinner.svg" /> : ...}

# Preview
cp -r output/ButtonDanger-*/assets/* preview-app/public/assets/
cp output/ButtonDanger-*/ButtonDanger.jsx preview-app/src/components/
# Open http://localhost:5173/
```

---

## Performance Metrics

| Metric | Value | Impact |
|--------|-------|--------|
| Variants scanned | 30 | 100% coverage |
| Icon nodes found | 60 | Complete discovery |
| Unique files generated | 4 | 93% reduction (60→4) |
| File size (total) | 3.4 KB | Minimal overhead |
| Generation time | ~30s | Acceptable |
| API calls to Figma | 1 getFile + 1 getImages | Efficient |

---

## Common Issues & Solutions

### Issue 1: Icons missing from non-default variants
**Symptom:** Spinner not found in loading state
**Cause:** Only scanning default variant
**Solution:** Use `collectAssetNodesFromAllVariants()` with all variant nodes

### Issue 2: Wrong icon names (variant name in filename)
**Symptom:** Files named `style=subtle,-state=loading-left-icon.svg`
**Cause:** Variant name being passed as `parentName`
**Solution:** Filter out names containing `=` in parentName logic

### Issue 3: Position not preserved (left/right icons merged)
**Symptom:** Only 2 files instead of 4
**Cause:** Grouping only by content, ignoring position
**Solution:** Group by `${position}::${contentSignature}`

### Issue 4: Icon colors not variant-specific
**Symptom:** All icons same color
**Cause:** Colors not extracted from VECTOR children
**Solution:** Use `extractVectorColorRecursive()` to find colors in nested VECTOR nodes

---

## Design Decisions

### Why scan all variants?
Icons may only appear in specific states (e.g., loading spinner). Scanning only default variant misses these icons.

### Why group by position + content?
- **Position matters:** Left and right icons are different slots
- **Content matters:** Star and spinner are different shapes
- **Result:** 4 files instead of 60, but preserves all necessary variations

### Why not deduplicate by URL?
Figma returns different URLs for left and right icons even if they're the same shape. URL deduplication would incorrectly merge left/right positions.

### Why replace colors with currentColor?
Enables CSS-based color control for different variants (red/pink/gray) without needing separate SVG files for each color.

### Why track variants per asset?
Guides LLM to generate conditional rendering (loading vs non-loading), resulting in more accurate generated code.

---

## Future Improvements

1. **Animation Support:** Detect loading spinners and add CSS animations
2. **Icon Sets:** Detect common icon sets (Heroicons, Material, etc.) and use package imports instead of SVGs
3. **Color Variants:** For icons that truly need different colors (not just CSS recoloring), generate separate files
4. **Size Variants:** Support icons that change size between variants
5. **Smart Caching:** Cache downloaded SVGs across conversions to reduce API calls

---

## Debugging Tips

### Enable debug logging:
```bash
DEBUG_ASSETS=true npm run dev -- convert "FIGMA_URL" -f react -o ./output
```

### Check what icons were found:
```bash
# Look for these lines in output:
- Collecting icons from all variants...
-   Found 60 icon node(s) across 30 variant(s)
- Exported 4 SVG asset(s) (with variant tracking): ...
-   - left-icon-spinner.svg appears in 6/30 variants
```

### Verify icon structure in Figma:
```typescript
// Use test script to check Figma data
const data = await client.getFile(fileKey);
const variant = findNode(data.document, 'VARIANT_ID');
console.log(variant.children); // Should show Left Icon, Right Icon
console.log(variant.children[0].children); // Should show inner icon (Star, Spinner)
```

### Common debug points:
1. `src/convert.ts:166` — Variant nodes being passed to collection
2. `src/figma/asset-export.ts:162` — Icon node detection
3. `src/figma/asset-export.ts:590` — Grouping logic
4. `src/figma/asset-export.ts:613` — Filename generation

---

## Related Documentation

- `CLAUDE.md` — System architecture and development guide
- `COMPREHENSIVE_ICON_EXPORT.md` — Detailed implementation documentation
- `GENERATION_SUMMARY.md` — Latest generation results and examples
- `TEST_RESULTS.md` — Test outcomes and verification
- `ICON_SIZE_AND_COLOR_FIXES.md` — Historical fixes for icon issues

---

## Known Issues

### Icon Size Rendering ⚠️

**Issue:** Icons may render slightly smaller than their Figma frame size (e.g., 12.17×14 instead of 14×14).

**Root Cause:** SVG path content from Figma doesn't fill the entire viewBox. When browsers render with `object-fit: contain`, empty space in the viewBox is preserved.

**Current Status:** Documented in `OPEN_ISSUES.md`. Using SVGs as-is from Figma for now.

**Impact:** Minor visual inconsistency. Icons are functionally correct (right icon in right variant with right color), just slightly smaller than ideal.

**Future Solutions:** See `OPEN_ISSUES.md` for potential approaches (SVG normalization, vector path parsing, CSS-only solutions).

---

## Key Takeaways

1. ✅ **Always scan all variants** — Don't assume icons are in default variant
2. ✅ **Preserve position information** — Left/right matters for icon slots
3. ✅ **Extract inner child names** — Frame name is position, child name is icon type
4. ✅ **Group intelligently** — Position + content signature for deduplication
5. ✅ **Track variant appearances** — Enables conditional rendering in generated code
6. ✅ **Use currentColor** — Enables CSS-based color control
7. ✅ **Pass metadata to LLM** — Variant tracking improves code generation quality
