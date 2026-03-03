# Complete Border Analysis - ButtonDanger Component Set

## Summary

**Total variants:** 30
**Variants with borders:** 10
**Variants without borders:** 20

## Variants WITH Borders (10 total)

### Group 1: Focus State Variants (6 variants)
**Border:** `2px solid #768494` (gray, 100% opacity)

All Focus state variants have this border, regardless of style:
- Subtle/Focus/Medium
- Subtle/Focus/Small
- Neutral/Focus/Medium
- Neutral/Focus/Small
- Primary/Focus/Medium
- Primary/Focus/Small

**Figma API Data:**
```json
{
  "strokes": [{
    "type": "SOLID",
    "visible": true,
    "opacity": undefined,  // defaults to 1.0 (100%)
    "color": {
      "r": 0.463,
      "g": 0.518,
      "b": 0.580,
      "a": 1
    }
  }],
  "strokeWeight": 2
}
```

### Group 2: Neutral Style Variants (4 variants)
**Border:** `1.5px solid rgba(255, 255, 255, 0.4)` (white, 40% opacity)

All Neutral Default and Hover variants have this border:
- Neutral/Default/Medium
- Neutral/Default/Small
- Neutral/Hover/Medium
- Neutral/Hover/Small

**Figma API Data:**
```json
{
  "strokes": [{
    "type": "SOLID",
    "visible": true,
    "opacity": 0.4,  // 40% opacity
    "color": {
      "r": 1,
      "g": 1,
      "b": 1,
      "a": 1
    }
  }],
  "strokeWeight": 1.5
}
```

## Why Neutral Variants Have Borders

The Neutral Default and Hover variants **DO have borders in the Figma design**. This is confirmed by:

1. **Figma API explicitly shows:**
   - `strokes[0].visible: true` ✓
   - `strokes[0].opacity: 0.4` ✓
   - `strokeWeight: 1.5` ✓

2. **The border is white at 40% opacity**, making it:
   - Nearly invisible on white backgrounds
   - Subtle/hard to see in the Figma editor
   - But technically present in the design

3. **Our extraction is correct:**
   - We're correctly extracting this border
   - We're correctly calculating opacity (40%)
   - Generated CSS: `border: 1.5px solid rgba(255, 255, 255, 0.4)`

## Variants WITHOUT Borders (20 variants)

These variants have NO stroke data in the Figma API:

**Subtle Style (8 variants):**
- Subtle/Default/Medium & Small
- Subtle/Hover/Medium & Small
- Subtle/Loading/Medium & Small
- Subtle/Disabled/Medium & Small

**Neutral Style (2 variants - only Loading and Disabled):**
- Neutral/Loading/Medium & Small
- Neutral/Disabled/Medium & Small

**Primary Style (10 variants - all except Focus):**
- Primary/Default/Medium & Small
- Primary/Hover/Medium & Small
- Primary/Loading/Medium & Small
- Primary/Disabled/Medium & Small

## Pattern Summary

| Style | States with borders | States without borders |
|-------|-------------------|----------------------|
| **Subtle** | Focus only (2 variants) | Default, Hover, Loading, Disabled (8 variants) |
| **Neutral** | Focus, Default, Hover (6 variants) | Loading, Disabled (2 variants) |
| **Primary** | Focus only (2 variants) | Default, Hover, Loading, Disabled (8 variants) |

## Design Intent

The border strategy appears to be:

1. **All Focus states:** Get a visible gray border (`#768494`) for keyboard navigation indication
2. **Neutral style:** Has a subtle white border (40% opacity) for Default and Hover states to create visual separation on colored backgrounds
3. **Subtle and Primary styles:** Only show borders on Focus, no borders for other states

## Conclusion

**The code is working correctly.** The Neutral Default and Hover variants genuinely have borders in the Figma design file - they're just very subtle (white at 40% opacity).

If these borders should NOT appear in the generated component, the design needs to be updated in Figma to remove them (set `visible: false` or remove the stroke layer entirely).

Alternatively, we could add smart filtering to skip borders where:
- Color is very close to common background colors (white, transparent)
- Opacity is very low (< 50%)
- Both conditions combined

But this would be guessing at design intent rather than faithfully extracting what's in the Figma file.
