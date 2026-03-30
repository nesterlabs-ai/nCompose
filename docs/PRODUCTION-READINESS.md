# Production Readiness Review — Figma-to-Code Web Service

**Date:** 2026-03-26
**Status:** Pre-launch audit

---

## CRITICAL

### P1. No Graceful Shutdown (SIGTERM)

**File:** `src/web/server.ts:1145-1154`

No handler for SIGTERM/SIGINT signals. During Docker/Kubernetes rolling updates:
- Incoming SIGTERM is ignored
- Long-running SSE connections are abruptly terminated
- In-flight conversions lose progress
- Clients get `ERR_INCOMPLETE_CHUNKED_ENCODING`

**Action:**
```ts
process.on('SIGTERM', () => {
  console.log('[shutdown] Draining connections...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 30_000); // force after 30s
});
```

---

### P2. No Health Check Endpoint

No `/health` or `/readiness` endpoint for load balancers or Docker health checks. Cannot detect hung processes, memory leaks, or config errors at runtime.

**Action:**
- Add `GET /health` returning `{ status: 'ok', uptime, sessions, tokens }`
- Add Docker healthcheck:
```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
  interval: 30s
  timeout: 5s
  retries: 3
```

---

### P3. No Environment Variable Validation at Startup

Server starts successfully even if ALL API keys are missing (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `FIGMA_TOKEN`). Errors only surface when first conversion is attempted → client sees cryptic failure.

**Action:** Validate required env vars at startup. Exit with clear error if misconfigured:
```ts
function validateStartupEnv() {
  const hasLLMKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
  if (!hasLLMKey) {
    console.error('[startup] At least one LLM API key required');
    process.exit(1);
  }
}
validateStartupEnv();
```

---

## HIGH

### P4. No Request Logging

Only ~10 `console.log` calls in 1154 lines of server code. No structured logging with timestamps, request IDs, method, or status codes. Cannot diagnose production issues without SSH access.

**What's missing:**
- Request/response logging (method, path, status, duration)
- Error logging with context
- User/session tracking
- Slow request detection

**Action:** Add structured logging middleware:
```ts
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - start,
    }));
  });
  next();
});
```

Or use Winston/Pino for log levels, rotation, and external transport.

---

### P5. Unbounded In-Memory Maps

**File:** `src/web/server.ts:54-59`

`sessionStore` and `tokenStore` are unbounded `Map` objects with cleanup only every 10 minutes.

- Each `SessionEntry` can be ~MB (full result + conversation history)
- 1000 concurrent users over a week = potentially GBs
- No max capacity → OOMKilled container → restart → all data lost

**Action:**
1. Add hard limit: `MAX_SESSIONS = 1000`, `MAX_TOKENS = 5000`
2. Evict oldest entry when limit exceeded
3. Add memory monitoring: log Map sizes periodically
4. Consider Redis for multi-instance deployments

---

### P6. No Output Directory Cleanup

Every conversion creates a `ComponentName-sessionId/` directory in `web_output/`. No automatic pruning. Disk fills up over months of production use.

**Action:** Add daily cleanup of directories older than 30 days:
```ts
setInterval(() => {
  const dirs = readdirSync(outputDir, { withFileTypes: true });
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const stat = statSync(join(outputDir, d.name));
    if (Date.now() - stat.mtimeMs > 30 * 24 * 60 * 60 * 1000) {
      rmSync(join(outputDir, d.name), { recursive: true });
    }
  }
}, 24 * 60 * 60 * 1000);
```

---

### P7. No Response Compression

No `compression` middleware. JSON responses (50-200 KB) and static assets (`app.js` ~207 KB) sent uncompressed. ~60% larger payloads over slow networks.

**Action:** Either:
- Express: `app.use(compression())`
- Caddy: add `encode gzip` to Caddyfile

---

## MEDIUM

### P8. Static Assets Have No Cache Headers

**File:** `src/web/server.ts:241`

```ts
app.use(express.static(join(__dirname, 'public')));
```

No cache control headers. Every page reload re-downloads all JS/CSS. Slower load times, higher bandwidth.

**Action:** Add `maxAge` to static middleware:
```ts
app.use(express.static(join(__dirname, 'public'), { maxAge: '1d' }));
```

---

### P9. Process Continues After Fatal Errors

**File:** `src/web/server.ts:34-39`

```ts
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception (process kept alive):', err);
});
```

Keeps process alive after fatal errors. Can mask corruption, memory leaks, and broken invariants.

**Action:** Log error, then schedule graceful exit:
```ts
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
  setTimeout(() => process.exit(1), 5000); // drain, then exit
});
```

---

### P10. Request Timeout Disabled

**File:** `src/web/server.ts:1153`

```ts
server.requestTimeout = 0; // disabled for SSE
```

Disables ALL request timeouts, not just SSE. A hung conversion or malformed Figma file can tie up the server indefinitely.

**Action:** Use per-route timeout middleware instead:
```ts
app.post('/api/convert', withTimeout(15 * 60 * 1000), ...);
app.post('/api/refine', withTimeout(10 * 60 * 1000), ...);
// Keep default timeout for other routes
```

---

### P11. No Max Concurrent SSE Connections

SSE connections kept alive with 15s heartbeats. No limit on concurrent connections. Attacker can open thousands of connections → exhaust file descriptors → crash.

**Action:**
```ts
let activeSSE = 0;
const MAX_SSE = 100;

app.post('/api/convert', (req, res) => {
  if (activeSSE >= MAX_SSE) {
    return res.status(503).json({ error: 'Server busy, try again later' });
  }
  activeSSE++;
  res.on('close', () => activeSSE--);
  // ...
});
```

---

### P12. DynamoDB Connection Not Optimized

**File:** `src/web/db/dynamo-client.ts`

Singleton pattern is used (good), but no explicit connection pool tuning. Under load, connection pool exhaustion is possible.

**Action:** Add `maxAttempts` and timeout config:
```ts
const clientConfig = {
  region: config.dynamo.region,
  maxAttempts: 3,
  requestHandler: { connectionTimeout: 5000, socketTimeout: 5000 },
};
```

---

### P13. No API Versioning

Routes like `/api/convert`, `/api/refine` have no version prefix. Breaking changes affect all clients immediately.

**Action:** Use `/api/v1/convert` for versioning.

---

## LOW

| # | Issue | Notes |
|---|-------|-------|
| P14 | No error alerting | No integration with PagerDuty, Slack, etc. for critical errors |
| P15 | No metrics/monitoring | No Prometheus, CloudWatch, or similar. Can't track conversion rates, latency, error rates |
| P16 | Single process | No Node.js cluster mode or PM2. Single CPU core used |
| P17 | No CDN for static assets | JS/CSS served from application server directly |
| P18 | Caddyfile missing `encode gzip` | No compression at reverse proxy level |

---

## Production Launch Checklist

| Item | Status | Priority |
|------|--------|----------|
| Graceful shutdown (SIGTERM) | Missing | CRITICAL |
| Health check endpoint | Missing | CRITICAL |
| Env var validation at startup | Missing | CRITICAL |
| Structured request logging | Missing | HIGH |
| In-memory store bounds | Missing | HIGH |
| Output directory cleanup | Missing | HIGH |
| Response compression | Missing | HIGH |
| Static asset caching | Missing | MEDIUM |
| Fatal error handling | Needs fix | MEDIUM |
| Per-route request timeouts | Missing | MEDIUM |
| Max SSE connections | Missing | MEDIUM |
| DynamoDB pool tuning | Missing | MEDIUM |
| API versioning | Missing | MEDIUM |
| Error alerting | Missing | LOW |
| Metrics/monitoring | Missing | LOW |
| Cluster mode | Missing | LOW |

---

## Action Plan

### Before launch (1-2 days)

1. Add SIGTERM graceful shutdown handler
2. Add `GET /health` endpoint
3. Add Docker healthcheck to `docker-compose.yml`
4. Add env var validation at startup
5. Add structured request logging middleware
6. Add `compression()` middleware

### First week in production

7. Bound in-memory stores (max capacity + eviction)
8. Add output directory cleanup (30-day TTL)
9. Add static asset cache headers
10. Fix fatal error handling (graceful exit)
11. Add per-route request timeouts
12. Add max SSE connection limit

### Next sprint

13. API versioning (`/api/v1/`)
14. Metrics/monitoring (Prometheus or CloudWatch)
15. Error alerting (Slack/PagerDuty)
16. DynamoDB connection tuning
17. Cluster mode or PM2 for multi-core
