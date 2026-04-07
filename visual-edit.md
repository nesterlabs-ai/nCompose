Visual Edit Fix Report — Variant-Scoped Edits for Component Sets


Problem
When a user performs a visual edit on ONE variant of a component set (e.g., change text of Subtle/Default/Medium from "Button" to "cta"), the change was applying to ALL 30 variants instead of just the selected one.

Root causes found (3 issues):
Issue 1: No variant specs saved after converting a Figma component, we saved the variant names (Primary, Subtle, etc.) but not their actual look (colors, text, borders). So when a user edited one variant, the system didn't know what the other variants   looked like — couldn't tell the LLM "keep  these unchanged."

Issue 2: Client forgot to tell server which variant was clicked. The UI knew which variant the user clicked (e.g., Subtle/Default/Medium). But when sending the edit request to the server, i accidentally dropped that info. So the server treated every edit as "change all variants."

 Issue 3: LLM was editing the wrong file the component has two files — a wrapper (handles text) and a sub-component (handles styles/colors). The system always sent only the sub-component to the LLM. So for text changes, the LLM couldn't scope it to one variant because text is shared as {children} in that file. We now send both files so the LLM edits the right one depending on the change type.


Solution
Fix 1: variant-spec.json generation
Created a variant-spec.json file that stores every variant's complete visual specification.

Files: src/types/index.ts, src/figma/component-set-parser.ts, src/convert.ts, src/output.ts

Added computeVariantSpec() function that auto-detects base (shared) vs per-variant properties by comparing all variants from Figma
Generates a flatVariants section with complete resolved spec per variant:

"subtle|default|medium": {

  "props": { "Style": "Subtle", "State": "Default", "Size": "Medium" },

  "container": { "background": "transparent" },

  "text": { "color": "#EC221F" },

  "textContent": { "Label": "Button" }

}

Written to disk alongside meta.json during conversion
Fix 2: Client sends variant info in visual edit payload
File: src/web/public/app.js

Added variantLabel and variantProps to the visual edit payload:

editsPayload[veId] = {

  changes: item.changes,

  tagName: item.tagName,

  textContent: (item.textContent || '').substring(0, 80),

  variantLabel: item.variantLabel || null,    // NEW

  variantProps: item.variantProps || null,     // NEW

};
Fix 3: Variant-aware prompt construction
File: src/web/server.ts

buildVisualEditSavePrompt() now includes variant scoping when variantProps is present
For text changes: instructs LLM to use conditional rendering {variant === "x" ? "new" : children}
For style changes: instructs LLM to modify ONLY the matching compoundVariant entry
Fix 4: Send both files for variant-scoped edits
File: src/web/server.ts

For variant-scoped edits on shadcn components, server now sends BOTH wrapper + sub-component:

Text changes → LLM edits the wrapper (has access to variant/state/size props)
Style changes → LLM edits the sub-component (has CVA compound variants)
Fix 5: Variant spec context in refine prompt
File: src/web/refine.ts

When variant-scoped edit is detected, the LLM receives:

Selected variant's full blueprint (styles + text content)
Other variants' specs marked as "DO NOT change"
Files Changed
File
Change
src/types/index.ts
Added VariantSpec, FlatVariantSpec types
src/figma/component-set-parser.ts
Added computeVariantSpec() with base + axis diffs + flatVariants
src/convert.ts
Calls computeVariantSpec(), attaches to result (both standard + shadcn paths)
src/output.ts
Writes variant-spec.json to disk
src/web/server.ts
Variant-aware prompt, sends both files for variant edits, loads spec from disk
src/web/refine.ts
Injects variant blueprint context into LLM prompt
src/web/public/app.js
Includes variantLabel/variantProps in visual edit payload

How it works now
User clicks Subtle/Default/Medium → changes text to "cta"

  → Client sends { variantLabel: "Subtle/Default/Medium", variantProps: {...} }

  → Server reads variant-spec.json — knows each variant's current spec

  → Server sends BOTH files + variant context to LLM

  → LLM adds conditional: {variant === "subtle" && state === "default" ? "cta" : children}

  → Only Subtle/Default/Medium shows "cta"

  → All other variants unchanged

