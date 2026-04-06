# Security Review — Figma-to-Code Web Service

**Date:** 2026-04-02 (updated)
**Branch:** `feat/chat-ui-upgrade`
**Status:** Post-launch — critical and high-priority items fixed, remaining items tracked below

---

## Fixed Issues

### 1. ~~Predictable Session IDs (IDOR)~~ — FIXED

**File:** `src/utils/session-id.ts`

`generateSessionId()` uses `crypto.randomUUID()` — 122 bits of entropy. Brute-force infeasible.

---

### 2. ~~Unauthenticated Endpoints~~ — FIXED

All session endpoints now have `requireSessionOwner` middleware:

| Endpoint | Auth | Owner Check |
|----------|------|:-----------:|
| `POST /api/refine` | `requireAuthOrFree` + `expensiveLimiter` | YES |
| `POST /api/hero-chat` | `requireAuthOrFree` | YES |
| `GET /api/session/:id/wired-app-files` | — | YES |
| `GET /api/session/:id/push-files` | — | YES |
| `POST /api/save-file` | `requireAuthOrFree` | YES |
| `GET /api/preview/:id` | — | YES |
| `GET /api/preview/:id/assets/:filename` | — | YES |
| `GET /api/download/:id` | `requireAuth` | YES |

---

### 3. ~~Path Traversal in Asset Serving~~ — FIXED

**File:** `src/web/server.ts`

Asset route rejects filenames containing `..`, `/`, or `\` with 400 before any file I/O. Also gated by `requireSessionOwner`.

---

### 4. ~~No Rate Limiting~~ — FIXED

Three layers:

| Layer | Scope | Limit |
|-------|-------|-------|
| **Global** (`express-rate-limit`) | All `/api/*`, per IP | 60 req / 60s |
| **Expensive** (`express-rate-limit`) | `/api/convert` + `/api/refine`, per IP | 10 req / 15min |
| **Per-session refine cap** | Per session | 20 free / 50 auth |

Standard `RateLimit-*` headers (`draft-7`). All limits configurable via `RATE_LIMIT_*` env vars.

---

### 5. ~~Security Headers~~ — FIXED

**File:** `src/web/server.ts`

Applied via middleware on all responses:
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `X-XSS-Protection: 0` (disabled — can introduce vulnerabilities in modern browsers)
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-DNS-Prefetch-Control: off`
- `X-Download-Options: noopen`
- `X-Permitted-Cross-Domain-Policies: none`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `Cross-Origin-Opener-Policy: same-origin` (for SharedArrayBuffer/WebContainer)
- `Cross-Origin-Embedder-Policy: credentialless` (for SharedArrayBuffer/WebContainer)

CSP intentionally omitted — app depends on external CDNs (unpkg, StackBlitz WebContainer).

---

### 6. ~~XSS via innerHTML~~ — FIXED

**File:** `src/web/public/app.js`

`escapeHtml()` applied to all dynamic data rendered via `innerHTML`: project names, file paths, error messages, dropdown items.

---

### 7. ~~SVG-Based XSS~~ — FIXED

**File:** `src/web/server.ts`

SVG assets sanitized via `isomorphic-dompurify` with `USE_PROFILES: { svg: true, svgFilters: true }`. Strips `<script>`, event handlers, `javascript:` URIs. Per-response CSP: `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`.

---

### 8. ~~LLM Prompt Injection~~ — FIXED

**Files:** `src/web/refine.ts`, `src/web/server.ts`

- User input wrapped in XML delimiter tags: `<user_request>` (refinement/visual edit) and `<user_message>` (hero chat)
- System prompts instruct LLM to treat tag contents as opaque data
- `NO_CHANGE` sentinel guard: if LLM returns "NO_CHANGE", server returns existing code unchanged
- Hero chat: `role=system` messages from client history filtered out (only `user`/`assistant` pass through)

---

### 9. ~~Free-Tier Bypass (Fingerprint Header)~~ — FIXED

**Files:** `src/web/auth/middleware.ts`, `src/web/server.ts`

- `x-fingerprint` header is **no longer trusted** — was client-controlled and trivially spoofable
- Only the HMAC-signed server cookie (`ftfp`) is authoritative for quota enforcement
- `requireSessionOwner` verifies fingerprint via `verifySignedFingerprint()` on the cookie, not the header
- IP-based tracking (`ipUsageMap` + DynamoDB `IP#<addr>`) provides secondary signal
- Abuse attempts logged via structured logger

---

### 10. ~~Cookie Security~~ — FIXED

**File:** `src/web/auth/middleware.ts`

- `secure` flag: dynamic (`req.secure || x-forwarded-proto === 'https'`)
- `sameSite: 'lax'` — kept as-is (`'strict'` breaks external link navigation)
- Expiry: 90 days (configurable via `FINGERPRINT_COOKIE_MAX_AGE_MS`)
- **HMAC-signed** (`uuid.hmac_sha256`) — forging requires `FINGERPRINT_SECRET`
- `crypto.timingSafeEqual` prevents timing attacks on signature verification

---

### 11. ~~SSRF~~ — FIXED

**File:** `src/utils/figma-url-parser.ts`

`parseFigmaUrl()` validates:
- Protocol must be HTTPS
- Hostname must be `figma.com` or `www.figma.com`
- Path must contain `/file/` or `/design/`
- `node-id` format validated to strict `digits:digits`

---

### 12. ~~Audit Logging~~ — FIXED

**File:** `src/web/logger.ts`

Dual-output structured logger (terminal + daily rotating file `logs/server-YYYY-MM-DD.log`). Tags: `convert`, `refine`, `llm`, `free-tier`, `auth`, `server`, `hero-chat`. All LLM calls logged via `withLogging()` wrapper.

---

### 13. ~~Console.log Leaking Code~~ — FIXED

LLM response logging truncated to 80-100 chars. Uses structured logger instead of raw `console.log`.

---

### 14. ~~XSS in Preview Title~~ — FIXED

**File:** `src/web/preview.ts`

Component names from Figma were injected unescaped into the preview `<title>` tag. Added `escapeHtml()` to sanitize `&`, `<`, `>`, `"` before interpolation.

---

### 15. ~~Project Delete Not Persisted~~ — FIXED

**File:** `src/web/public/app.js`

- `deleteProject()` now calls `DELETE /api/auth/projects/:id` for authenticated users (removes from DynamoDB)
- Cancels pending `debouncedPersistProject` timer (`clearTimeout(_syncDebounceTimer)`) that could re-create the project after deletion

---

### 16. ~~SSE Header Crash~~ — FIXED

**File:** `src/web/server.ts`

`getFingerprint(req, res)` was called after SSE streaming started, causing `Cannot set headers after they are sent to the client`. Fixed by capturing the fingerprint **before** SSE headers are set (`earlyFingerprint`).

---

### 17. ~~Session Ownership Bypass After Memory Eviction~~ — FIXED

**File:** `src/web/server.ts`

After in-memory sessions expired (1hr TTL), disk-loaded sessions had no owner info — anyone with the sessionId could access them.

- `_session.json` is now written alongside output files with `ownerFingerprint` and `ownerSub`
- `loadResultFromDisk()` reads `_session.json` and attaches owner info to re-hydrated sessions
- `requireSessionOwner` and `getSessionWithDiskFallback` pass persisted owner on re-hydration
- Legacy sessions (no `_session.json`) still allowed through temporarily — phases out as old output dirs are cleaned

---

## Open Issues

### HIGH

#### 18. No CORS Policy

No explicit CORS middleware. Relies on implicit same-origin restrictions.

**Risk:** Any malicious site can call API endpoints if user has an active session.

**Action:** Add `cors()` middleware restricted to production domain (`compose.nesterlabs.com`).

---

#### 19. No CSRF Protection

State-changing POST endpoints (`/api/convert`, `/api/refine`, `/api/hero-chat`, `/api/save-file`) have no CSRF token validation.

**Risk:** Cross-site forms can trigger conversions on behalf of a logged-in user.

**Action:** Add CSRF token middleware or validate `Origin`/`Referer` headers on state-changing requests.

---

#### 20. Docker Runs as Root

**File:** `Dockerfile`

Container runs as `root`. If compromised, attacker has full system access.

**Action:** Add `USER` directive after build steps.

---

#### 21. GitHub OAuth — No Server-Side State Verification

**Files:** `src/web/github.ts`, `src/web/server.ts`

OAuth `state` param is generated but never stored/verified server-side. Client-side validation provides no CSRF protection. Also, `redirect_uri` is accepted from the client without validation.

**Risk:** OAuth CSRF attack — attacker can link their GitHub account to victim's session. Arbitrary `redirect_uri` can steal OAuth codes.

**Action:** Store `state` server-side, verify on exchange. Validate `redirect_uri` against a whitelist or construct it server-side.

---

#### 22. GitHub API Routes Have No Auth Middleware

**File:** `src/web/server.ts`

All `/api/github/*` endpoints (oauth-url, exchange-code, user, repos, create-repo, push) have no `requireAuth` or `requireAuthOrFree` middleware.

**Risk:** Anyone can proxy GitHub API operations through these endpoints.

**Action:** Add `requireAuth` to all GitHub API routes.

---

#### 23. Free-Tier Race Condition (TOCTOU)

**Files:** `src/web/auth/middleware.ts`, `src/web/server.ts`

Quota check (`getFreeTierInfo`) and increment (`incrementFreeTierUsage`) are separated by the full conversion duration (~200s). Concurrent requests all pass the check.

**Risk:** An attacker fires 10+ simultaneous requests and gets unlimited free conversions.

**Action:** Atomic check-and-increment — increment first with a DynamoDB conditional expression, roll back if conversion fails.

---

### MEDIUM

#### 24. postMessage Without Origin Validation (Partial)

- GitHub OAuth handler validates origin — **OK**
- Visual edit iframe messages do **NOT** validate origin — preview iframe accepts `postMessage` from `'*'`

**Risk:** Any cross-origin window can send control messages to the preview iframe (DOM mutations, style changes).

**Action:** Validate `e.origin` against expected origin in all `postMessage` listeners. Send to specific origin, not `'*'`.

---

#### 25. Unbounded In-Memory Stores (OOM DoS)

**File:** `src/web/server.ts`

`sessionStore` and `tokenStore` are unbounded `Map` objects. Cleanup runs every 10 minutes (TTL-based), but no max capacity protection.

**Risk:** Attacker creates many sessions until server OOMs.

**Action:** Add max capacity (e.g., 10,000 sessions). Evict oldest when full.

---

#### 26. ZIP Filename Not Sanitized

**File:** `src/web/server.ts`

`result.componentName` used directly in `Content-Disposition` header without sanitization. Special characters (quotes, newlines) could cause header injection.

**Action:** Sanitize with `/[^a-zA-Z0-9-_.]/g` → `'_'` or properly quote per RFC 6266.

---

#### 27. Recursive Directory Read Without Limits

**File:** `src/web/server.ts`

`readDirToFilesMap()` recursively reads all files with no depth or size limit.

**Risk:** DoS via deeply nested or very large project directories.

**Action:** Add max depth (10 levels), max file size (10MB), max total size (100MB).

---

#### 28. NPM Dependency Vulnerabilities

Known vulnerable packages (as of 2026-03-27):
- `undici` — HTTP smuggling, memory exhaustion (HIGH)
- `hono` — cookie injection, arbitrary file access (HIGH)
- `minimatch`/`picomatch` — ReDoS (HIGH)
- `express-rate-limit` — IPv4-mapped IPv6 bypass (HIGH)

**Action:** Run `npm audit fix`. Re-audit periodically.

---

#### 29. CSS Injection via visualEdits

**File:** `src/web/server.ts`

`applyVisualEditsToCSS()` concatenates user-provided CSS values directly (e.g., `${kebabProp}: ${value};`). Values containing `}` can inject arbitrary CSS rules.

**Action:** Validate CSS values don't contain `{`, `}`, or `;` outside of expected patterns.

---

#### 30. Excessive GitHub OAuth Scope

**File:** `src/web/github.ts`

Requests `repo` scope (full read/write to ALL repositories). App only needs push/create.

**Action:** Use `public_repo` or fine-grained GitHub App permissions.

---

### LOW

| # | Issue | Location | Notes |
|---|-------|----------|-------|
| 31 | Secrets in `.env` git history | `.env` + git history | Committed in 4 early commits on `fix/figma-api-extraction` and `feat/design-to-code-1` branches. Repo is private. Rotate keys before making public. Purge with `git filter-repo`. |
| 32 | Error messages leak internal details | `server.ts` | Main error handler returns generic message. GitHub API errors and file save errors still pass through unredacted. |
| 33 | GitHub token in sessionStorage | `app.js` | Vulnerable to XSS exfiltration (mitigated by innerHTML XSS fix). Consider storing server-side only. |
| 34 | `requestTimeout: 0` | `server.ts` | Intentionally disabled for SSE streams. Creates slow-client DoS risk but required for long-running conversions. |
| 35 | Caddyfile missing security headers | `Caddyfile` | Defense-in-depth — app-level headers cover this, but Caddy-level headers would protect non-app routes. |
| 36 | Ephemeral HMAC fingerprint secret | `middleware.ts` | Falls back to random secret if `FINGERPRINT_SECRET` not set. Cookies invalidated on restart. Set in production env. |
| 37 | `trust proxy` set after middleware | `server.ts` | `app.set('trust proxy')` is set after `attachUser` middleware. First requests may see wrong IP. |
| 38 | Cognito auth token in JS global | `app.js` | `authIdToken` accessible to any script on the page. Consider HttpOnly cookie approach. |

---

## Summary

| Status | Count | Items |
|--------|-------|-------|
| **Fixed** | 17 | Session IDs, session auth, path traversal, rate limiting, security headers, XSS (innerHTML + preview title), SVG XSS, prompt injection, fingerprint header bypass, cookie security, SSRF, audit logging, console log leak, project delete persistence, SSE header crash, session ownership on disk |
| **Open — High** | 6 | CORS, CSRF, Docker non-root, GitHub OAuth CSRF + redirect, GitHub routes no auth, free-tier race condition |
| **Open — Medium** | 7 | postMessage origin, unbounded stores, ZIP filename, recursive dir read, NPM vulnerabilities, CSS injection via visualEdits, excessive GitHub OAuth scope |
| **Open — Low** | 8 | Secrets in git history, error leaking, GitHub token storage, request timeout, Caddyfile headers, ephemeral HMAC secret, trust proxy ordering, auth token in JS global |
