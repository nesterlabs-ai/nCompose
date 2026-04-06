# Release Readiness Report — Figma-to-Code Service

**Date:** 2026-04-06
**Branch:** `feat/chat-ui-upgrade`
**Domain:** `compose.nesterlabs.com`

---

## Service Overview

| Metric | Value |
|--------|-------|
| **API Endpoints** | 26 routes (GET, POST, DELETE) |
| **Frameworks** | React, Vue, Svelte, Angular, Solid |
| **LLM Providers** | DeepSeek (default), Claude, OpenAI |
| **Auth** | Cognito JWT (optional) + HMAC fingerprint cookies |
| **External Deps** | Figma API, DynamoDB, GitHub OAuth, Cognito |
| **Config Vars** | 50+ (all with defaults) |
| **Test Files** | 3 (~1,000 lines, ~15-20% coverage) |
| **Codebase** | ~10,000 LOC TypeScript + 7,000 LOC client JS |

---

## What's Working Well

- SSRF protection (Figma URL hostname whitelisting, HTTPS enforcement)
- XSS prevention (DOMPurify + escapeHtml on all innerHTML)
- Prompt injection defense (XML delimiter tags + NO_CHANGE sentinel)
- HMAC-signed fingerprint cookies (timing-safe verification)
- Cognito JWT verification
- Security headers (HSTS, X-Frame-Options, X-Content-Type-Options, COEP, COOP, Referrer-Policy)
- Rate limiting on conversion/refine (60/min global, 10/15min expensive)
- Session ownership (requireSessionOwner on all data endpoints)
- Path traversal protection on asset serving
- Structured logging with daily rotation
- Multi-stage Docker build (minimal production image)
- CI/CD pipeline (tests before deploy, rsync + docker compose)
- Disk-based session recovery after memory eviction
- LLM reasoning block logging for refine observability

---

## Issues by Priority

### CRITICAL — Must Fix Before Release

| # | Issue | File | Impact |
|---|-------|------|--------|
| 1 | Missing `.catch()` on `refineComponent()` promise | `server.ts:1201` | If LLM call fails, SSE heartbeat leaks, client gets no error, unhandled rejection |
| 2 | GitHub OAuth state never verified server-side | `server.ts:1735` | OAuth CSRF — attacker can link their GitHub to victim's session |
| 3 | No CORS policy | `server.ts` | Any malicious site can call API endpoints from user's browser |
| 4 | No CSRF protection on state-changing endpoints | `server.ts` | Cross-site forms can trigger conversions/refines |
| 5 | GitHub API routes have no auth or rate limiting | `server.ts` (`/api/github/*`) | Anyone can proxy GitHub operations through the server |

### HIGH — Should Fix Before Release

| # | Issue | File | Impact |
|---|-------|------|--------|
| 6 | GitHub redirect_uri not validated | `github.ts:54` | Accepts client-provided redirect_uri without whitelist |
| 7 | Free-tier race condition (TOCTOU) | `auth/middleware.ts` | Concurrent requests bypass quota (check and increment separated by ~200s) |
| 8 | 20+ raw `console.log` calls mixed with structured logger | `server.ts`, `auth/routes.ts`, `auth/middleware.ts`, `preview.ts` | Production logs split across two systems, inconsistent format |
| 9 | Unbounded session/token stores (no max capacity) | `server.ts` | DoS via session creation until OOM |
| 10 | Synchronous file I/O in request handlers | `server.ts` (`loadResultFromDisk`, asset serving) | Blocks event loop under load |
| 11 | No health check endpoint | — | No way to auto-detect or auto-recover from crashes |

### MEDIUM — Fix Soon After Release

| # | Issue | File | Impact |
|---|-------|------|--------|
| 12 | postMessage without origin validation (preview iframe) | `app.js` | Cross-origin window can send control messages |
| 13 | ZIP filename not sanitized (Content-Disposition header) | `server.ts` | Header injection risk |
| 14 | Recursive directory read without depth/size limits | `server.ts` | DoS via deeply nested project dirs |
| 15 | CSS injection via visualEdits (values with `}` can break out) | `server.ts` | Arbitrary CSS injection |
| 16 | Excessive GitHub OAuth scope (`repo` = full read/write ALL repos) | `github.ts` | Over-privileged access |
| 17 | No CSP header (intentional but risky) | `server.ts` | CDN compromise could inject scripts |
| 18 | Docker logs not persisted (no volume mount for `/app/logs`) | `docker-compose.yml` | Logs lost on container restart |
| 19 | No resource limits in docker-compose | `docker-compose.yml` | Runaway process can consume all memory/CPU |

### LOW — Nice to Have

| # | Issue | File | Impact |
|---|-------|------|--------|
| 20 | .env secrets in git history (4 commits, private repo) | git history | Rotate before making public |
| 21 | GitHub token in sessionStorage (XSS-accessible) | `app.js` | Mitigated by innerHTML XSS fix |
| 22 | `trust proxy` set after middleware | `server.ts` | First requests may see wrong IP |
| 23 | Auth token in JS global | `app.js` | Any script on page can access it |
| 24 | Ephemeral HMAC secret (random fallback if env not set) | `auth/middleware.ts` | Cookies invalidated on restart |
| 25 | Error messages may leak internal details in some paths | `server.ts` | Information disclosure |
| 26 | 42 `as any` casts (22 in server.ts) | `server.ts` | Type safety gap |
| 27 | No input length validation on request bodies | `server.ts` | Large payloads could cause issues |

---

## API Endpoint Map

### Authentication

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/auth/config` | GET | None | Public Cognito config for frontend SDK |
| `/api/auth/me` | GET | None | Current user info (auth'd or anonymous) |
| `/api/auth/free-tier` | GET | None | Usage info (used/limit/remaining) |
| `/api/auth/projects` | GET | `requireAuth` | List user's DynamoDB projects |
| `/api/auth/projects/sync` | POST | `requireAuth` | Merge localStorage projects to DynamoDB |
| `/api/auth/projects/:id` | DELETE | `requireAuth` | Delete a user project |
| `/api/auth/projects/:id/chat` | GET | `requireAuth` | Get chat history for a project |
| `/api/auth/projects/:id/chat` | PUT | `requireAuth` | Save chat history for a project |

### Core Pipeline

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/convert` | POST | `requireAuthOrFree` + `expensiveLimiter` | Main conversion (SSE stream) |
| `/api/refine` | POST | `requireAuthOrFree` + `expensiveLimiter` + `requireSessionOwner` | Iterative refinement/chat (SSE stream) |
| `/api/hero-chat` | POST | `requireAuthOrFree` | Landing page LLM assistant |

### Session & Files

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/save-file` | POST | `requireAuthOrFree` + `requireSessionOwner` | Save edited file content |
| `/api/session/:id/wired-app-files` | GET | `requireSessionOwner` | List all files in wired app directory |
| `/api/session/:id/push-files` | GET | `requireSessionOwner` | Get file list for GitHub push |
| `/api/download/:id` | GET | `requireAuth` + `requireSessionOwner` | ZIP download |
| `/api/preview/:id` | GET | `requireSessionOwner` | Standalone preview HTML |
| `/api/preview/:id/assets/:filename` | GET | `requireSessionOwner` | Serve SVG assets (DOMPurify sanitized) |

### Token & Config

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/store-token` | POST | None | Store Figma token server-side (24h TTL) |
| `/api/verify-token/:id` | GET | None | Check if stored token is still valid |
| `/api/config` | GET | None | Feature flags for client |

### GitHub Integration (NO AUTH — Issue #5)

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/github/oauth-url` | GET | **None** | Get GitHub OAuth authorization URL |
| `/api/github/exchange-code` | POST | **None** | Exchange OAuth code for access token |
| `/api/github/user` | GET | **None** | Get authenticated GitHub user info |
| `/api/github/repos` | GET | **None** | Get user's repositories |
| `/api/github/create-repo` | POST | **None** | Create a new GitHub repository |
| `/api/github/push` | POST | **None** | Push files to GitHub repository |
| `/auth/github/callback` | GET | **None** | OAuth callback handler |

---

## LLM Configuration

| Provider | Model | Max Tokens | Context Window | Temperature |
|----------|-------|-----------|----------------|-------------|
| DeepSeek (default) | `deepseek-chat` | 8,192 | 131,072 | 0.1 |
| Claude | `claude-sonnet-4-20250514` | 8,192 | 200,000 | 0.1 |
| OpenAI | `gpt-4o` | 16,384 | 131,072 | 0.1 |

All configurable via environment variables. All LLM calls wrapped with `withLogging()` for duration/size tracking.

---

## Deployment & Ops Readiness

| Category | Status | Notes |
|----------|--------|-------|
| CI/CD Pipeline | **DONE** | Tests run before deploy via GitHub Actions |
| Docker Build | **DONE** | Multi-stage, node:22-alpine |
| HTTPS (Caddy) | **DONE** | Auto-cert with Let's Encrypt |
| Structured Logging | **DONE** | Dual-output (terminal + daily file), tagged |
| Session Recovery | **DONE** | Disk fallback + `_session.json` owner persistence |
| DynamoDB Persistence | **DONE** | Projects, chat, free-tier (conditional on env var) |
| Documentation | **DONE** | README, CLAUDE.md, DEPLOYMENT, WORKFLOW, SECURITY-REVIEW |
| Health Check | **MISSING** | No `/health` endpoint |
| Error Alerting | **MISSING** | No Sentry/Datadog integration |
| Metrics | **MISSING** | No Prometheus endpoint |
| Log Persistence | **MISSING** | Not volume-mounted in docker-compose |
| Resource Limits | **MISSING** | No CPU/memory caps in docker-compose |
| Automated Backup | **MISSING** | Manual only |
| Test Coverage | **WEAK** | ~15-20%, security tests only |

---

## Scaling Capacity

| Load Level | Status | Notes |
|------------|--------|-------|
| 100 users/day | **Ready** | Single instance handles this easily |
| 500 users/day | **Ready** | With DynamoDB enabled for persistence |
| 5,000 users/day | **Needs Work** | Session store bounds + health checks required |
| 50,000+ users/day | **Not Ready** | Needs Redis, load balancer, worker queue |

### Current Bottlenecks

- In-memory session store — unbounded `Map`, no max capacity
- Single Lightsail instance — no horizontal scaling
- LLM latency — conversion takes ~200s per request
- Synchronous file I/O in some endpoints

---

## Recommended Fix Plan

### Phase 1: Blockers (1-2 days)

- [ ] Add `.catch()` to `refineComponent()` promise chain in `server.ts`
- [ ] Add CORS middleware (restrict to `compose.nesterlabs.com`)
- [ ] Add CSRF protection (validate Origin/Referer headers on POST/PUT/DELETE)
- [ ] Add `requireAuth` + rate limiter to all `/api/github/*` routes
- [ ] Fix GitHub OAuth state verification (store + verify server-side)
- [ ] Add `/health` endpoint returning `{ ok: true, timestamp }`

### Phase 2: Hardening (2-3 days)

- [ ] Add max capacity to session/token stores (evict oldest at 10,000)
- [ ] Replace all `console.log` with structured `log.*()` in `/src/web/`
- [ ] Add volume mount for logs in docker-compose (`./logs:/app/logs`)
- [ ] Add resource limits in docker-compose (CPU/memory)
- [ ] Validate GitHub redirect_uri against whitelist
- [ ] Add input length validation on POST bodies

### Phase 3: Post-Launch (1 week)

- [ ] Expand test coverage to ~70%
- [ ] Add Sentry/error alerting integration
- [ ] Convert synchronous file I/O to async
- [ ] Fix free-tier TOCTOU (atomic check-and-increment)
- [ ] Add Prometheus metrics endpoint
- [ ] Add automated DynamoDB backups

---

## Security Fixes Already Completed (17 items)

1. Predictable session IDs → `crypto.randomUUID()` (122-bit entropy)
2. Unauthenticated endpoints → `requireSessionOwner` on all session routes
3. Path traversal in asset serving → reject `..`, `/`, `\`
4. No rate limiting → Global (60/min) + Expensive (10/15min) + per-session cap
5. Missing security headers → HSTS, X-Frame-Options, COEP, etc.
6. XSS via innerHTML → `escapeHtml()` on all dynamic data
7. SVG-based XSS → DOMPurify + per-response CSP
8. LLM prompt injection → XML tags + NO_CHANGE sentinel
9. Free-tier bypass (fingerprint header) → HMAC-signed cookie only
10. Cookie security → HMAC-signed, `sameSite: lax`, `secure` dynamic
11. SSRF → Figma URL hostname + protocol validation
12. Audit logging → Structured dual-output logger
13. Console.log leaking code → Truncated to 80-100 chars
14. XSS in preview title → `escapeHtml()` on component name
15. Project delete not persisted → DELETE API + debounce cancel
16. SSE header crash → Early fingerprint capture before streaming
17. Session ownership bypass after memory eviction → `_session.json` persistence

---

## Conclusion

The core functionality and security foundations are solid. The **5 critical items** (missing catch, CORS, CSRF, GitHub auth, OAuth state) are the blockers for public release. Phase 1 is ~1-2 days of work, after which the service is ready for a controlled public launch with up to 500 daily active users.
