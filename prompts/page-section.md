## Page Section Context

You are generating ONE SECTION of a multi-section landing page. This section will be combined with other sections into a single page component.

### Section Rules

1. **Purely static content** — do NOT use `useStore`, `Show`, `For`, or any props. Everything is hardcoded.
2. **Use BEM class names** prefixed with the section name (e.g. `"hero__title"`, `"hero__cta-button"`)
3. **Do NOT add a page-level wrapper** — output only the section's inner content (no outer `<div class="page">`)
4. **Use semantic HTML** — `<header>`, `<section>`, `<footer>`, `<nav>`, `<h1>`-`<h6>`, `<p>`, `<button>`, `<a>`, `<img>`, `<ul>`, `<li>` as appropriate
5. **The root element** of your section should use the section's BEM base class (e.g. `<section class="hero">`)
6. **All CSS goes after the `---CSS---` delimiter** — same as the base rules
7. **Do NOT import anything from @builder.io/mitosis** — pure static JSX only
