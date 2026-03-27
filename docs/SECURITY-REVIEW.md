# Security Review — Figma-to-Code Web Service

**Date:** 2026-03-27 (updated)
**Branch:** `feat/chat-ui-upgrade`
**Status:** Pre-launch audit (updated after rate-limiting & abuse-prevention work)

---

## CRITICAL (Fix Before Launch)

### 1. Exposed Secrets in `.credentials` and `.env`

**Files:** `.credentials`, `.env`

Both files contain **live production secrets** on disk — Figma PAT, Anthropic API key, DeepSeek key, AWS credentials, Supabase keys. Even though `.gitignore`'d, they exist in the working tree and could be accidentally committed.

**Action:** Rotate ALL exposed keys immediately. Use environment-based secret management (AWS Secrets Manager, GitHub Secrets) for production. Never store secrets in files on disk.

---

### 2. ~~Predictable Session IDs (IDOR)~~ — FIXED

**File:** `src/utils/session-id.ts`

~~Session IDs are just timestamps: `YYYYMMDD-HHMMSS`. Only ~86,400 possible values per day.~~

**Fix applied:** `generateSessionId()` now uses `crypto.randomUUID()` — 122 bits of entropy.

---

### 3. ~~Unauthenticated Endpoints Expose All Sessions~~ — FIXED

~~Multiple endpoints accept any `sessionId` with no ownership check.~~

**Fix applied:** All session endpoints now have `requireSessionOwner` middleware:

| Endpoint | Auth | Owner Check |
|----------|------|:-----------:|
| `POST /api/refine` | `requireAuthOrFree` + `expensiveLimiter` | YES |
| `GET /api/session/:id/wired-app-files` | — | YES |
| `GET /api/session/:id/push-files` | — | YES |
| `POST /api/save-file` | `requireAuthOrFree` | YES |
| `GET /api/preview/:id` | — | YES |
| `GET /api/preview/:id/assets/:filename` | — | YES |
| `GET /api/download/:id` | `requireAuth` | YES |

Combined with `crypto.randomUUID()` session IDs (#2), brute-force is infeasible.

---

### 4. ~~Path Traversal in Asset Serving~~ — FIXED

**File:** `src/web/server.ts`

~~`filename` param is passed directly to `join()` without validation.~~

**Fix applied:** Asset route now rejects filenames containing `..`, `/`, or `\` with a 400 response before any file I/O. Route also gated by `requireSessionOwner`.

---

## HIGH (Fix Before Launch)

### 5. ~~No Rate Limiting~~ — FIXED (2026-03-27)

~~No rate limiting on any endpoint.~~

**Fix applied:** Three layers of rate limiting now in place:

| Layer | Scope | Limit |
|-------|-------|-------|
| **Global** (`express-rate-limit`) | All `/api/*` routes, per IP | 60 req / 60s |
| **Expensive** (`express-rate-limit`) | `/api/convert` + `/api/refine`, per IP | 10 req / 15min |
| **Per-session refine cap** | Per session | 20 free / 50 auth |

Standard `RateLimit-*` headers (`draft-7`) returned on all API responses. All limits configurable via environment variables (`RATE_LIMIT_GLOBAL_MAX`, `RATE_LIMIT_EXPENSIVE_MAX`, etc.).

**Remaining:** `/api/store-token` and `/api/verify-token` are covered by the global limiter but don't have dedicated expensive limits. Consider adding a tighter per-IP limit for token brute-force if needed.

---

### 6. Missing Security Headers

**File:** `src/web/server.ts:228-238`

Only COOP/COEP set (for WebContainer). Missing:

- `Content-Security-Policy` (XSS protection)
- `X-Frame-Options` (clickjacking)
- `X-Content-Type-Options: nosniff` (MIME sniffing)
- `Strict-Transport-Security` (HTTPS enforcement)
- `Referrer-Policy`

**Action:** Add all headers via middleware.

---

### 7. No CORS Policy

No explicit CORS middleware. Defaults to allowing all origins. Any malicious site can call your API endpoints.

**Action:** Add `cors()` middleware restricted to your production domain.

---

### 8. No CSRF Protection

State-changing POST endpoints (`/api/convert`, `/api/refine`, `/api/store-token`, `/api/save-file`) have no CSRF token validation. Cross-site forms can trigger conversions.

**Action:** Add CSRF token middleware or validate `Origin`/`Referer` headers.

---

### 9. XSS via innerHTML

**File:** `src/web/public/app.js:504`

```js
duplicateMessage.innerHTML = `<strong>${name}</strong> was already converted...`;
```

`project.name` (from Figma) is injected unescaped. A Figma file named `<img src=x onerror="alert(1)">` triggers XSS.

Also found in: custom dropdown rendering (lines 5422, 5437), error display in `preview.ts` (lines 572, 671).

**Action:** Use `escapeHtml(name)` everywhere innerHTML uses dynamic data.

---

### 10. SVG-Based XSS

**File:** `src/web/server.ts:1108-1125`

SVGs from Figma are served with `Content-Type: image/svg+xml` without sanitization. SVGs can contain `<script>` tags and event handlers.

**Action:** Sanitize SVG content — strip `<script>`, `onload`, `onerror`, etc. before serving.

---

### 11. LLM Prompt Injection

**File:** `src/web/server.ts:512-524, 541-554`

`buildFloatingEditPrompt()` and `buildVisualEditSavePrompt()` inject user-controlled data (`variantLabel`, `textContent`, CSS property values) directly into LLM prompts without escaping. Attacker can craft inputs to override LLM instructions and generate malicious code.

**Action:** Escape special characters in all user-controlled prompt values.

---

### 12. Unbounded In-Memory Stores (OOM DoS)

**File:** `src/web/server.ts:54-59`

`sessionStore` and `tokenStore` are unbounded `Map` objects. Attacker can create unlimited sessions/tokens until server runs OOM.

**Action:** Add max capacity (e.g., 1000 sessions, 5000 tokens). Evict oldest when full.

---

## MEDIUM

### 13. postMessage Without Origin Validation

**Files:** `src/web/preview.ts:755-826`, `src/web/public/app.js:4885,5125,5342`

Preview iframe accepts `postMessage` from **any origin** (`'*'`) and performs DOM mutations (delete elements, update styles). Any website can send messages to the iframe.

**Action:** Validate `e.origin` against expected origin. Send to specific origin, not `'*'`.

---

### 14. ~~Free-Tier Bypass~~ — FIXED (2026-03-27)

**File:** `src/web/auth/middleware.ts`

~~Usage tracked via fingerprint cookie. Attacker deletes cookie → gets new fingerprint → unlimited free conversions.~~

**Fix applied:** Multi-signal abuse prevention + HMAC-signed cookies:

- `ipUsageMap` (in-memory) + DynamoDB (`IP#<addr>` key) track per-IP conversion count
- `requireAuthOrFree` runs `Promise.all([getFreeTierInfo(fp), getIPUsageInfo(ip)])` — blocks if **either** signal exceeds the limit
- Clearing cookies no longer bypasses the quota (IP signal still blocks)
- Abuse attempts logged: `console.warn('[abuse] Blocked: fp=... ipUsed=... ip=...')`
- `/api/refine` now also gates on `requireAuthOrFree` + per-session refine cap (20 free / 50 auth)
- **HMAC-signed fingerprint cookies** (`uuid.hmac_sha256`) — forging a valid cookie requires the server secret (`FINGERPRINT_SECRET` env var). Invalid/unsigned cookies are rejected and re-issued. Uses `crypto.timingSafeEqual` to prevent timing attacks.

---

### 15. ~~Cookie Security~~ — FIXED (2026-03-27)

**File:** `src/web/auth/middleware.ts`

- ~~Missing `secure` flag~~ — **Fixed:** dynamic (`req.secure || x-forwarded-proto === 'https'`)
- `sameSite: 'lax'` — **Kept as-is.** `'strict'` would break external link navigation (Figma plugin redirects, email links). `'lax'` is the safe middle ground.
- ~~1-year expiry~~ — **Fixed:** reduced to 90 days (configurable via `FINGERPRINT_COOKIE_MAX_AGE_MS`)

---

### 16. NPM Dependency Vulnerabilities

`package.json` has known vulnerabilities:

- `undici` — HTTP smuggling, memory exhaustion (HIGH)
- `hono` — cookie injection, arbitrary file access (HIGH)
- `minimatch`/`picomatch` — ReDoS (HIGH)
- `express-rate-limit` — IPv4-mapped IPv6 bypass (HIGH)

**Action:** Run `npm audit fix`. Update vulnerable packages.

---

### 17. Docker Runs as Root

**File:** `Dockerfile`

Container runs as `root` — if compromised, attacker has full system access.

**Action:** Add `USER nodejs` directive after build steps.

---

### 18. Recursive Directory Read Without Limits

**File:** `src/web/server.ts:825-843`

`readDirToFilesMap()` recursively reads all files with no depth or size limit. Can be DoS'd with deeply nested or large project directories.

**Action:** Add max depth (5), max file size (10MB), max total size (50MB).

---

## LOW

| # | Issue | File |
|---|-------|------|
| 19 | Error messages leak internal paths/stack traces | `server.ts:481-492` |
| 20 | GitHub token stored in plain sessionStorage | `app.js:3829` |
| 21 | ZIP filename from Figma not sanitized (header injection) | `server.ts:768` |
| 22 | No audit logging for security events | `server.ts` (all) |
| 23 | `requestTimeout: 0` disables request timeout | `server.ts:1153` |
| 24 | Console.log leaks first 100 chars of React code | `server.ts:1062` |
| 25 | Caddyfile missing security headers (defense-in-depth) | `Caddyfile` |

---

## Priority Action Plan

### Completed

- [x] ~~Predictable session IDs~~ (#2 — `crypto.randomUUID()`)
- [x] ~~Unauthenticated endpoints~~ (#3 — `requireSessionOwner` on all session routes)
- [x] ~~Path traversal in asset serving~~ (#4 — rejects `..`, `/`, `\`)
- [x] ~~No rate limiting~~ (#5 — global + expensive + per-session refine cap)
- [x] ~~Free-tier bypass~~ (#14 — multi-signal: fingerprint + IP tracking + HMAC-signed cookies)
- [x] ~~Cookie security~~ (#15 — `secure` flag, HMAC signing, 90-day expiry)

### Before launch (this week)

1. Rotate all exposed secrets (#1)
2. Add security headers middleware (#6)
3. Fix innerHTML XSS — `escapeHtml()` (#9)
4. Add CORS restrictions (#7)

### Next sprint

5. CSRF protection (#8)
6. SVG sanitization (#10)
7. LLM prompt injection — escape user-controlled values (#11)
8. Bound in-memory stores (#12)
9. postMessage origin validation (#13)
10. `npm audit fix` (#16)
11. Docker non-root user (#17)
12. Recursive directory read limits (#18)
