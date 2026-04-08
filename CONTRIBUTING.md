# Contributing to nCompose

Thank you for your interest in contributing to nCompose. This guide covers everything you need to get started.

## Development Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/nesterlabs-ai/nCompose.git
   cd nCompose
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Set up environment variables**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and fill in at least:
   - `FIGMA_TOKEN` — your [Figma Personal Access Token](https://www.figma.com/developers/api#access-tokens)
   - One LLM provider key: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `DEEPSEEK_API_KEY`

4. **Run the dev server**

   ```bash
   npm run dev -- serve     # Web UI at http://localhost:3000
   ```

   Or use the CLI directly:

   ```bash
   npm run dev -- convert "https://www.figma.com/design/XXXX/...?node-id=123-456" -f react
   ```

## Running Tests

nCompose uses [vitest](https://vitest.dev/) for testing.

```bash
npm test              # Run all tests once
npm run test:watch    # Watch mode
```

## Branch Naming

Use the following prefixes:

| Prefix | Purpose |
|--------|---------|
| `feat/` | New features |
| `fix/` | Bug fixes |
| `docs/` | Documentation changes |
| `chore/` | Maintenance, refactoring, CI |

Example: `feat/tailwind-output-mode`, `fix/svg-dedup-color`

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add Tailwind utility class output mode
fix: handle multi-color SVG deduplication correctly
docs: update LLM provider table with new models
chore: upgrade vitest to v4
```

## Pull Request Process

1. **Open an issue first** — describe the bug or feature before starting work. This avoids duplicate effort and lets maintainers provide early feedback.
2. **Create a branch** from `main` using the naming convention above.
3. **Make your changes** — keep PRs focused on a single concern.
4. **Fill out the [PR template](.github/PULL_REQUEST_TEMPLATE.md)** — link the issue with `Closes #N`.
5. **Ensure all tests pass** — run `npm test` before pushing.
6. **Request a review** — a maintainer will review your PR.

All PRs require a linked issue.

## Reporting Bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) to file a bug. Include:
- Steps to reproduce
- The Figma component type and variant details
- Which output framework you selected
- Your environment (OS, Node version, nCompose version, LLM provider)

## Requesting Features

Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md). Describe the problem you're trying to solve, not just the solution you want.

## Code Style

- **TypeScript** — all source code is in `src/`
- Follow existing patterns in the codebase
- No linter errors — the project uses TypeScript strict mode
- Keep imports organized and avoid unused variables

## Mitosis Component Rules

nCompose generates [Mitosis](https://github.com/BuilderIO/mitosis) `.lite.tsx` components that compile to multiple frameworks. If you're modifying the code generation pipeline, review the Mitosis rules in [CLAUDE.md](CLAUDE.md) — violating these rules causes compile failures. Key rules include:

- Use `class`, not `className`
- No `.map()` in JSX — use `<For each={...}>`
- No ternaries for JSX elements — use `<Show when={...}>`
- All numeric CSS values need units (`'16px'` not `16`)

## Questions?

Open a [discussion](https://github.com/nesterlabs-ai/nCompose/discussions) or comment on a related issue.
