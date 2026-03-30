# Open-Source Readiness Review — Figma-to-Code

**Date:** 2026-03-26
**Status:** NOT READY — Critical blockers must be resolved first

---

## Critical Blockers

### OS1. Live Secrets on Disk

**Files:** `.env`, `.credentials`

Both files contain **active production keys** on disk:
- Figma PAT (`figd_...`)
- Anthropic API key (`sk-ant-...`)
- OpenAI API key (`sk-proj-...`)
- DeepSeek API key (`sk-...`)
- AWS IAM credentials (`AKIA...` + secret)
- Cognito User Pool ID + Client ID
- DynamoDB table name + region

Even though `.gitignore`'d, they exist on disk. If the repo is ever made public (even briefly), all keys are compromised.

**Action:**
1. **Rotate ALL secrets immediately** before any public push
2. Delete `.env` and `.credentials` from disk
3. Audit git history: `git log -p --all -- .credentials .env`
4. If ever committed, scrub with `git filter-repo`
5. Verify `.env.example` has only placeholders (it does — confirmed)

---

### OS2. Internal Infrastructure Exposed in Docs

**File:** `docs/DEPLOYMENT.md`

Contains production deployment details that should NOT be public:

| Exposed Info | Risk |
|-------------|------|
| Lightsail instance region + config | Targeted attacks |
| DynamoDB table name: `figma-to-code` | Direct table access if AWS keys leaked |
| IAM user: `figma-to-code-dynamo` | User enumeration |
| AWS region: `us-west-2` | Narrows attack surface |
| DNS config for `compose.nesterlabs.com` | Domain takeover research |
| CI/CD pipeline structure | Supply chain attack vector |
| Free-tier conversion limits | Business logic abuse |

**Action:** Move `docs/DEPLOYMENT.md` to a private wiki. Replace with a generic "How to Deploy Your Own Instance" guide using placeholder values.

---

### OS3. Security Vulnerability Documentation

**File:** `docs/SECURITY-REVIEW.md`

Lists 25 unfixed vulnerabilities with exact file paths, line numbers, and proof-of-concept attack examples. This is a roadmap for attackers.

**Action:** Fix all vulnerabilities first, then either:
- Remove this file from public repo, OR
- Convert to a public security posture document (what's protected, not what's broken)

---

### OS4. Unfixed Security Vulnerabilities

The following must be fixed before open-sourcing (see `docs/SECURITY-REVIEW.md` for details):

| Severity | Count | Key Issues |
|----------|-------|------------|
| CRITICAL | 4 | Predictable session IDs, unauthenticated endpoints, path traversal |
| HIGH | 8 | No rate limiting, missing headers, XSS, CORS, CSRF |
| MEDIUM | 6 | postMessage, cookie security, free-tier bypass |
| LOW | 7 | Error leaks, logging, timeouts |

An open-source repo with known critical vulnerabilities invites exploitation.

---

## Missing Required Files

### OS5. No LICENSE File

`package.json` has `"license": "MIT"` but there is no `LICENSE` file in the repo root. Many tools and platforms require the actual file.

**Action:** Create `LICENSE` with the standard MIT license text.

---

### OS6. No CONTRIBUTING.md

Contributors need guidance on:
- How to set up the dev environment
- How to run tests (`npm test`)
- Code style conventions
- Pull request process
- Issue reporting guidelines

**Action:** Create `CONTRIBUTING.md` covering:
```md
## Development Setup
1. Clone the repo
2. Copy `.env.example` to `.env` and fill in your keys
3. `npm install`
4. `npm run dev -- serve` (web UI) or `npm run dev -- convert ...` (CLI)

## Running Tests
npm test

## Pull Requests
- One feature/fix per PR
- Include tests for new functionality
- Run `npm run build` before submitting (must pass with no errors)

## Reporting Bugs
File a GitHub issue with steps to reproduce.
```

---

### OS7. No CODE_OF_CONDUCT.md

Standard for community-driven open-source projects. Establishes expectations for respectful collaboration.

**Action:** Adopt the [Contributor Covenant](https://www.contributor-covenant.org/) — widely used, well-understood.

---

### OS8. No SECURITY.md

No policy for responsible disclosure of security vulnerabilities.

**Action:** Create `SECURITY.md`:
```md
# Security Policy

## Reporting Vulnerabilities

Please report security issues privately via email to security@nesterlabs.com.

Do NOT file public GitHub issues for security bugs.

## Response Time
- Acknowledgment: within 48 hours
- Fix timeline: depends on severity (critical: 7 days, high: 30 days)

## Scope
- Web service endpoints
- Client-side code (XSS, injection)
- Authentication/authorization
- Data exposure
```

---

## Source Code Review

### What's Good

| Item | Status |
|------|--------|
| No hardcoded API keys in `src/` | All env-based |
| `.env.example` with placeholders | Correct |
| `.gitignore` excludes secrets, builds, output | Correct |
| README.md | Well-written, 274 lines, clear setup |
| CLAUDE.md | Detailed architecture docs |
| Config is environment-based | `src/config.ts` uses `envStr/envInt/envBool` |

### Internal References to Remove/Generalize

| Item | Location | Action |
|------|----------|--------|
| `compose.nesterlabs.com` | `docs/DEPLOYMENT.md` | Move to private |
| AWS account details | `docs/DEPLOYMENT.md` | Move to private |
| Cognito pool IDs | `.credentials` | Delete file |
| DynamoDB table name | `.credentials`, `docs/DEPLOYMENT.md` | Remove/generalize |
| NesterLabs contact modal | `src/web/public/app.js` | Keep or generalize |

---

## Dependency Audit

### NPM Vulnerabilities

Run `npm audit` before open-sourcing. Known issues:

| Package | Severity | Issue |
|---------|----------|-------|
| `undici` | HIGH | HTTP smuggling, memory exhaustion |
| `hono` | HIGH | Cookie injection, arbitrary file access |
| `minimatch`/`picomatch` | HIGH | ReDoS |
| `express-rate-limit` | HIGH | IPv4-mapped IPv6 bypass |
| `svelte` | MODERATE | XSS during SSR |

**Action:** `npm audit fix` + manual updates for remaining issues.

### License Compatibility

All dependencies should be MIT/Apache-2.0/ISC compatible with MIT license. Verify with:
```bash
npx license-checker --summary
```

---

## Docker

### Current State

- Multi-stage build (good)
- Alpine base (good)
- Production deps only in final stage (good)
- Runs as root (bad)

**Action:** Add non-root user:
```dockerfile
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs
```

---

## Open-Source Checklist

| Item | Status | Blocker? |
|------|--------|----------|
| Rotate all exposed secrets | NOT DONE | YES |
| Remove `.env` and `.credentials` from disk | NOT DONE | YES |
| Scrub secrets from git history | NEEDS CHECK | YES |
| Fix critical security vulnerabilities | NOT DONE | YES |
| Move `docs/DEPLOYMENT.md` to private | NOT DONE | YES |
| Remove/redact `docs/SECURITY-REVIEW.md` | NOT DONE | YES |
| Add `LICENSE` file | NOT DONE | YES |
| Add `CONTRIBUTING.md` | NOT DONE | Recommended |
| Add `CODE_OF_CONDUCT.md` | NOT DONE | Recommended |
| Add `SECURITY.md` | NOT DONE | Recommended |
| `npm audit fix` | NOT DONE | Recommended |
| Docker non-root user | NOT DONE | Recommended |
| License compatibility check | NOT DONE | Recommended |
| `.env.example` has only placeholders | DONE | - |
| `.gitignore` properly configured | DONE | - |
| No hardcoded secrets in source code | DONE | - |
| README is contributor-friendly | DONE | - |

---

## Action Plan

### Week 1 — Security Fixes (Must do before public)

1. Rotate ALL secrets (Figma, Anthropic, OpenAI, DeepSeek, AWS, Cognito)
2. Delete `.env` and `.credentials` from disk
3. Scrub git history with `git filter-repo`
4. Fix predictable session IDs → `crypto.randomUUID()`
5. Add auth to unauthenticated endpoints
6. Fix path traversal in asset serving
7. Add rate limiting, security headers, CORS
8. Fix XSS issues
9. `npm audit fix`

### Week 2 — Documentation & Files

10. Move `docs/DEPLOYMENT.md` to private wiki
11. Remove `docs/SECURITY-REVIEW.md` from public repo
12. Create `LICENSE` file (MIT)
13. Create `CONTRIBUTING.md`
14. Create `CODE_OF_CONDUCT.md`
15. Create `SECURITY.md`
16. Review all other docs for internal references
17. Docker non-root user
18. License compatibility check

### Week 3 — Final Review

19. Full security re-test (OWASP Top 10)
20. Dependency audit clean
21. Test contributor onboarding (fresh clone → working dev env)
22. Tag v1.0.0 release
23. Push to public GitHub
