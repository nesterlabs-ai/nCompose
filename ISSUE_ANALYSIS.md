# Issue Analysis - 2026-02-24

## User Reported Issues

1. Icon color not matching
2. Some variants have borders but shouldn't (per Figma)
3. Text color of subtle/small/hover and subtle/medium/hover not matching

## Investigation Results

### Issue 1: Icon Colors

**Finding**: Icons are using variable references that may not be resolved correctly across all variants.

**Evidence**:
- Default icon stroke uses `boundVariables.color` with variable ID `VariableID:4ed7ed5e5cc8f0845f999f4b7b67803b3bc91521/6203:481`
- Current color extracted: #EC221F (red) - which is correct for default
- BUT we're not checking if different variants bind to different color variables
- We extract icon color from the default variant only, then apply it to ALL states

**Root Cause**: Icons in different states (hover, loading, disabled) may have different bound color variables, but we only extract from default and apply universally.

**Example**:
```
Default icon: Variable → #EC221F (red)
Hover icon: Variable → might be different color
Loading icon: Variable → #A6A6A6 (gray)
```

We need to check bound variables for EACH variant, not just default.

### Issue 2: Borders Appearing Incorrectly

**Finding**: Neutral variant HAS a stroke in Figma, but it's visually invisible.

**Evidence from Figma**:
```javascript
Neutral/Default/Medium:
  strokes: [{
    type: 'SOLID',
    visible: true,
    opacity: 0.4,  // 40% opacity
    color: { r: 1, g: 1, b: 1 },  // WHITE
    blendMode: 'NORMAL'
  }]
  strokeWeight: 1.5
  strokeAlign: INSIDE
```

**Generated CSS**:
```css
.button-danger--neutral {
  background-color: #FFFFFF;
  border: 1.5px solid #FFFFFF;  /* WHITE border on WHITE background = invisible */
}
```

**Problem**: The white border at 40% opacity on a white background is effectively invisible in Figma, so users don't see it as a "border". But our code generation extracts it literally.

**Similar issue with Focus states**:
- Focus states have `border: 2px solid #768494` (gray)
- This IS in Figma but may not be what users expect in the generated output

**Options**:
1. Skip strokes where color matches background (within tolerance)
2. Skip very low opacity strokes (< 50%?)
3. Let users configure which strokes to include/exclude

### Issue 3: Text Color Mismatch (Hover Variants)

**Finding**: Text colors ARE the same in Figma for both variants!

**Evidence**:
```
Subtle/Small/Hover text color: rgb(236, 34, 31) = #EC221F
Subtle/Medium/Hover text color: rgb(236, 34, 31) = #EC221F
```

Both use the SAME color variable:
```javascript
boundVariables: {
  color: {
    type: "VARIABLE_ALIAS",
    id: "VariableID:ff479d851960df1bb88a5f44e5003af5c2cdc590/6203:542"
  }
}
```

**Parsed variant styles show**:
```
Subtle/Hover/Medium:
  Container CSS: { ... }
  Text color: undefined
Subtle/Hover/Small:
  Container CSS: { ... }
  Text color: undefined
```

**Root Cause**: Text colors aren't being extracted into variant.styles at all (showing as `undefined`). The CSS generation must be using a different mechanism to determine text colors.

## Summary of Root Causes

1. **Icon Colors**: Only extracting from default variant, not checking bound variables per variant
2. **Borders**: Extracting strokes literally without considering:
   - Visual invisibility (e.g., white on white)
   - Opacity making them effectively invisible
   - User expectations vs Figma data
3. **Text Colors**: Extraction issue - colors not being added to variant.styles object

## Recommended Fixes

### Fix 1: Icon Color Extraction Per Variant

Modify icon color extraction to check bound variables for each variant state:
- Check if icon strokes have `boundVariables.color`
- Resolve variable ID to actual color value per variant
- Generate variant-specific CSS for icon colors

### Fix 2: Smart Border Detection

Add logic to skip invisible borders:
```typescript
function shouldIncludeBorder(stroke: any, backgroundColor: string): boolean {
  // Skip if color matches background
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

### Fix 3: Text Color Extraction

Fix the variant styles extraction to properly capture text colors from child nodes:
- Check Button/Label child node fills
- Resolve bound color variables
- Add to variant.styles.children[childKey].color

## Test Cases Needed

1. Generate component and verify icon colors per variant
2. Check that invisible borders (white on white) are not rendered
3. Verify text colors match between Small/Hover and Medium/Hover variants
