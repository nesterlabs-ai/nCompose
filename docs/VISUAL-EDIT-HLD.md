# Visual Edit Feature — High-Level Design Document

## Overview

Visual Edit lets users **click an element** in the live preview, then **type a natural language prompt** (e.g., "change button width to 137 x 48") to modify that specific element. The system identifies the clicked element, enriches the LLM prompt with targeting context, sends the **entire component code** (not just the selected element), and the LLM returns the **complete updated file**.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  BROWSER                                                            │
│                                                                     │
│  ┌──────────────────────┐     postMessage      ┌──────────────────┐│
│  │   Preview Iframe      │◄───────────────────►│   Parent App     ││
│  │                       │                      │   (app.js)       ││
│  │  - Hover outlines     │  elementSelected     │                  ││
│  │  - Click detection    │────────────────────►│  - Sidebar props ││
│  │  - data-ve-id lookup  │                      │  - Floating input││
│  │  - Variant context    │  setVisualEditActive │  - Chat history  ││
│  │                       │◄────────────────────│                  ││
│  └──────────────────────┘                      └───────┬──────────┘│
│                                                         │           │
└─────────────────────────────────────────────────────────┼───────────┘
                                                          │
                                              POST /api/refine (SSE)
                                                          │
                                                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│  SERVER (src/web/server.ts)                                         │
│                                                                     │
│  1. Load session (memory or disk fallback)                          │
│  2. Extract currentMitosis + currentCSS from session                │
│  3. Call refineComponent() with selectedElement context              │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  refineComponent() — src/web/refine.ts                         │ │
│  │                                                                │ │
│  │  a. Build system prompt (Mitosis rules + refinement addendum)  │ │
│  │  b. Append conversation history (multi-turn)                   │ │
│  │  c. Build user message:                                        │ │
│  │     - ENTIRE current code (Mitosis .lite.tsx + CSS)            │ │
│  │     - User prompt text                                         │ │
│  │     - Element targeting context (from selectedElement)         │ │
│  │  d. Call LLM (generateMultiTurn)                               │ │
│  │  e. Parse LLM output via Mitosis parseJsx()                    │ │
│  │  f. Inject new data-ve-id attributes                           │ │
│  │  g. Compile to all target frameworks                           │ │
│  │  h. Inject CSS into each framework output                      │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  4. Update session state                                            │
│  5. Return frameworkOutputs + elementMap via SSE                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## End-to-End Flow (Step by Step)

### Step 1: User Enters Visual Edit Mode

User clicks "Visual Edit" button in the UI. The parent app sends a message to the preview iframe:

```js
// app.js — toggleVisualEditMode(true)
iframe.contentWindow.postMessage({ type: 'setVisualEditActive', active: true }, '*');
```

The iframe sets a flag: `window.parentVisualEditActive = true`, which enables hover outlines and click interception.

### Step 2: User Clicks an Element

The iframe script intercepts the click, prevents default behavior, and gathers context:

```js
// preview.ts — injected script inside iframe
document.addEventListener('click', (e) => {
  if (!window.parentVisualEditActive) return;
  e.preventDefault();
  e.stopPropagation();

  // Find the data-ve-id (injected during compilation)
  const veIdEl = e.target.closest('[data-ve-id]');
  const dataVeId = veIdEl ? veIdEl.getAttribute('data-ve-id') : null;

  // Find variant context (if clicking inside variant grid)
  const variantWrapper = e.target.closest('[data-variant-label]');
  const variantLabel = variantWrapper?.getAttribute('data-variant-label');
  const variantProps = JSON.parse(variantWrapper?.getAttribute('data-variant-props') || 'null');

  // Get computed styles
  const style = window.getComputedStyle(e.target);

  // Send to parent
  window.parent.postMessage({
    type: 'elementSelected',
    dataVeId,            // e.g. "0-0-0-1-1"
    variantLabel,        // e.g. "Primary / Default" or null
    variantProps,        // e.g. { variant: "primary" } or null
    tagName: e.target.tagName.toLowerCase(),  // "button"
    textContent: e.target.textContent.trim(),  // "We're hiring!"
    computedStyle: { color, backgroundColor, fontSize, fontWeight, ... },
    rect: { top, left, width, height },
  }, '*');
});
```

### Step 3: Parent Receives Selection

```js
// app.js
window.addEventListener('message', (e) => {
  if (e.data.type === 'elementSelected') {
    selectedElementInfo = e.data;          // stored globally
    updateVisualEditSidebar(e.data);       // populate property panel
    showFloatingPrompt(e.data);            // show AI input above element
  }
});
```

### Step 4: User Types a Prompt

User types in the floating prompt: `"change button width to 137 x 48"`

The client wraps this with context:

```js
// app.js — when user presses Enter in floating input
const context = `Modify the selected ${selectedElementInfo.tagName}: ${promptText}`;
// Result: "Modify the selected button: change button width to 137 x 48"

toggleVisualEditMode(false);  // exit visual edit
sendChatMessage(context);     // send to server
```

### Step 5: Client Sends POST /api/refine

```js
// app.js — sendChatMessage()
fetch('/api/refine', {
  method: 'POST',
  body: JSON.stringify({
    sessionId: "20260324-130004",
    prompt: "Modify the selected button: change button width to 137 x 48",
    selectedElement: {
      dataVeId: "0-0-0-1-1",
      tagName: "button",
      textContent: "We're hiring!",
      variantLabel: null,        // null = not inside variant grid
      variantProps: null,
    },
    chatHistory: [...previous turns...],
  }),
});
```

### Step 6: Server Processes the Request

**`POST /api/refine`** in `server.ts`:

1. Loads session from memory (or disk fallback)
2. Extracts current Mitosis source and CSS from session
3. Creates LLM provider
4. Calls `refineComponent()` with all context

### Step 7: refineComponent() Builds the LLM Messages

**This is the critical part — what the LLM actually sees.**

#### Message 1: System Prompt

```
[Full Mitosis system prompt — ~300 lines of rules about class naming,
CSS fidelity, semantic HTML, output format, etc.]

## Refinement Mode

You are refining an existing Mitosis component based on user instructions.

RULES:
1. Output the COMPLETE updated .lite.tsx file — not a diff or partial snippet.
2. Preserve all existing functionality unless the user asks to change it.
3. Follow all Mitosis rules (use `class` not `className`, `css={{}}` values must be plain string literals, etc.).
4. If the component has a CSS section (delimited by `---CSS---`), output the updated CSS after the delimiter.
5. Keep the same component name and export structure.
6. Only make changes that the user explicitly requested.
```

#### Message 2+: Previous Conversation History (if any)

Any prior user/assistant turns from the same session.

#### Final Message: User Prompt (the actual request)

```
Here is the current component code:

```tsx
import { useStore, For } from '@builder.io/mitosis';

export default function TeamSection(props) {
  const state = useStore({
    teamMembersRow1: [
      { id: 1, src: './assets/_team-member.svg', alt: 'Team member' },
      ...
    ],
  });

  return (
    <section class="team-section" data-ve-id="0">
      <div class="team-section__container" data-ve-id="0-0">
        <div class="team-section__content" data-ve-id="0-0-0">
          ...
          <div class="team-section__actions" data-ve-id="0-0-0-1">
            <button class="team-section__button team-section__button--secondary"
                    type="button" data-ve-id="0-0-0-1-0">
              <span data-ve-id="0-0-0-1-0-0">Read our principles</span>
            </button>
            <button class="team-section__button team-section__button--primary"
                    type="button" data-ve-id="0-0-0-1-1">    ◄── THIS ELEMENT
              <span data-ve-id="0-0-0-1-1-0">We're hiring!</span>
            </button>
          </div>
        </div>
      </div>
      ...
    </section>
  );
}
---CSS---
.team-section { ... }
.team-section__button { ... }
.team-section__button--primary {
  width: 137px;
  background-color: rgb(127, 86, 217);
  border-color: rgb(127, 86, 217);
}
... (full CSS)
```

User request: Modify the selected button: change button width to 137 x 48

IMPORTANT - Element targeting: The user selected a specific element in the preview (data-ve-id="0-0-0-1-1").
- Tag: <button>
- Path in component tree: 0-0-0-1-1
- className: team-section__button team-section__button--primary
- Current text: "We're hiring!"
Apply the requested changes to THIS element specifically.

Output the COMPLETE updated .lite.tsx file. If the component uses a CSS section (---CSS---), include the updated CSS after the delimiter.
```

> **KEY INSIGHT**: The **entire component code** (JSX + CSS) goes to the LLM every time. NOT just the selected element. The element targeting context tells the LLM WHICH element to modify.

### Step 8: LLM Returns Complete Updated File

The LLM returns the entire `.lite.tsx` file + CSS, with only the targeted change:

```tsx
// ... identical JSX ...
---CSS---
// ... identical CSS except:
.team-section__button--primary {
  width: 137px;
  height: 48px;              /* ← ADDED */
  background-color: rgb(127, 86, 217);
  border-color: rgb(127, 86, 217);
}
```

### Step 9: Server Parses + Compiles

```
LLM output
  → parseMitosisCode()         — Parse into Mitosis AST
  → injectDataVeIds()          — Re-inject data-ve-id on all elements (new elementMap)
  → generateFrameworkCode()    — Compile to React/Vue/Svelte/Angular/Solid
  → injectCSS()                — Inject CSS into each framework output
```

If parse fails → retry once with error feedback to LLM.

If LLM dropped CSS → server re-injects the original CSS as safety net.

### Step 10: Client Receives Updated Code

Via SSE `complete` event:

```js
{
  frameworkOutputs: { react: "...", vue: "...", ... },
  mitosisSource: "...lite.tsx + CSS...",
  elementMap: { "0": { path: "0", tagName: "section", ... }, "0-0-0-1-1": { ... } }
}
```

Client updates the preview iframe, Monaco editor, and localStorage.

---

## What is `data-ve-id`?

A **path-based identifier** injected into every DOM element during Mitosis compilation.

```
data-ve-id="0"           → root element (section)
data-ve-id="0-0"         → first child of root
data-ve-id="0-0-0"       → first grandchild
data-ve-id="0-0-0-1-1"   → the "We're hiring!" button
```

Generated by `injectDataVeIds()` in `src/compile/element-mapping.ts`:
- Walks the Mitosis AST tree
- Skips Mitosis blocks (`For`, `Show`, `Fragment`) — they're not DOM elements
- Assigns `{parentPath}-{childIndex}` to each real element
- Builds `elementMap`: a dictionary mapping path → `{ tagName, className, textContent }`

This map is stored in the session and used during refinement to resolve a clicked element's `data-ve-id` back to its metadata.

---

## Variant-Aware Targeting

When a COMPONENT_SET is rendered, the preview shows a **variant grid** — multiple instances with different props. Each variant wrapper has:

```html
<div data-variant-label="Primary / Default"
     data-variant-props='{"variant":"primary","state":"default"}'>
  <TeamButton variant="primary" />
</div>
```

When the user clicks inside a **specific variant**, the system adds **conditional logic instructions** to the LLM prompt:

```
CRITICAL - Variant-specific change: The user selected this element inside ONE variant only
(labeled "Primary / Default").
The preview grid shows multiple variants. You MUST add conditional logic so the change applies
ONLY when the component receives these variant props.
Props from selection: variant="primary", state="default".
Use normalized values for comparison (e.g. variant==='primary' && state==='default').
Render the new content ONLY when the condition matches. For ALL other variants, keep the
original content unchanged.
```

---

## Property Sidebar (Direct CSS Tweaks)

When an element is selected, a sidebar shows its computed styles. Users can directly edit:

| Property | Control |
|----------|---------|
| Text content | Textarea |
| Text color | Color picker |
| Background | Color picker |
| Font size | Dropdown |
| Font weight | Dropdown |
| Text align | Button group |
| Margin | Text input |
| Padding | Text input |

These changes are applied **instantly via postMessage** (no LLM call):

```js
// Parent sends to iframe:
iframe.postMessage({ type: 'updateElement', prop: 'fontSize', value: '20px' });

// Iframe applies:
selectedEl.style[prop] = value;
```

These are **live preview-only changes** — they don't persist to the code. Only the AI prompt path (refine) persists changes.

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Send entire code to LLM** (not just the selected element) | The LLM needs full context to make correct edits — CSS selectors reference classes used in JSX, component structure matters for layout changes. Sending a fragment would lose this context. |
| **LLM returns entire file** (not a diff) | Mitosis parser needs a complete file. Diffs are fragile and error-prone with LLMs. A complete file can be validated, parsed, and compiled. |
| **Path-based IDs** (not DOM indices) | Stable across re-renders. A tree path like `0-0-0-1-1` won't shift when siblings are reordered, unlike sequential indices. |
| **Element map stored in session** | Avoids re-parsing Mitosis AST on every refinement. Updated only when the AST changes. |
| **CSS safety net** | If LLM drops CSS during refinement, server re-injects the original. Prevents layout destruction. |
| **Multi-turn conversation** | Last 20 turns are kept so the LLM has context about previous changes the user requested. |

---

## File Reference

| File | Role |
|------|------|
| `src/web/server.ts` (line 460-603) | `POST /api/refine` endpoint — loads session, calls refine, updates state |
| `src/web/refine.ts` | Core engine — builds LLM messages with element targeting, parses response, compiles |
| `src/compile/element-mapping.ts` | `injectDataVeIds()` — walks Mitosis AST, assigns `data-ve-id`, builds elementMap |
| `src/web/preview.ts` (line 668-769) | Iframe script — hover/click detection, postMessage to parent, variant context lookup |
| `src/web/public/app.js` (line 200) | `selectedElementInfo` — global state holding clicked element info |
| `src/web/public/app.js` (line 2649) | `sendChatMessage()` — builds POST body with selectedElement context |
| `src/web/public/app.js` (line 4474) | `message` listener — receives `elementSelected` from iframe |
| `src/web/public/app.js` (line 4606) | Floating prompt — wraps user text as `"Modify the selected <tag>: ..."` |

---

## Concrete Example: "change button width to 137 x 48"

### What the user does:
1. Opens Visual Edit mode
2. Clicks the "We're hiring!" button in the preview
3. Types in floating prompt: `change button width to 137 x 48`
4. Presses Enter

### What the client sends:
```json
{
  "sessionId": "20260324-130004",
  "prompt": "Modify the selected button: change button width to 137 x 48",
  "selectedElement": {
    "dataVeId": "0-0-0-1-1",
    "tagName": "button",
    "textContent": "We're hiring!",
    "variantLabel": null,
    "variantProps": null
  },
  "chatHistory": []
}
```

### What the LLM receives (simplified):
```
[System] Mitosis rules... + Refinement rules...

[User] Here is the current component code:

<entire .lite.tsx file — ~80 lines of JSX>
---CSS---
<entire CSS — ~100 lines>

User request: Modify the selected button: change button width to 137 x 48

IMPORTANT - Element targeting: The user selected a specific element
in the preview (data-ve-id="0-0-0-1-1").
- Tag: <button>
- Path in component tree: 0-0-0-1-1
- className: team-section__button team-section__button--primary
- Current text: "We're hiring!"
Apply the requested changes to THIS element specifically.

Output the COMPLETE updated .lite.tsx file.
```

### What the LLM returns:
The entire `.lite.tsx` file with CSS, identical to the input except:
```css
.team-section__button--primary {
  width: 137px;
  height: 48px;    /* ← only this line added */
  ...
}
```

### What the server does with the response:
1. `parseMitosisCode()` → validates Mitosis AST
2. `injectDataVeIds()` → re-assigns `data-ve-id` to all elements, builds new elementMap
3. `generateFrameworkCode()` → compiles to React/Vue/Svelte/Angular/Solid
4. `injectCSS()` → embeds CSS into each framework output
5. Updates session state
6. Returns all framework outputs + new elementMap to client via SSE

### What the client does:
1. Stores new code in `currentFrameworkOutputs`
2. Updates Monaco editor tabs
3. Reloads preview iframe with updated React code
4. New `data-ve-id` attributes are rendered — user can select and edit again
