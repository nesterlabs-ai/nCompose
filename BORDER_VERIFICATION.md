# Border Verification - Figma vs Generated CSS

## Summary

✅ **Border generation is CORRECT** - CSS accurately represents what's in Figma.

## Figma Data (from API)

### Variants WITH Borders (10/30)

**Focus Variants (6):**
- Subtle/Focus/Medium: `2px solid rgb(118, 132, 148)` OUTSIDE
- Subtle/Focus/Small: `2px solid rgb(118, 132, 148)` OUTSIDE
- Neutral/Focus/Medium: `2px solid rgb(118, 132, 148)` OUTSIDE
- Neutral/Focus/Small: `2px solid rgb(118, 132, 148)` OUTSIDE
- Primary/Focus/Medium: `2px solid rgb(118, 132, 148)` OUTSIDE
- Primary/Focus/Small: `2px solid rgb(118, 132, 148)` OUTSIDE

**Neutral Default Variants (2):**
- Neutral/Default/Medium: `1.5px solid rgba(255, 255, 255, 0.4)` INSIDE
- Neutral/Default/Small: `1.5px solid rgba(255, 255, 255, 0.4)` INSIDE

**Neutral Hover Variants (2):**
- Neutral/Hover/Medium: `1.5px solid rgba(255, 255, 255, 0.4)` INSIDE
- Neutral/Hover/Small: `1.5px solid rgba(255, 255, 255, 0.4)` INSIDE

### Variants WITHOUT Borders (20/30)

- All Subtle (except Focus): Default, Hover, Loading, Disabled
- All Primary (except Focus): Default, Hover, Loading, Disabled
- Neutral: Loading, Disabled

## Generated CSS

```css
/* Base neutral has border */
.button-danger--neutral {
  border: 1.5px solid rgba(255, 255, 255, 0.4);
}

/* Neutral hover inherits border from base */
.button-danger--neutral[data-hover] {
  box-shadow: 0px 4px 24px 0px rgba(0, 0, 0, 0.18);
  /* Border inherited from .button-danger--neutral ✅ */
}

/* Neutral loading explicitly removes border */
.button-danger--neutral.loading {
  border: unset;
}

/* Neutral disabled explicitly removes border */
.button-danger--neutral[disabled] {
  border: unset;
}

/* All focus variants get gray border */
.button-danger--subtle[data-focus] {
  border: 2px solid #768494;
}

.button-danger--neutral[data-focus] {
  border: 2px solid #768494;
  /* Overrides the white border from base ✅ */
}

.button-danger--primary[data-focus] {
  border: 2px solid #768494;
}
```

## CSS Cascade Analysis

### Neutral Default/Medium
Applied rules:
1. `.button-danger--neutral { border: 1.5px solid rgba(255, 255, 255, 0.4); }` ✅

**Result**: Has semi-transparent white border ✅

### Neutral Hover/Medium
Applied rules:
1. `.button-danger--neutral { border: 1.5px solid rgba(255, 255, 255, 0.4); }` (inherited)
2. `.button-danger--neutral[data-hover] { box-shadow: ...; }` (no border override)

**Result**: Has semi-transparent white border (inherited) ✅

### Neutral Focus/Medium
Applied rules:
1. `.button-danger--neutral { border: 1.5px solid rgba(255, 255, 255, 0.4); }` (base)
2. `.button-danger--neutral[data-focus] { border: 2px solid #768494; }` (override)

**Result**: Has gray border (overridden) ✅

### Neutral Loading/Medium
Applied rules:
1. `.button-danger--neutral { border: 1.5px solid rgba(255, 255, 255, 0.4); }` (base)
2. `.button-danger--neutral.loading { border: unset; }` (removes)

**Result**: No border ✅

### Neutral Disabled/Medium
Applied rules:
1. `.button-danger--neutral { border: 1.5px solid rgba(255, 255, 255, 0.4); }` (base)
2. `.button-danger--neutral[disabled] { border: unset; }` (removes)

**Result**: No border ✅

### Subtle Focus/Medium
Applied rules:
1. `.button-danger--subtle[data-focus] { border: 2px solid #768494; }` ✅

**Result**: Has gray border ✅

### Subtle Default/Hover/Loading/Disabled
Applied rules:
1. (no border rules)

**Result**: No border ✅

### Primary Focus/Medium
Applied rules:
1. `.button-danger--primary[data-focus] { border: 2px solid #768494; }` ✅

**Result**: Has gray border ✅

### Primary Default/Hover/Loading/Disabled
Applied rules:
1. (no border rules)

**Result**: No border ✅

## Conclusion

✅ **All borders are correctly represented**

The generated CSS accurately matches Figma's design:
- Neutral variants have a semi-transparent white border (40% opacity)
- Focus variants override with a solid gray border
- Loading and Disabled explicitly remove borders where needed
- CSS cascade properly handles inheritance and overrides

## Note on Visual Appearance

The semi-transparent white border on Neutral variants (`rgba(255, 255, 255, 0.4)`) may appear invisible or very subtle on white/light backgrounds. This is **correct per Figma** - the border exists but is designed to be subtle.

If the user doesn't want this border rendered, we could add smart border detection to skip borders where:
- Border color matches background within tolerance
- Border opacity is very low (< 50%)
- Border is effectively invisible

This would be a separate enhancement (see OPEN_ISSUES.md).
