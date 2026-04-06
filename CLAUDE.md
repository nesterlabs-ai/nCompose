# figma-to-code — CLAUDE.md

Read `SERVICE-REFERENCE.txt` for doc pointers. All config defaults are in `src/config.ts`.

---

## Mitosis Rules (Critical)

Violating any of these causes a compile/parse failure:

- **Use `class`, not `className`**
- **`css={state.X}` does NOT work** — PATH A uses `class={state.classes}` with a `useStore` getter
- **`css={{}}` values must be plain string literals** — no expressions, ternaries, variables, or template literals
- **No `.map()` in JSX** — use `<For each={...}>{(item) => (...)}</For>`
- **No ternaries for JSX elements** — use `<Show when={...}>...</Show>`
- **State variable must be named `state`** — `const state = useStore(...)`
- **Event handler param must be named `event`**
- **All numeric CSS values need units** — `'16px'` not `16`

### Mitosis Generator Config

| Framework | Config |
|-----------|--------|
| React | `componentToReact({ stateType: 'useState', stylesType: 'style-tag' })` |
| Vue | `componentToVue({ api: 'composition' })` |
| Svelte | `componentToSvelte({ stateType: 'variables' })` |
| Angular | `componentToAngular({ standalone: true })` |
| Solid | `componentToSolid({ stateType: 'store', stylesType: 'style-tag' })` |

---

## BEM Class Convention (PATH A)

```
.component-name              base — default variant + default state
.component-name--primary     prop axis modifier (diff from default)
.component-name:hover        interactive state (diff from default)
.component-name[data-error]  boolean state modifier
.component-name__label       named child element
```

CSS injection per framework:
- **React/Solid**: `<style>{\`css\`}</style>` before last `</>`
- **Vue**: `<style scoped>` section
- **Svelte**: `<style>` section
- **Angular**: `styles: [\`css\`]` in `@Component`

---

## Figma Data Patterns

- **Variant names**: `"Style=Primary, State=Default, Size=Medium"` — split on `,` then `=`
- **Compound states**: `"Error-Hover"`, `"Filled in - Hover"` — split on ` - ` first, then `-`
- **State axis detection**: axis named `"State"` exactly, or heuristic (2+ values match `STATE_KEYWORDS`)
- **`_` prefixed nodes** with no children/text are filtered from LLM prompts

---

## Security Patterns (do not weaken)

- **SSRF**: `parseFigmaUrl()` validates hostname is `figma.com`, enforces HTTPS
- **SVG XSS**: DOMPurify + per-response CSP (`default-src 'none'`) on SVG endpoints
- **XSS**: `escapeHtml()` on all `innerHTML`; `textContent` for error messages
- **Prompt injection**: XML delimiter tags (`<user_request>`, `<user_message>`) on all LLM inputs; `NO_CHANGE` sentinel in refinement
- **Security headers**: HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, COOP, COEP
- **Rate limiting**: Global (60/min) + expensive-op (10/15min) via `express-rate-limit`
- **Path traversal**: Asset filenames reject `..`, `/`, `\`
- **Auth**: Cognito JWT verification; HMAC fingerprint cookies with `crypto.timingSafeEqual`

---

## Known Pre-existing TS Errors (do not fix)

1. `src/compile/generate.ts:41` — `stateType: 'store'` not in `ToSolidOptions` type (works at runtime)
2. `src/figma/simplify.ts:26` — `@figma/rest-api-spec` version mismatch between packages
3. `src/verify-imports.ts:7` — `collapseSvgContainers` not exported from `figma-developer-mcp`
