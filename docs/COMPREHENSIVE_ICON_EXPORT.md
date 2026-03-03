# Comprehensive Icon Export Implementation

**Date:** 2026-02-24
**Status:** ✅ Complete - Ready for Testing

## Overview

Implemented a comprehensive icon export system that:
1. ✅ Collects icons from **ALL variants** (not just default)
2. ✅ Deduplicates identical SVGs (same shape, different colors)
3. ✅ Tracks which variants each icon appears in
4. ✅ Provides intelligent LLM prompts for conditional rendering

## Key Changes

### 1. Enhanced Asset Export (`src/figma/asset-export.ts`)

**New Types:**
```typescript
export interface AssetEntry {
  // ... existing fields ...
  /** Variants where this icon appears */
  variants?: string[];
  /** If true, can be recolored via CSS */
  isColorVariant?: boolean;
  /** SVG path signature for deduplication */
  pathSignature?: string;
}

export interface IconCollectionContext {
  variantName: string;
  allNodes: Array<{...}>;
}
```

**New Functions:**

1. **`collectAssetNodesFromAllVariants()`**
   - Iterates through all variants in a component set
   - Collects icon nodes from each variant
   - Tracks which variant each icon came from

2. **`extractSVGPathSignature()`**
   - Extracts path data from SVG content (ignoring colors)
   - Creates signature for deduplication
   - Handles `<path>`, `<circle>`, `<rect>`, etc.

3. **`deduplicateSVGAssets()`**
   - Groups assets by path signature
   - Identifies identical shapes with different colors
   - Marks assets as `isColorVariant` if they can be recolored
   - Converts colors to `currentColor` for CSS control
   - Merges variant lists for deduplicated assets

4. **`exportAssetsFromAllVariants()`**
   - Main export function for comprehensive icon collection
   - Collects all unique nodes across variants
   - Downloads SVGs from Figma (scale=1)
   - Tracks variant appearances
   - Deduplicates based on path signature
   - Returns enhanced asset entries

5. **`buildEnhancedAssetMap()`**
   - Creates map of node ID → full AssetEntry
   - Used for accessing variant information

### 2. Updated Conversion Pipeline (`src/convert.ts`)

**Before:**
```typescript
// Only collected from default variant
const iconNodes = collectAssetNodes(componentSetData.defaultVariantNode);
const assets = await exportAssets(iconNodes, fileKey, client);
```

**After:**
```typescript
// Collect from ALL variants
const variantContexts = collectAssetNodesFromAllVariants(
  componentSetData.variants.map((v) => ({
    node: v.node,
    variantName: v.props ? Object.entries(v.props).map(([k, val]) => `${k}=${val}`).join('/') : 'default',
  }))
);

// Export with deduplication and variant tracking
const assets = await exportAssetsFromAllVariants(variantContexts, fileKey, client);
```

**Enhanced Logging:**
```
Exported 3 SVG asset(s) (with variant tracking): left-icon.svg, right-icon.svg, spinner.svg
  - left-icon.svg appears in 30/30 variants (recolorable via CSS)
  - right-icon.svg appears in 30/30 variants (recolorable via CSS)
  - spinner.svg appears in 9/30 variants
```

### 3. Enhanced Prompt Builder (`src/figma/variant-prompt-builder.ts`)

**New Section in User Prompt:**

```markdown
### Icon/Asset Conditional Rendering
Some icons only appear in specific variants or states:

**spinner** (spinner.svg):
  - Only appears in LOADING state
  - Use conditional rendering: {props.loading && <img src="./assets/spinner.svg" />}
  - Appears in 9/30 variants

**left icon** (left-icon.svg):
  - Appears in 30/30 variants
  - ✓ This SVG uses `currentColor` and can be recolored via CSS
```

## How It Works

### Example: ButtonDanger Component Set

#### Step 1: Collect Icons from All Variants
```
Scanning 30 variants:
  - subtle/default → finds: left-icon, right-icon
  - subtle/hover → finds: left-icon, right-icon
  - subtle/loading → finds: left-icon, right-icon, spinner
  - primary/default → finds: left-icon, right-icon
  - ...
```

#### Step 2: Build Variant Tracking
```
left-icon: [
  "subtle/default", "subtle/hover", "subtle/loading", ...
  "primary/default", "primary/hover", ...
]  // 30 variants

spinner: [
  "subtle/loading", "neutral/loading", "primary/loading", ...
]  // 9 variants (only loading states)
```

#### Step 3: Download and Deduplicate

**Download from Figma:**
```
left-icon from subtle/default → red color (#EC221F)
left-icon from primary/default → pink color (#FDE9E9)
left-icon from loading state → gray color (#A6A6A6)
```

**Path Signature Comparison:**
```
All three have identical path data:
"M7 10.3409L9.9925 12.1811C..."

✅ Deduplicate → Keep one SVG, replace colors with currentColor
```

**Result:**
```svg
<!-- left-icon.svg (deduplicated) -->
<svg width="14" height="14" ...>
  <path d="M7 10.3409..." stroke="currentColor" />
</svg>
```

#### Step 4: CSS Recoloring

CSS generation continues to work as before:
```css
.button-danger__left-icon {
  color: #EC221F;  /* Subtle variant */
}

.button-danger--primary .button-danger__left-icon {
  color: #FDE9E9;  /* Primary variant */
}

.button-danger--loading .button-danger__left-icon {
  color: #A6A6A6;  /* Loading state */
}
```

#### Step 5: LLM Prompt Enhancement

The LLM receives:
```markdown
### Icon/Asset Conditional Rendering

**spinner** (spinner.svg):
  - Only appears in LOADING state
  - Use conditional rendering: {props.loading && <img src="./assets/spinner.svg" />}

**left icon** (left-icon.svg):
  - ✓ This SVG uses `currentColor` and can be recolored via CSS
```

This guides the LLM to:
1. Render spinner only when `props.loading` is true
2. Use CSS colors for left-icon and right-icon (not different SVG files)

## Benefits

### 1. Finds All Unique Icons
- Example: Spinner icon only in loading state
- Example: Error icon only in error state
- No longer missing icons from non-default variants

### 2. Intelligent Deduplication
- Identical shapes → One SVG + CSS colors
- Different shapes → Separate SVG files
- Reduces file count while preserving uniqueness

### 3. Accurate Conditional Rendering
- LLM knows which icons appear when
- Generates proper `{props.loading && ...}` logic
- No more hardcoded assumptions

### 4. CSS Recoloring Where Possible
- Icons with same shape use `currentColor`
- CSS has full color control
- Fewer SVG files to manage

### 5. Explicit Where Necessary
- Icons with unique shapes kept separate
- No loss of design fidelity
- Clear documentation in prompt

## Code Generation Impact

### Before (Old Approach)
```jsx
// Always rendered, even if not in all variants
<div className="button__left-icon">
  <img src="./assets/left-icon.svg" alt="" />
</div>
```

### After (New Approach)
```jsx
// Conditional rendering based on variant tracking
{props.loading ? (
  <div className="button__spinner">
    <img src="./assets/spinner.svg" alt="" />
  </div>
) : (
  <div className="button__left-icon">
    <img src="./assets/left-icon.svg" alt="" />
  </div>
)}
```

## Testing

To test this implementation:

```bash
cd figma-to-mitosis

# Convert ButtonDanger component set
npm run dev -- convert "YOUR_FIGMA_URL" -f react --llm claude -o ./output

# Look for:
# 1. "Collecting icons from all variants..." message
# 2. "Exported N SVG asset(s) (with variant tracking)" message
# 3. Variant appearance counts in logs
# 4. Conditional rendering in generated code
```

Expected output:
```
✓ Collecting icons from all variants...
✓ Exporting and deduplicating SVG assets...
✓ Exported 3 SVG asset(s) (with variant tracking): left-icon.svg, right-icon.svg, spinner.svg
  - left-icon.svg appears in 30/30 variants (recolorable via CSS)
  - right-icon.svg appears in 30/30 variants (recolorable via CSS)
  - spinner.svg appears in 9/30 variants
```

## Files Modified

| File | Changes |
|------|---------|
| `src/figma/asset-export.ts` | Added: `IconCollectionContext`, `collectAssetNodesFromAllVariants()`, `extractSVGPathSignature()`, `deduplicateSVGAssets()`, `exportAssetsFromAllVariants()`, `buildEnhancedAssetMap()` |
| `src/convert.ts` | Changed asset collection to use `exportAssetsFromAllVariants()` instead of `exportAssets()` |
| `src/figma/variant-prompt-builder.ts` | Added `assets?: AssetEntry[]` to `VariantPromptData`, added "Icon/Asset Conditional Rendering" section to user prompt |

## Summary

This implementation addresses the user's request:

1. ✅ **"iterate through all components to gather all svgs"**
   - `collectAssetNodesFromAllVariants()` scans all variants
   - Finds icons that only appear in specific states (e.g., spinner in loading)

2. ✅ **"deduplicate svgs which are same and can be changed using css"**
   - `extractSVGPathSignature()` identifies identical shapes
   - `deduplicateSVGAssets()` merges color variants
   - Replaces colors with `currentColor` for CSS control

3. ✅ **"attach variants with components so that generated code understand"**
   - Each `AssetEntry` has `variants: string[]` tracking appearances
   - Prompt includes conditional rendering guidance
   - LLM receives variant-specific information

4. ✅ **"based on this do the rendering"**
   - Enhanced prompts guide LLM to generate conditional rendering
   - Icons that appear in all variants: always rendered
   - Icons that appear conditionally: `{props.state && <Icon>}`
   - CSS colors applied based on variant

The system is now much smarter about icon handling and will generate more accurate, efficient component code.
