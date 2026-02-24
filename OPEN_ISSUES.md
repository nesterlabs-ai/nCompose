# Open Issues

## 1. Icon Color Not Matching Across Variants

**Status**: 🔴 Open
**Priority**: High
**Date Reported**: 2026-02-24

### Problem

Icons have incorrect colors in some variants. We extract icon color from the default variant only, but different variants may have different color variable bindings.

### Root Cause

Icon strokes use Figma color variables (`boundVariables.color`). We currently:
1. Extract icon color from default variant only
2. Apply that color to ALL variants via CSS

But different variants bind to different color variables:
- Default: `#EC221F` (red)
- Loading: `#A6A6A6` (gray)
- Disabled: `#A6A6A6` (gray)
- Primary: `#FDE9E9` (light pink)

### Solution

Extract icon colors per variant by:
1. Checking `boundVariables.color` for each variant's icon nodes
2. Resolving variable IDs to actual color values
3. Generating variant-specific CSS: `.button--loading .button__icon { color: #A6A6A6; }`

### Related Files

- `src/figma/component-set-parser.ts` - extractVectorColorRecursive()
- `src/figma/asset-export.ts` - Icon extraction
- `ISSUE_ANALYSIS.md` - Detailed investigation

---

## 2. Invisible Borders Being Rendered

**Status**: 🔴 Open
**Priority**: Medium
**Date Reported**: 2026-02-24

### Problem

Some variants show borders in generated CSS that aren't visible in Figma. Example:
- Neutral variant has `border: 1.5px solid #FFFFFF` (white border on white background)
- Focus states have gray borders that may not be expected

### Root Cause

Figma data includes strokes that are visually invisible:
```javascript
strokes: [{
  color: { r: 1, g: 1, b: 1 },  // WHITE
  opacity: 0.4,  // 40% opacity
}]
background: #FFFFFF  // WHITE
```

We extract strokes literally without considering:
- Visual invisibility (same color as background)
- Low opacity making them effectively invisible
- User expectations vs Figma data

### Solution

Add smart border detection:
```typescript
function shouldIncludeBorder(stroke, backgroundColor): boolean {
  // Skip if color matches background (within tolerance)
  if (colorsMatch(stroke.color, backgroundColor, tolerance: 10)) {
    return false;
  }

  // Skip if opacity < 50%
  if (stroke.opacity && stroke.opacity < 0.5) {
    return false;
  }

  return true;
}
```

### Related Files

- `src/figma/component-set-parser.ts:718-721` - Border extraction
- `src/figma/component-set-parser.ts:805-825` - extractStrokesFromNode()
- `ISSUE_ANALYSIS.md` - Investigation results

---

## 3. Icon Size Rendering Issue

**Status**: 🔴 Open
**Priority**: High
**Date Reported**: 2026-02-24

### Problem

Icons are rendering at incorrect sizes (e.g., 12.17×14 instead of 14×14) even though:
- Figma frame is 14×14 ✅
- SVG width/height attributes are 14×14 ✅
- CSS container is 14×14 ✅
- CSS uses `object-fit: contain` ✅

### Root Cause

SVG path content doesn't fill the entire viewBox. When Figma exports SVGs, the path coordinates use the actual shape bounds, not the frame bounds.

**Example:**
- Figma frame: 14×14
- Actual star path bounds: 1.31 to 12.69 (width: 11.39)
- ViewBox from Figma: "0 0 14 14"
- Browser renders path at natural size: 11.39px wide
- With `object-fit: contain` in 14×14 container: renders at ~12.17×14 (aspect ratio preserved)

### Attempted Solutions

1. **Adjust viewBox to path bounds** ❌
   - Result: Different icons had different viewBox sizes
   - Caused inconsistent rendering across variants

2. **Square viewBox** ❌
   - Made viewBox square by using max(width, height)
   - Still had empty space, didn't solve the core issue

3. **Hardcoded "0 0 14 14" with path transforms** ❌
   - **WRONG APPROACH**: Hardcoded 14×14 is specific to ButtonDanger
   - Different components have different icon frame sizes
   - Not scalable or maintainable

### Fundamental Issue

The current approach tries to adjust the SVG after download, but the real issue is:
- We need the path to fill the viewBox that matches the Figma frame
- Figma's getImages() API returns SVGs with correct frame size but paths at actual bounds
- Browser rendering with `object-fit: contain` preserves empty space in the viewBox

### Possible Solutions to Explore

1. **Use Figma's vector networks directly**
   - Parse vector data from Figma API (not getImages)
   - Calculate proper viewBox from actual path bounds
   - Set viewBox to match path bounds (no empty space)
   - Keep width/height at Figma frame size

2. **SVG optimization/normalization**
   - Use SVG optimization library (SVGO)
   - Remove empty space from viewBox
   - Normalize coordinates to fill frame

3. **CSS-only solution**
   - Remove `object-fit: contain`
   - Use different CSS to stretch icon to fill container
   - May distort aspect ratio (not ideal)

4. **Use background-image instead of img tag**
   - CSS `background-size: contain` behaves differently
   - May give better control over sizing

### What's Currently Working

✅ Icon collection from all variants
✅ Position-aware deduplication (left/right)
✅ Variant tracking (spinner in loading, star in others)
✅ Color extraction and CSS control
✅ Conditional rendering in generated code

### Temporary Workaround

For now, revert to basic SVG export without viewBox manipulation:
- Download SVGs from Figma as-is
- Accept that icons may render slightly smaller than frame
- Focus on functionality (correct icons in correct variants with correct colors)

### To Investigate Later

- How does Builder.io Figma plugin handle this?
- How does Anima, Locofy, or other Figma-to-code tools handle icon sizing?
- Can we use Figma's vector path data directly instead of exported SVGs?
- Can we request specific export settings from getImages() to get "fitted" viewBoxes?

### Related Files

- `src/figma/asset-export.ts` - Icon export logic (line 771 has hardcoded viewBox)
- `src/figma/asset-export.ts:adjustViewBoxToPathBounds()` - Attempted fix function
- `SYSTEM_MEMORY.md` - Documentation of icon export system

---

## Notes

This is a complex problem that requires more research into:
1. SVG rendering behavior in browsers
2. Figma's vector export API options
3. Industry best practices for Figma-to-code icon handling

Not blocking core functionality - icons work correctly (right icon in right variant with right color), just slightly smaller than ideal.
