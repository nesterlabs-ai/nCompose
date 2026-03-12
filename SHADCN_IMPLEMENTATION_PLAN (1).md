# shadcn/ui Integration — End-to-End Implementation Plan

## Goal

Replace from-scratch LLM component generation with **shadcn/ui base components + Figma style overrides**. The LLM currently generates buttons, inputs, selects, etc. from raw HTML. Instead, we detect what Figma component maps to which shadcn component, emit shadcn imports with the right props, and layer Figma-specific styling (colors, spacing, radii, fonts) on top via Tailwind className overrides.

---

## Current Pipeline (How It Works Today)

```
Figma Node
  ├─ PATH A (COMPONENT_SET) ─→ parseVariants → LLM generates Mitosis .lite.tsx → Mitosis compiles → 5 frameworks
  ├─ PATH B (Single Component) ─→ LLM generates Mitosis .lite.tsx → Mitosis compiles → 5 frameworks
  └─ PATH C (Multi-Section Page) ─→ discoverComponents() → for each leaf:
                                        ├─ chart? → deterministic Recharts codegen (no LLM)
                                        └─ UI component? → LLM generates component (PATH 1)
                                    → LLM assembles section layout (PATH 2)
                                    → stitch sections into page
```

**Key insight**: Charts already bypass the LLM entirely — `chart-codegen.ts` emits deterministic React + CSS from metadata. **shadcn components will follow the same pattern.**

---

## What Changes

```
Figma Node
  ├─ PATH A (COMPONENT_SET) ─→ parseVariants
  │     ├─ shadcn-mapped? → deterministic shadcn React code (variant props + Figma overrides)
  │     └─ else → existing LLM + Mitosis path (unchanged)
  │
  ├─ PATH B (Single Component)
  │     ├─ shadcn-mapped? → deterministic shadcn React code
  │     └─ else → existing LLM path (unchanged)
  │
  └─ PATH C (Multi-Section Page) ─→ discoverComponents() → for each leaf:
                                        ├─ chart? → Recharts codegen (unchanged)
                                        ├─ shadcn-mapped? → shadcn codegen (NEW)
                                        └─ else → LLM generation (unchanged)
                                    → LLM assembles section layout (PATH 2, updated prompts)
                                    → stitch sections into page
```

---

## Phase 1: shadcn Component Registry

### New File: `src/shadcn/registry.ts`

A static catalog mapping `formRole` → shadcn component definition.

```typescript
export interface ShadcnComponentDef {
  name: string;                    // "Button", "Input", "Select"
  importPath: string;              // "@/components/ui/button"
  importNames: string[];           // ["Button"] or ["Select", "SelectTrigger", "SelectContent", "SelectItem", "SelectValue"]
  propsFromFigma: string[];        // which Figma properties to extract: ["text", "variant", "size", "disabled", "icon"]
  defaultVariant?: string;         // "default"
  variantMap?: Record<string, string>; // Figma axis value → shadcn variant: { "Primary": "default", "Secondary": "secondary", "Outline": "outline" }
  sizeMap?: Record<string, string>;    // Figma size → shadcn size: { "Small": "sm", "Medium": "default", "Large": "lg" }
}

export const SHADCN_REGISTRY: Record<string, ShadcnComponentDef> = {
  button:    { name: 'Button',   importPath: '@/components/ui/button',   importNames: ['Button'], ... },
  textInput: { name: 'Input',    importPath: '@/components/ui/input',    importNames: ['Input'], ... },
  textarea:  { name: 'Textarea', importPath: '@/components/ui/textarea', importNames: ['Textarea'], ... },
  select:    { name: 'Select',   importPath: '@/components/ui/select',   importNames: ['Select','SelectTrigger','SelectContent','SelectItem','SelectValue'], ... },
  checkbox:  { name: 'Checkbox', importPath: '@/components/ui/checkbox', importNames: ['Checkbox'], ... },
  radio:     { name: 'RadioGroup', importPath: '@/components/ui/radio-group', importNames: ['RadioGroup','RadioGroupItem'], ... },
  toggle:    { name: 'Switch',   importPath: '@/components/ui/switch',   importNames: ['Switch'], ... },
  chip:      { name: 'Badge',    importPath: '@/components/ui/badge',    importNames: ['Badge'], ... },
  badge:     { name: 'Badge',    importPath: '@/components/ui/badge',    importNames: ['Badge'], ... },
  tab:       { name: 'Tabs',     importPath: '@/components/ui/tabs',     importNames: ['Tabs','TabsList','TabsTrigger','TabsContent'], ... },
  avatar:    { name: 'Avatar',   importPath: '@/components/ui/avatar',   importNames: ['Avatar','AvatarImage','AvatarFallback'], ... },
  slider:    { name: 'Slider',   importPath: '@/components/ui/slider',   importNames: ['Slider'], ... },
  tooltip:   { name: 'Tooltip',  importPath: '@/components/ui/tooltip',  importNames: ['Tooltip','TooltipTrigger','TooltipContent','TooltipProvider'], ... },
  pagination:{ name: 'Pagination', importPath: '@/components/ui/pagination', importNames: ['Pagination','PaginationContent','PaginationItem','PaginationLink','PaginationNext','PaginationPrevious'], ... },
  breadcrumb:{ name: 'Breadcrumb', importPath: '@/components/ui/breadcrumb', importNames: ['Breadcrumb','BreadcrumbList','BreadcrumbItem','BreadcrumbLink','BreadcrumbSeparator'], ... },
  card:      { name: 'Card',     importPath: '@/components/ui/card',     importNames: ['Card','CardHeader','CardTitle','CardDescription','CardContent','CardFooter'], ... },
  dialog:    { name: 'Dialog',   importPath: '@/components/ui/dialog',   importNames: ['Dialog','DialogTrigger','DialogContent','DialogHeader','DialogTitle','DialogDescription','DialogFooter'], ... },
  table:     { name: 'Table',    importPath: '@/components/ui/table',    importNames: ['Table','TableHeader','TableBody','TableRow','TableHead','TableCell'], ... },
  accordion: { name: 'Accordion', importPath: '@/components/ui/accordion', importNames: ['Accordion','AccordionItem','AccordionTrigger','AccordionContent'], ... },
  alert:     { name: 'Alert',    importPath: '@/components/ui/alert',    importNames: ['Alert','AlertTitle','AlertDescription'], ... },
};

export const SHADCN_SUPPORTED_ROLES = new Set(Object.keys(SHADCN_REGISTRY));
```

### Changes: `src/figma/component-discovery.ts`

Add new `COMPONENT_PATTERNS` entries for currently missing formRoles:

```typescript
{ pattern: /\bcard\b/i,                    formRole: 'card' },
{ pattern: /\bdialog\b|\bmodal\b|\bpopup\b/i, formRole: 'dialog' },
{ pattern: /\btable\b|\bdata[-\s]?grid\b/i,   formRole: 'table' },
{ pattern: /\baccordion\b|\bcollapsible\b/i,   formRole: 'accordion' },
{ pattern: /\balert\b|\bnotification\b/i,      formRole: 'alert' },
```

---

## Phase 2: Figma Style Extractor

### New File: `src/shadcn/style-extractor.ts`

Reads the Figma node's visual properties and produces Tailwind className overrides that layer on top of shadcn defaults.

```typescript
export interface FigmaStyleOverrides {
  className: string;     // Tailwind arbitrary values: "bg-[#581c87] rounded-[8px] text-[14px] p-[12px_24px]"
  cssOverrides: string;  // Fallback CSS for complex cases (multi-shadow, gradients, pseudo-elements)
}

export function extractStyleOverrides(node: any, shadcnDef: ShadcnComponentDef): FigmaStyleOverrides
```

**Extraction logic:**

| Figma Property | Tailwind Output | Example |
|---|---|---|
| `fills[0].color` (solid) | `bg-[rgb(R,G,B)]` | `bg-[rgb(88,28,135)]` |
| `cornerRadius` | `rounded-[Npx]` | `rounded-[8px]` |
| `strokeWeight` + `strokes[0].color` | `border border-[rgb(...)]` | `border border-[rgb(229,231,235)]` |
| `style.fontSize` | `text-[Npx]` | `text-[14px]` |
| `style.fontWeight` | `font-[N]` | `font-[600]` |
| `style.color` (text fills) | `text-[rgb(...)]` | `text-[rgb(255,255,255)]` |
| `paddingTop/Right/Bottom/Left` | `p-[T_R_B_L]` or `px-[N] py-[N]` | `px-[24px] py-[12px]` |
| `itemSpacing` | `gap-[Npx]` | `gap-[8px]` |
| `effects` (drop shadow) | `shadow-[...]` | `shadow-[0_2px_4px_rgba(0,0,0,0.1)]` |
| `absoluteBoundingBox.height` | `h-[Npx]` | `h-[48px]` |
| `absoluteBoundingBox.width` | `w-[Npx]` (only if fixed) | `w-[200px]` |

**Theme token proximity matching:**

```typescript
// If Figma color is within deltaE < 10 of a shadcn CSS variable, use the variable instead
const SHADCN_THEME_TOKENS = {
  '--primary':     { r: 0.09, g: 0.09, b: 0.09 },
  '--secondary':   { r: 0.96, g: 0.96, b: 0.96 },
  '--destructive': { r: 0.93, g: 0.22, b: 0.22 },
  '--muted':       { r: 0.96, g: 0.96, b: 0.96 },
  '--accent':      { r: 0.96, g: 0.96, b: 0.96 },
  // ... etc
};

// If match: emit bg-[hsl(var(--primary))] instead of bg-[rgb(23,23,23)]
```

---

## Phase 3: Deterministic shadcn Code Generator

### New File: `src/compile/shadcn-codegen.ts`

Modeled after `chart-codegen.ts`. One builder function per shadcn component type.

```typescript
export interface ShadcnCodeResult {
  reactCode: string;   // JSX fragment (no wrapper function — gets embedded in section)
  css: string;         // Minimal override CSS (only what Tailwind can't express)
  imports: string[];   // ["Button from @/components/ui/button"]
}

export function generateShadcnComponent(
  formRole: string,
  node: any,
  bemPrefix: string,
  overrides: FigmaStyleOverrides,
): ShadcnCodeResult
```

### Builder Functions (one per component):

**`buildShadcnButton(node, overrides)`**

```typescript
// Extracts from Figma node:
//   - text content (from TEXT child)
//   - icon (from INSTANCE/VECTOR child — left/right position)
//   - variant (from componentProperties or fill color proximity)
//   - size (from height: <32 = "sm", 32-44 = "default", >44 = "lg")
//   - disabled (from opacity < 1 or "Disabled" state)

// Emits:
<Button variant="default" size="default" className="bg-[rgb(88,28,135)] rounded-[8px] text-[14px] font-[500] px-[24px] py-[12px]">
  {hasLeftIcon && <img src="./assets/icon.svg" className="mr-2 h-4 w-4" />}
  Submit
  {hasRightIcon && <img src="./assets/icon.svg" className="ml-2 h-4 w-4" />}
</Button>
```

**`buildShadcnInput(node, overrides)`**

```typescript
// Extracts: placeholder text, type (from name: "email" → type="email", "password" → type="password")
// Emits:
<Input
  type="text"
  placeholder="Enter your email"
  className="h-[48px] rounded-[8px] border-[rgb(229,231,235)] text-[14px] px-[16px]"
/>
```

**`buildShadcnSelect(node, overrides)`**

```typescript
// Extracts: placeholder, option items (from nested TEXT nodes or componentProperties)
// Emits:
<Select>
  <SelectTrigger className="h-[48px] rounded-[8px] border-[rgb(229,231,235)] text-[14px]">
    <SelectValue placeholder="Choose option" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="option-1">Option 1</SelectItem>
    <SelectItem value="option-2">Option 2</SelectItem>
  </SelectContent>
</Select>
```

**`buildShadcnCheckbox(node, overrides)`**

```typescript
// Extracts: label text, checked state
// Emits:
<div className="flex items-center gap-[8px]">
  <Checkbox id="cb-1" className="h-[20px] w-[20px] rounded-[4px] border-[rgb(209,213,219)]" />
  <label htmlFor="cb-1" className="text-[14px] text-[rgb(55,65,81)]">Remember me</label>
</div>
```

**`buildShadcnSwitch(node, overrides)`**

```typescript
// Emits:
<div className="flex items-center gap-[8px]">
  <Switch className="data-[state=checked]:bg-[rgb(88,28,135)]" />
  <label className="text-[14px]">Enable notifications</label>
</div>
```

**`buildShadcnBadge(node, overrides)`**

```typescript
// Extracts: text, variant (from fill color)
// Emits:
<Badge variant="default" className="bg-[rgb(88,28,135)] text-[12px] rounded-[12px] px-[8px] py-[2px]">
  Active
</Badge>
```

**`buildShadcnAvatar(node, overrides)`**

```typescript
// Extracts: image fill (if present), initials (from TEXT child), size
// Emits:
<Avatar className="h-[40px] w-[40px]">
  <AvatarImage src="./assets/avatar.png" />
  <AvatarFallback className="bg-[rgb(88,28,135)] text-[rgb(255,255,255)] text-[14px]">JD</AvatarFallback>
</Avatar>
```

**`buildShadcnCard(node, overrides)`**

```typescript
// Extracts: title (TEXT child in header area), description, content children
// Emits:
<Card className="rounded-[12px] border-[rgb(229,231,235)] shadow-[0_1px_3px_rgba(0,0,0,0.1)]">
  <CardHeader>
    <CardTitle className="text-[18px] font-[600]">Card Title</CardTitle>
    <CardDescription className="text-[14px] text-[rgb(107,114,128)]">Description text</CardDescription>
  </CardHeader>
  <CardContent>
    {/* inner content rendered by section LLM or nested component codegen */}
  </CardContent>
</Card>
```

**`buildShadcnTabs(node, overrides)`**

```typescript
// Extracts: tab labels from TEXT children in tab bar, active tab (from fill/style)
// Emits:
<Tabs defaultValue="tab-1">
  <TabsList className="bg-[rgb(243,244,246)] rounded-[8px] p-[4px]">
    <TabsTrigger value="tab-1" className="rounded-[6px] text-[14px] data-[state=active]:bg-[rgb(255,255,255)]">Overview</TabsTrigger>
    <TabsTrigger value="tab-2" className="rounded-[6px] text-[14px]">Analytics</TabsTrigger>
  </TabsList>
  <TabsContent value="tab-1">{/* content */}</TabsContent>
  <TabsContent value="tab-2">{/* content */}</TabsContent>
</Tabs>
```

**`buildShadcnTable(node, overrides)`**

```typescript
// Extracts: header row (TEXT nodes in first row), data rows, column widths
// Emits:
<Table>
  <TableHeader>
    <TableRow>
      <TableHead className="text-[12px] font-[500] text-[rgb(107,114,128)]">Name</TableHead>
      <TableHead>Status</TableHead>
      <TableHead>Amount</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell className="text-[14px]">John Doe</TableCell>
      <TableCell><Badge variant="outline">Active</Badge></TableCell>
      <TableCell>$250.00</TableCell>
    </TableRow>
  </TableBody>
</Table>
```

---

## Phase 4: Pipeline Integration

### 4.1 — PATH 1: Leaf Component Generation

**File: `src/compile/component-gen.ts` → `generateSingleComponent()`**

Add shadcn intercept before the LLM call:

```typescript
import { SHADCN_SUPPORTED_ROLES, SHADCN_REGISTRY } from '../shadcn/registry.js';
import { extractStyleOverrides } from '../shadcn/style-extractor.js';
import { generateShadcnComponent } from './shadcn-codegen.js';

async function generateSingleComponent(node, formRole, ..., options) {
  // NEW: shadcn fast path
  if (options.shadcn && SHADCN_SUPPORTED_ROLES.has(formRole)) {
    const def = SHADCN_REGISTRY[formRole];
    const overrides = extractStyleOverrides(node, def);
    const result = generateShadcnComponent(formRole, node, bemPrefix, overrides);
    return {
      name: componentName,
      formRole,
      html: result.reactCode,
      css: result.css,
      success: true,
      isShadcn: true,
      shadcnImports: result.imports,
    };
  }

  // EXISTING: LLM generation (unchanged)
  ...
}
```

### 4.2 — PATH 2: Compound Section Generation

**File: `src/compile/component-gen.ts` → `generateCompoundSection()`**

After component discovery, three codegen buckets:

```typescript
const chartComponents = discovered.filter(c => c.formRole === 'chart');
const shadcnComponents = discovered.filter(c => SHADCN_SUPPORTED_ROLES.has(c.formRole) && options.shadcn);
const llmComponents = discovered.filter(c => c.formRole !== 'chart' && !SHADCN_SUPPORTED_ROLES.has(c.formRole));

// Generate in parallel:
await Promise.all([
  ...chartComponents.map(c => generateChartCode(c)),        // existing
  ...shadcnComponents.map(c => generateShadcnComponent(c)), // NEW
  ...llmComponents.map(c => generateSingleComponent(c)),    // existing
]);
```

### 4.3 — PATH A: Component Set (Variants)

**File: `src/convert.ts` → `convertComponentSet()`**

When the component set maps to a shadcn component, generate a React component with variant props:

```typescript
if (options.shadcn && isShadcnComponentSet(variantData)) {
  // Map Figma variant axes to shadcn props
  // e.g., Style=Primary → variant="default", Size=Large → size="lg"
  const result = generateShadcnVariantComponent(variantData, variantCSS);
  // Output React directly
  return { componentName, frameworkOutputs: { react: result.reactCode }, css: result.css };
}
```

### 4.4 — PATH B: Single Component

**File: `src/convert.ts` → main convert function**

Before the LLM call in PATH B:

```typescript
// PATH B: check if this single node is a shadcn-mappable component
if (options.shadcn) {
  const detectedRole = detectShadcnRole(rootNode); // name + visual heuristic
  if (detectedRole && SHADCN_SUPPORTED_ROLES.has(detectedRole)) {
    return convertShadcnSingleComponent(rootNode, detectedRole, options);
  }
}
// Else: existing LLM path
```

---

## Phase 5: Variant Mapping (PATH A Integration)

### New File: `src/shadcn/variant-mapper.ts`

Maps Figma COMPONENT_SET variant axes to shadcn component props.

```typescript
export interface VariantMapping {
  shadcnProp: string;       // "variant" | "size" | "disabled"
  figmaAxis: string;        // "Style" | "Size" | "State"
  valueMap: Record<string, string>;  // { "Primary": "default", "Secondary": "secondary" }
}

export function mapVariantsToShadcn(
  componentSetData: ParsedComponentSet,
  shadcnDef: ShadcnComponentDef,
): VariantMapping[]
```

**Variant mapping rules:**

| Figma Axis | Figma Values | shadcn Prop | shadcn Values |
|---|---|---|---|
| Style/Type/Variant | Primary, Secondary, Outline, Ghost, Link, Destructive, Danger | `variant` | default, secondary, outline, ghost, link, destructive |
| Size | Small/SM, Medium/MD/Default, Large/LG, XL | `size` | sm, default, lg, icon |
| State | Default, Hover, Focus, Active, Disabled, Loading | CSS pseudo-classes + `disabled` prop | `:hover`, `:focus`, `disabled={true}` |
| Icon | With Icon, No Icon, Left, Right | Conditional icon render | `{icon && <Icon />}` |

**Output for a Button COMPONENT_SET:**

```tsx
import { Button } from "@/components/ui/button";
import { cva } from "class-variance-authority";

// Figma-specific overrides per variant
const buttonOverrides = cva("", {
  variants: {
    variant: {
      default: "bg-[rgb(88,28,135)] hover:bg-[rgb(76,24,116)]",
      secondary: "bg-[rgb(243,232,255)] text-[rgb(88,28,135)]",
      outline: "border-[rgb(88,28,135)] text-[rgb(88,28,135)]",
      destructive: "bg-[rgb(220,38,38)]",
    },
    size: {
      sm: "h-[32px] px-[12px] text-[12px]",
      default: "h-[40px] px-[16px] text-[14px]",
      lg: "h-[48px] px-[24px] text-[16px]",
    },
  },
});

export default function FigmaButton({ variant = "default", size = "default", children, ...props }) {
  return (
    <Button variant={variant} size={size} className={buttonOverrides({ variant, size })} {...props}>
      {children}
    </Button>
  );
}
```

---

## Phase 6: Section Layout Prompt Updates

### File: `prompts/system.md` (add shadcn section)

When shadcn mode is active, the section layout LLM (PATH 2) needs to know about pre-generated shadcn components. Update the prompt:

```markdown
## Pre-generated shadcn Components

Some components in the design have been pre-generated using shadcn/ui.
They appear as `COMPONENT_REF` nodes in the YAML with their complete JSX.

When assembling the section layout:
- Use the pre-generated JSX exactly as provided
- Do NOT recreate these components from scratch
- You may wrap them in layout containers (div, section, etc.)
- Use Tailwind classes for layout (flex, grid, gap, padding)
- The shadcn components already have their styling — don't override it
```

### File: `src/compile/component-gen.ts` → `buildComponentReferenceBlock()`

Update to indicate which components are shadcn-based:

```typescript
// Current: "The following components have been pre-generated. Use them as-is."
// New: Add shadcn indicator
for (const comp of generatedComponents) {
  if (comp.isShadcn) {
    block += `<!-- shadcn/ui: ${comp.name} (${comp.formRole}) — imports: ${comp.shadcnImports.join(', ')} -->\n`;
  }
  block += comp.html + '\n';
}
```

---

## Phase 7: Output & File Structure

### File: `src/output.ts`

When shadcn components are used, output includes:

```
output/
  ComponentName.jsx          ← React component using shadcn imports
  ComponentName.css          ← Minimal override CSS (if any)
  ComponentName.lite.tsx     ← Mitosis source (only for non-shadcn components)
  ComponentName.vue          ← Vue output (Mitosis path, fallback for non-shadcn)
  ChartName.jsx              ← Recharts chart (existing)
  ChartName.css
  shadcn-deps.json           ← NEW: lists required shadcn components
  assets/
    icon.svg
```

### New: `shadcn-deps.json`

```json
{
  "components": ["button", "input", "select", "badge", "card"],
  "dependencies": {
    "@radix-ui/react-select": "^2.0.0",
    "@radix-ui/react-checkbox": "^1.0.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.2.0",
    "lucide-react": "^0.300.0"
  },
  "install": "npx shadcn@latest add button input select badge card"
}
```

---

## Phase 8: Configuration & CLI

### File: `src/config.ts`

```typescript
shadcn: {
  enabled: false,           // --shadcn flag enables this
  themeMapping: true,       // map Figma colors to CSS variables when close
  colorThreshold: 10,       // max deltaE for theme token matching
  fallbackToLLM: true,      // if shadcn codegen fails, fall back to LLM
}
```

### File: `src/index.ts`

```typescript
.option('--shadcn', 'Use shadcn/ui components with Figma style overrides', false)
```

### File: `src/types/index.ts`

```typescript
export interface ConvertOptions {
  // ... existing
  shadcn?: boolean;
}

export interface GeneratedComponent {
  // ... existing
  isShadcn?: boolean;
  shadcnImports?: string[];
}
```

---

## Phase 9: Text & Content Extraction Helpers

### New File: `src/shadcn/content-extractor.ts`

Shared utilities for extracting content from Figma nodes for shadcn codegen:

```typescript
// Extract visible text from TEXT children
export function extractTexts(node: any): string[]

// Extract placeholder text (lighter/muted text in input fields)
export function extractPlaceholder(node: any): string

// Extract icon children (INSTANCE/VECTOR nodes ≤ 24px)
export function extractIcons(node: any): { position: 'left' | 'right'; src: string }[]

// Extract option items from nested frames (for Select, RadioGroup, etc.)
export function extractOptions(node: any): { label: string; value: string }[]

// Extract tab labels from horizontal list of text items
export function extractTabLabels(node: any): string[]

// Extract table structure (headers + rows)
export function extractTableData(node: any): { headers: string[]; rows: string[][] }

// Detect variant from component properties or visual heuristics
export function detectVariant(node: any, shadcnDef: ShadcnComponentDef): string

// Detect size from height
export function detectSize(node: any): 'sm' | 'default' | 'lg'
```

---

## Implementation Sequence

| Step | What | Files | Depends On |
|------|------|-------|-----------|
| **1** | shadcn registry + config + CLI flag | `src/shadcn/registry.ts`, `src/config.ts`, `src/index.ts`, `src/types/index.ts` | — |
| **2** | Add new formRoles to component discovery | `src/figma/component-discovery.ts` | — |
| **3** | Style extractor (Figma → Tailwind overrides) | `src/shadcn/style-extractor.ts` | — |
| **4** | Content extraction helpers | `src/shadcn/content-extractor.ts` | — |
| **5** | shadcn codegen — **Button, Input, Badge** (simplest) | `src/compile/shadcn-codegen.ts` | Steps 1, 3, 4 |
| **6** | PATH 1 integration (leaf component intercept) | `src/compile/component-gen.ts` | Step 5 |
| **7** | Test with real Figma designs | — | Step 6 |
| **8** | Expand codegen — **Select, Checkbox, Switch, Avatar** | `src/compile/shadcn-codegen.ts` | Step 7 |
| **9** | Expand codegen — **Tabs, Card, Table** (complex) | `src/compile/shadcn-codegen.ts` | Step 8 |
| **10** | PATH A integration (variant component sets) | `src/convert.ts`, `src/shadcn/variant-mapper.ts` | Step 9 |
| **11** | PATH B integration (single component intercept) | `src/convert.ts` | Step 6 |
| **12** | Section layout prompt updates (hybrid mode) | `prompts/system.md`, `src/compile/component-gen.ts` | Step 6 |
| **13** | Output: shadcn-deps.json + install instructions | `src/output.ts` | Step 6 |
| **14** | Expand codegen — **Dialog, Accordion, Alert, Breadcrumb** | `src/compile/shadcn-codegen.ts` | Step 9 |

---

## Key Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| React-only for shadcn? | **Yes** — React-only output for shadcn components, Mitosis fallback for other frameworks | shadcn uses Radix UI, forwardRef, cva — incompatible with Mitosis. Charts already set this precedent. |
| Replace LLM or augment? | **Augment** — shadcn codegen for matched components, LLM for everything else | Graceful degradation. Unknown components still work via LLM. |
| Styling approach? | **Tailwind className overrides** on shadcn base | Minimal CSS, theme-compatible, easy to customize. |
| Where to intercept? | **PATH 1 (generateSingleComponent)** as primary entry point | Single intercept point covers PATH A, B, and C since all leaf components flow through PATH 1. |
| How to handle unknown variants? | **className override** instead of forcing shadcn variant match | A Figma button with "Gradient" style doesn't map to any shadcn variant — just override the background via className. |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Complex components (Table, Dialog) have highly variable Figma structure | Wrong sub-component nesting | Start with simple components; use LLM fallback for complex ones initially |
| Figma colors don't map cleanly to shadcn theme tokens | Hardcoded colors instead of CSS variables | Theme proximity matching with configurable threshold; fallback to literal colors |
| Multi-framework users lose shadcn benefit | Vue/Svelte/Angular get LLM output while React gets shadcn | Document clearly; future work: shadcn-vue, shadcn-svelte ports |
| Component composition mismatch (Figma Card containing Table) | Nested shadcn components need correct composition | Let section LLM handle composition; shadcn codegen only handles leaf instances |
| shadcn version drift | Generated imports may break with shadcn updates | Pin to stable shadcn/ui version in registry; version field in config |
