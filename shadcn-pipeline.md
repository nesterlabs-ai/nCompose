Pipeline Flow — PATH A, PATH B, PATH C



Executive Summary 



Requirements



High Level Design



Exiting Flow



New Flow



Added Flow

Pipeline Flow — PATH A, PATH B, PATH C



Routing (in convertFigmaToCode() — src/convert.ts)
Figma Node
  ├─ type === COMPONENT_SET?        → PATH A
  ├─ isMultiSectionPage()?          → PATH C
  └─ otherwise (single node)       → PATH B

Each path has two modes:
templateMode OFF → Mitosis pipeline → outputs React, Vue, Svelte, Angular, Solid
templateMode ON → shadcn/React direct → outputs React only

PATH A — COMPONENT_SET (variant-aware)
Trigger: Root Figma node is a COMPONENT_SET (group of variants like Primary/Secondary × Default/Hover/Disabled)
Function: convertComponentSet() in src/convert.ts

templateMode OFF
COMPONENT_SET node
  → parseComponentSet()                         extract axes, states, CSS tokens
  → collectAssetNodesFromAllVariants()           scan ALL variants for icons
  → exportAssetsFromAllVariants()                download SVGs, deduplicate by position+content
  → buildAssetMap() + buildDimensionMap()
  → buildVariantCSS()                            deterministic BEM CSS (no LLM)
  → buildVariantPromptData()                     derive props + icon-variant relationships
  → extractDefaultVariantYaml()                  serialize default variant to YAML
  → buildComponentSetSystemPrompt()              ← src/figma/variant-prompt-builder.ts
  → buildComponentSetUserPrompt()                ← src/figma/variant-prompt-builder.ts
  → generateWithRetry(llm)                       LLM generates class-based .lite.tsx
  → generateFrameworkCode()                      Mitosis compiles to 5 frameworks
  → injectCSS()                                  inject deterministic CSS per framework

Output: .lite.tsx + per-framework files. Uses class={state.classes} pattern.

templateMode ON (shadcn)
COMPONENT_SET node
  → parseComponentSet()                          same initial parsing
  → collectAssetNodesFromAllVariants()            same asset collection
  → isShadcnSupported(category)?
    ├─ YES → generateShadcnComponentSet()         ← src/shadcn/shadcn-codegen.ts
    │         → getShadcnComponentType()           map category → shadcn type (e.g. "button")
    │         → readShadcnSource()                 read base .tsx from starter template
    │         → extractVariantStyles()             ← src/shadcn/style-extractor.ts
    │         → extractComponentContent()          ← src/shadcn/content-extractor.ts
    │         → buildShadcnSystemPrompt()          ← src/shadcn/shadcn-prompt-builder.ts
    │         → buildShadcnUserPrompt()            ← src/shadcn/shadcn-prompt-builder.ts
    │         → LLM generates TWO code blocks:
    │           1. Updated shadcn .tsx (with CVA variants)
    │           2. Consumer .jsx (imports from @/components/ui/xxx)
    │         → parseTwoCodeBlocks()
    │
    └─ NO or FAIL → falls back to templateMode OFF pipeline above

Output: {shadcnType}.tsx (updated template with CVA variants) + {ComponentName}.jsx (consumer). React only.

PATH B — Single Component
Trigger: Not a COMPONENT_SET, not a multi-section page. Any single Figma node.
Function: convertSingleComponent() in src/convert.ts

templateMode OFF
Single Figma node
  → collectAssetNodes() + exportAssets()          find and export SVG icons
  → buildSemanticHint()                           detect category (button, input, etc.)
  → buildAssetMap() + serializeNodeForPrompt()    serialize to YAML
  → buildPathBAssetHints()                        text hints about icon placement
  → assembleSystemPrompt()                        ← src/prompt/assemble.ts (loads prompts/system.md)
  → assembleUserPrompt()                          ← src/prompt/assemble.ts
  → generateWithRetry(llm)                        LLM generates inline-styled .lite.tsx
  → generateFrameworkCode()                       Mitosis compiles to 5 frameworks
  → injectCSS()

Output: .lite.tsx + per-framework files. Uses css={{}} inline style pattern.

templateMode ON
Single Figma node
  → same asset collection
  → isShadcnSupported(category)?
    ├─ YES → generateShadcnSingleComponent()      ← src/shadcn/shadcn-codegen.ts
    │         → readShadcnSource()                  read base template
    │         → extractNodeStyle()                  ← src/shadcn/style-extractor.ts (single node)
    │         → extractComponentContent()           ← src/shadcn/content-extractor.ts
    │         → buildShadcnSingleComponentSystemPrompt()   ← src/shadcn/shadcn-prompt-builder.ts
    │         → buildShadcnSingleComponentUserPrompt()     ← src/shadcn/shadcn-prompt-builder.ts
    │         → LLM generates TWO code blocks
    │         → parseTwoCodeBlocks()
    │
    └─ NO or FAIL → React direct fallback:
                     → assembleReactSystemPrompt()         ← src/prompt/assemble.ts
                     → assembleReactUserPrompt()           ← src/prompt/assemble.ts
                     → generateReactDirect(llm)            ← src/compile/react-direct-gen.ts
                                                            (no Mitosis parsing)

Output: React + Tailwind only. No Mitosis intermediate step.

PATH C — Multi-Section Page
Trigger: isMultiSectionPage() returns true. Detected by: name patterns ("page", "landing"), vertical auto-layout with fill-width children, size thresholds, chart children, etc.
Function: convertPage() in src/convert.ts

Overview
Full page node
  → flattenWrapperFrames()                        unwrap plain container frames
  → extractPageLayoutCSS()                        deterministic page-level CSS
  → For each section (parallel):
      → generateCompoundSection()                 ← src/compile/component-gen.ts
          Step 1: discoverComponents()            find sub-components
          Step 2: generate each sub-component     PATH 1 (leaf generation)
          Step 3: substituteComponents()          replace INSTANCE nodes with generated HTML
          Step 4: generate section layout         PATH 2 (layout generation)
  → stitchPageComponent()                         ← src/compile/stitch.ts
  → (templateMode OFF) → parseMitosisCode() + generateFrameworkCode()
  → (templateMode ON)  → take React output directly

Step 1 — Component Discovery
discoverComponents() in src/figma/component-discovery.ts

Walks the section tree looking for INSTANCE nodes. Detection order:
Name matching — regex patterns (e.g. /^button\b|btn\b|cta\b/i → button)
Visual heuristics — layout/dimensions (e.g. h≤64, horizontal, 1-3 children, has text → button)
Component properties — if INSTANCE has componentProperties from a COMPONENT_SET (e.g. Type=Primary, Disabled=No), infers formRole from property keys/values

Groups instances by name + structural fingerprint. Returns discovered components with formRole, representative node, all instances.

Step 2 — Leaf Component Generation (PATH 1)
generateSingleComponent() in src/compile/component-gen.ts

For each discovered sub-component (run in parallel):

Charts
Chart node → extractChartMetadata(llm) → generateChartCode() → deterministic Recharts code

UI Components — templateMode ON
UI component node
  → isShadcnSupported(formRole)?
    ├─ YES → generateShadcnInlineComponent()       ← src/shadcn/shadcn-codegen.ts
    │         → readShadcnSource()
    │         → extractNodeStyle()
    │         → extractComponentContent()
    │         → buildShadcnInlineComponentSystemPrompt()   ← src/shadcn/shadcn-prompt-builder.ts
    │         → buildShadcnInlineComponentUserPrompt()     ← src/shadcn/shadcn-prompt-builder.ts
    │         → LLM generates ONE code block (JSX fragment, no wrapper)
    │
    └─ NO or FAIL → React direct fallback:
                     → assembleReactSystemPrompt()
                     → assembleReactUserPrompt()
                     → generateReactDirect()

UI Components — templateMode OFF
UI component node
  → assembleSystemPrompt() + assembleUserPrompt()
  → generateWithRetry()                            Mitosis pipeline
  → extractJSXBody()                               strip function wrapper

Step 3 — Substitution
substituteComponents() — walks section tree, replaces INSTANCE subtrees with COMPONENT_REF nodes containing pre-generated HTML. Applies per-instance text substitution.

Step 4 — Section Layout Generation (PATH 2)
Generates the section layout code that wraps the substituted component HTML.

templateMode ON
→ assembleReactSectionSystemPrompt()    ← src/prompt/assemble.ts
→ assembleReactSectionUserPrompt()      ← src/prompt/assemble.ts
→ generateReactDirect()                 React + Tailwind output

templateMode OFF
→ assemblePageSectionSystemPrompt()     ← src/prompt/assemble.ts
→ assemblePageSectionUserPrompt()       ← src/prompt/assemble.ts
→ generateWithRetry()                   Mitosis pipeline

Step 5 — Stitching
stitchPageComponent() in src/compile/stitch.ts

All section outputs
  → extractJSXBody() per section
  → Wrap each in semantic tag (<section>, <header>, <footer>) with BEM class
  → scopeSectionCSS() per section                  prevent class collisions
  → Merge all CSS blocks
  → Chart sections → placeholder div
  → Returns { mitosisSource, mergedCSS }

Step 6 — Final Output
templateMode ON:
  → Take stitched React source directly
  → Inline chart component code (imports + functions prepended)
  → Inject CSS
  → React-only output

templateMode OFF:
  → parseMitosisCode(mitosisSource)
  → generateFrameworkCode()                        compile to 5 frameworks
  → sanitizeJSXAttributes()                        fix class → className (React)
  → Inline chart code for React
  → injectCSS() per framework
  → Multi-framework output

Prompt Files Summary
Scenario
System Prompt
User Prompt
Source File
PATH A (Mitosis)
buildComponentSetSystemPrompt()
buildComponentSetUserPrompt()
src/figma/variant-prompt-builder.ts
PATH A (shadcn)
buildShadcnSystemPrompt()
buildShadcnUserPrompt()
src/shadcn/shadcn-prompt-builder.ts
PATH B (Mitosis)
assembleSystemPrompt()
assembleUserPrompt()
src/prompt/assemble.ts
PATH B (shadcn)
buildShadcnSingleComponentSystemPrompt()
buildShadcnSingleComponentUserPrompt()
src/shadcn/shadcn-prompt-builder.ts
PATH B (React fallback)
assembleReactSystemPrompt()
assembleReactUserPrompt()
src/prompt/assemble.ts
PATH C sub-components (Mitosis)
assembleSystemPrompt()
assembleUserPrompt()
src/prompt/assemble.ts
PATH C sub-components (shadcn)
buildShadcnInlineComponentSystemPrompt()
buildShadcnInlineComponentUserPrompt()
src/shadcn/shadcn-prompt-builder.ts
PATH C sub-components (React fallback)
assembleReactSystemPrompt()
assembleReactUserPrompt()
src/prompt/assemble.ts
PATH C section layout (Mitosis)
assemblePageSectionSystemPrompt()
assemblePageSectionUserPrompt()
src/prompt/assemble.ts
PATH C section layout (React)
assembleReactSectionSystemPrompt()
assembleReactSectionUserPrompt()
src/prompt/assemble.ts


Key Source Files
File
Role
src/convert.ts
Main orchestrator — PATH A/B/C routing
src/compile/component-gen.ts
PATH C sub-pipeline — discovery, generation, substitution
src/compile/stitch.ts
Stitches page sections into one component
src/compile/react-direct-gen.ts
LLM → React+Tailwind (no Mitosis)
src/compile/retry.ts
LLM → Mitosis parse → retry loop
src/shadcn/shadcn-codegen.ts
shadcn generation for all 3 paths
src/shadcn/shadcn-prompt-builder.ts
All shadcn LLM prompts
src/shadcn/style-extractor.ts
Extracts colors, borders, padding, typography from Figma
src/shadcn/content-extractor.ts
Extracts labels, placeholders, text content
src/shadcn/shadcn-types.ts
formRole → shadcn type mapping
src/figma/component-discovery.ts
Discovers sub-components in PATH C sections
src/figma/component-set-parser.ts
Parses COMPONENT_SET variant axes
src/figma/asset-export.ts
Icon SVG export and deduplication
src/prompt/assemble.ts
Non-shadcn prompt assembly
src/figma/variant-prompt-builder.ts
PATH A Mitosis prompt builder


