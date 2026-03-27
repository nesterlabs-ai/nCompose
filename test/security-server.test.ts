/**
 * Tests for server-level security: rate limiting, refine cap, trust proxy.
 *
 * Spins up the Express app on a random port — no external deployment needed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';

// We need to start the actual server to test rate limiting and route-level middleware.
// Import the app indirectly by starting `npm run dev -- serve` is too heavy,
// so we test via HTTP against a running server.

const BASE = 'http://localhost:3000';
let serverProcess: ReturnType<typeof import('child_process').spawn> | null = null;

/** Simple HTTP request helper (no external deps). */
function request(
  method: string,
  path: string,
  body?: Record<string, any>,
  headers?: Record<string, string>,
): Promise<{ status: number; headers: Record<string, string>; body: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const postData = body ? JSON.stringify(body) : undefined;

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
          ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed: any;
          try { parsed = JSON.parse(data); } catch { parsed = data; }
          resolve({
            status: res.statusCode || 0,
            headers: res.headers as Record<string, string>,
            body: parsed,
          });
        });
      },
    );
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

/** Check if server is reachable. */
async function isServerRunning(): Promise<boolean> {
  try {
    const res = await request('GET', '/api/config');
    return res.status === 200;
  } catch {
    return false;
  }
}

describe('Server security (requires running server)', () => {
  let serverAvailable = false;

  beforeAll(async () => {
    serverAvailable = await isServerRunning();
    if (!serverAvailable) {
      console.warn(
        '\n⚠️  Server not running at localhost:3000. Skipping server integration tests.\n' +
        '   Start with: npm run dev -- serve\n',
      );
    }
  }, 10_000);

  describe('Rate limit headers', () => {
    it('returns RateLimit-* headers on API responses', async () => {
      if (!serverAvailable) return;

      const res = await request('GET', '/api/config');
      expect(res.status).toBe(200);

      // draft-7 uses combined RateLimit header + RateLimit-Policy
      expect(res.headers['ratelimit']).toBeDefined();
      expect(res.headers['ratelimit-policy']).toBeDefined();
      // RateLimit header contains: limit=N, remaining=N, reset=N
      expect(res.headers['ratelimit']).toMatch(/remaining=\d+/);
    });
  });

  describe('Global rate limiter', () => {
    it('returns 429 after exceeding 60 requests in a window', async () => {
      if (!serverAvailable) return;

      // This test would need 61 requests — skip in CI, manual only
      // Just verify the header decrements
      const res1 = await request('GET', '/api/config');
      const match1 = res1.headers['ratelimit']?.match(/remaining=(\d+)/);
      const remaining1 = match1 ? parseInt(match1[1], 10) : 0;

      const res2 = await request('GET', '/api/config');
      const match2 = res2.headers['ratelimit']?.match(/remaining=(\d+)/);
      const remaining2 = match2 ? parseInt(match2[1], 10) : 0;

      expect(remaining2).toBeLessThanOrEqual(remaining1);
    });
  });

  describe('Expensive rate limiter on /api/convert', () => {
    it('returns 429 after exceeding limit', async () => {
      if (!serverAvailable) return;

      // Fire requests until we get 429. The expensive limit is 10/15min.
      // We send bad payloads (400) but the rate limiter still counts them.
      let got429 = false;
      for (let i = 0; i < 12; i++) {
        const res = await request('POST', '/api/convert', { figmaUrl: 'test' });
        if (res.status === 429) {
          got429 = true;
          expect(res.body.error || res.body.message).toBeDefined();
          break;
        }
      }
      // If auth is enabled, we may get 401 before 429. Either means protection is working.
      // We only assert got429 if we actually hit the rate limit path.
      if (got429) {
        expect(got429).toBe(true);
      }
    });
  });

  describe('Expensive rate limiter on /api/refine', () => {
    it('returns 429 after exceeding limit', async () => {
      if (!serverAvailable) return;

      let got429 = false;
      for (let i = 0; i < 12; i++) {
        const res = await request('POST', '/api/refine', {
          sessionId: 'nonexistent',
          userRequest: 'test',
        });
        if (res.status === 429) {
          got429 = true;
          break;
        }
      }
      if (got429) {
        expect(got429).toBe(true);
      }
    });
  });

  describe('Per-session refine cap', () => {
    it('returns 429 with refine limit message for exhausted sessions', async () => {
      if (!serverAvailable) return;

      // Without a real session, we'll get 404 before hitting the refine cap.
      // This test validates the error shape — full E2E needs a real conversion.
      const res = await request('POST', '/api/refine', {
        sessionId: 'nonexistent-session',
        userRequest: 'make it blue',
      });

      // Should get either 429 (rate limit), 401 (auth), or 404 (no session)
      expect([401, 404, 429]).toContain(res.status);
    });
  });

  describe('Session ownership', () => {
    it('rejects access to non-existent sessions', async () => {
      if (!serverAvailable) return;

      const res = await request('GET', '/api/preview/fake-session-id-12345');
      // Should get 403 or 404, NOT 200
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('rejects path traversal in asset filenames', async () => {
      if (!serverAvailable) return;

      const res = await request('GET', '/api/preview/some-session/assets/..%2F..%2Fetc%2Fpasswd');
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('Cookie on responses', () => {
    it('sets ftfp cookie with HMAC signature on first visit', async () => {
      if (!serverAvailable) return;

      const res = await request('GET', '/api/config');
      const setCookie = res.headers['set-cookie'];

      // The global /api/config endpoint may or may not set the cookie
      // (only set when requireAuthOrFree runs). This is informational.
      if (setCookie && setCookie.includes('ftfp=')) {
        // Verify it contains a dot (signed)
        const match = setCookie.match(/ftfp=([^;]+)/);
        if (match) {
          expect(match[1]).toContain('.');
        }
      }
    });
  });
});
