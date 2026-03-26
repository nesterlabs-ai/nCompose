# Deployment Guide — compose.nesterlabs.com

> Last updated: 2026-03-23

---

## Architecture

```
User → https://compose.nesterlabs.com
         ↓ DNS (A record → Lightsail static IP)
         ↓ Port 443 (HTTPS) / Port 80 (redirects to 443)
┌─────────────────────────────────────────────────────────┐
│  AWS Lightsail Instance (us-west-2)                     │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Docker Compose                                   │  │
│  │                                                   │  │
│  │  ┌─────────────────────────────┐                  │  │
│  │  │  Caddy (caddy:2-alpine)     │                  │  │
│  │  │  Ports: 80, 443, 443/udp    │                  │  │
│  │  │  Auto Let's Encrypt SSL     │                  │  │
│  │  │  HTTP/2 + HTTP/3 (QUIC)     │                  │  │
│  │  └──────────┬──────────────────┘                  │  │
│  │             │ reverse_proxy                       │  │
│  │             ↓                                     │  │
│  │  ┌─────────────────────────────┐                  │  │
│  │  │  App (node:22-alpine)       │                  │  │
│  │  │  Express on port 3000       │                  │  │
│  │  │  Internal only (expose)     │                  │  │
│  │  └─────────────────────────────┘                  │  │
│  │                                                   │  │
│  │  Volumes:                                         │  │
│  │   • web_output  → /app/web_output (conversions)   │  │
│  │   • caddy_data  → /data (SSL certs)               │  │
│  │   • caddy_config → /config                        │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  Server path: /home/ubuntu/app/                         │
└─────────────────────────────────────────────────────────┘
         │
         ↓ AWS SDK calls (same region us-west-2)
┌─────────────────────────────────────────────────────────┐
│  AWS DynamoDB (us-west-2)                               │
│  Table: figma-to-code (PAY_PER_REQUEST)                 │
│  TTL auto-expiry on "TTL" attribute                     │
│  GSI1: GSI1PK + GSI1SK (user project listing)           │
└─────────────────────────────────────────────────────────┘
         │
         ↓ JWT verification
┌─────────────────────────────────────────────────────────┐
│  AWS Cognito User Pool (us-west-2)                      │
│  User authentication (email/password + Google)          │
│  JWT token verification via aws-jwt-verify              │
└─────────────────────────────────────────────────────────┘
```

---

## AWS Services Used

| Service | Region | Purpose | Cost |
|---------|--------|---------|------|
| **Lightsail** | us-west-2 | Hosting (Docker Compose) | Lightsail plan fee |
| **DynamoDB** | us-west-2 | Free-tier tracking, user projects, chat history | ~$0.55/mo at 100 users/day |
| **Cognito** | us-west-2 | User authentication (JWT) | Free tier: 50K MAU |

---

## CI/CD Pipeline

**Trigger:** Push to `main`, `working-preview`, or `release/v1.0.0` branches (or manual dispatch from GitHub Actions UI).

**File:** `.github/workflows/deploy.yml`

```
GitHub Push
    ↓
┌─ Job 1: test ──────────────────────┐
│  actions/checkout@v4               │
│  actions/setup-node@v4 (Node 22)   │
│  npm ci                            │
│  npm run build (tsc)               │
│  npx vitest run --passWithNoTests  │
└────────────────────────────────────┘
    ↓ (must pass)
┌─ Job 2: deploy ────────────────────┐
│  rsync source → /home/ubuntu/app/  │
│  SSH → docker compose up -d --build│
│  docker image prune -f             │
└────────────────────────────────────┘
```

### GitHub Secrets Required

| Secret | Description |
|--------|-------------|
| `LIGHTSAIL_HOST` | Lightsail instance static IP |
| `LIGHTSAIL_SSH_KEY` | SSH private key for `ubuntu` user |

Set these at: **GitHub repo → Settings → Secrets and variables → Actions**

---

## Key Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage build: builder (npm ci + tsc) → production (node:22-alpine, prod deps only) |
| `docker-compose.yml` | Caddy reverse proxy + app service + DynamoDB env vars + persistent volumes |
| `Caddyfile` | Domain → reverse proxy config with SSE streaming support (`flush_interval -1`) |
| `.dockerignore` | Excludes node_modules, dist, output, .env, .git, docs from Docker context |
| `.github/workflows/deploy.yml` | CI/CD: test → rsync → docker compose up |
| `.env` | Environment variables (NOT in git — lives on server only) |
| `.env.example` | Template for `.env` |

---

## Environment Variables

### Required (on server `.env`)

| Variable | Description |
|----------|-------------|
| `FIGMA_TOKEN` | Figma personal access token |
| `DEEPSEEK_API_KEY` | DeepSeek API key (default LLM) |

### Optional LLM Keys

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | For `--llm claude` (claude-sonnet-4-5) |
| `OPENAI_API_KEY` | For `--llm openai` (gpt-4o) |

### DynamoDB Persistence

| Variable | Default | Description |
|----------|---------|-------------|
| `DYNAMODB_TABLE_NAME` | `''` (disabled) | Set to `figma-to-code` to enable. Empty = in-memory fallback |
| `DYNAMODB_REGION` | `us-west-2` | Must match Lightsail region |
| `DYNAMODB_ENDPOINT` | `''` | For local dev with DynamoDB Local (`http://localhost:8000`) |
| `AWS_ACCESS_KEY_ID` | (from env/IAM) | IAM user credentials for DynamoDB access |
| `AWS_SECRET_ACCESS_KEY` | (from env/IAM) | IAM user credentials for DynamoDB access |

When `DYNAMODB_TABLE_NAME` is empty, all persistence falls back to in-memory (original behavior). DynamoDB errors are caught and logged — the app never breaks.

### Cognito Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `COGNITO_USER_POOL_ID` | `''` (disabled) | Cognito User Pool ID. Empty = auth disabled |
| `COGNITO_CLIENT_ID` | `''` | Cognito App Client ID |
| `COGNITO_REGION` | `us-west-2` | Cognito region |

When `COGNITO_USER_POOL_ID` is empty, all auth middleware passes through (no auth required).

### Free Tier

| Variable | Default | Description |
|----------|---------|-------------|
| `FREE_TIER_MAX_CONVERSIONS` | `5` | Max free conversions for anonymous users |

### Server Config

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Express listen port (internal) |
| `NODE_ENV` | `production` | Node environment |
| `SERVER_OUTPUT_DIR` | `/app/web_output` | Persistent output directory |
| `SERVER_DEFAULT_LLM` | `deepseek` | Default LLM provider |
| `SERVER_DEFAULT_DEPTH` | `25` | Figma tree depth limit |
| `SERVER_JSON_LIMIT` | `1mb` | Express JSON body limit |

### LLM Tuning

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_MODEL` | `claude-sonnet-4-20250514` | Claude model ID |
| `CLAUDE_TEMPERATURE` | `0.1` | Claude temperature |
| `CLAUDE_MAX_TOKENS` | `8192` | Claude max output tokens |
| `OPENAI_MODEL` | `gpt-4o` | OpenAI model ID |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | DeepSeek API base URL |
| `DEEPSEEK_MODEL` | `deepseek-chat` | DeepSeek model ID |

### Fidelity Validation

| Variable | Default | Description |
|----------|---------|-------------|
| `FIDELITY_MIN_LAYOUT_COVERAGE` | `0.9` | Min BEM class coverage (0-1) |
| `FIDELITY_MIN_CSS_COVERAGE` | `0.5` | Min CSS property coverage (0-1) |
| `FIDELITY_FORBID_INLINE_SIZING` | `true` | Block inline `css={{width/height}}` |
| `FIDELITY_REQUIRE_REPORT_PASS` | `false` | Fail conversion on fidelity issues |

### Supabase (client-side, optional)

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase public key |

---

## DynamoDB Table Design

**Table:** `figma-to-code` | Region: `us-west-2` | Billing: `PAY_PER_REQUEST` | TTL: `TTL` attribute

### Entity Schema (Single-Table Design)

| Entity | PK | SK | TTL | Purpose |
|--------|----|----|-----|---------|
| FreeTierUsage | `FP#{fingerprint}` | `USAGE` | 365 days | Conversion count per anonymous user |
| UserProject | `USER#{cognitoSub}` | `PROJ#{projectId}` | 90 days | Project metadata for logged-in users |
| ProjectChat | `USER#{cognitoSub}` | `CHAT#{projectId}` | 90 days | Chat refinement history |
| FP-User Link | `FP#{fingerprint}` | `OWNER` | 365 days | Links fingerprint → Cognito user on login |

**GSI1:** `GSI1PK` (= PK) + `GSI1SK` (= `PROJ#{updatedAt}`) — list user projects sorted by most recent.

### What's NOT in DynamoDB (exceeds 400KB limit)

- `frameworkOutputs` (generated code) → stays on disk via `loadResultFromDisk(sessionId)`
- `mitosisSource`, `assets[].content` → disk at `/app/web_output/{ComponentName}-{sessionId}/`
- Only metadata + `sessionId` reference stored in DynamoDB

### Table Creation (one-time)

```bash
aws dynamodb create-table \
  --region us-west-2 \
  --table-name figma-to-code \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S \
    AttributeName=SK,AttributeType=S \
    AttributeName=GSI1PK,AttributeType=S \
    AttributeName=GSI1SK,AttributeType=S \
  --key-schema \
    AttributeName=PK,KeyType=HASH \
    AttributeName=SK,KeyType=RANGE \
  --global-secondary-indexes \
    '[{"IndexName":"GSI1","KeySchema":[{"AttributeName":"GSI1PK","KeyType":"HASH"},{"AttributeName":"GSI1SK","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]' \
  --billing-mode PAY_PER_REQUEST

aws dynamodb update-time-to-live \
  --region us-west-2 \
  --table-name figma-to-code \
  --time-to-live-specification 'Enabled=true,AttributeName=TTL'
```

### IAM Permissions Required

The IAM user/role needs these actions on `arn:aws:dynamodb:us-west-2:*:table/figma-to-code` and its GSI:

```
dynamodb:GetItem
dynamodb:PutItem
dynamodb:UpdateItem
dynamodb:DeleteItem
dynamodb:Query
dynamodb:BatchWriteItem
```

### DynamoDB Source Files

| File | Role |
|------|------|
| `src/web/db/dynamo-client.ts` | Lazy-init `DynamoDBDocumentClient` singleton, `isDynamoEnabled()` guard |
| `src/web/db/free-tier-repo.ts` | `getFreeTierUsage()`, `incrementFreeTierUsage()` — atomic counter with TTL |
| `src/web/db/project-repo.ts` | CRUD for user projects + chat history + migration from localStorage |
| `src/web/db/index.ts` | Barrel exports |

---

## Authentication Flow

### Architecture

```
Client (app.js)
  ↓ Cognito JS SDK (amazon-cognito-identity-js)
AWS Cognito User Pool
  ↓ JWT id_token
Client sends Authorization: Bearer <token>
  ↓
Express middleware (attachUser)
  ↓ aws-jwt-verify
req.user = { sub, email, name }
```

### Auth Source Files

| File | Role |
|------|------|
| `src/web/auth/cognito.ts` | Server-side JWT verification via `aws-jwt-verify` |
| `src/web/auth/middleware.ts` | `attachUser`, `requireAuth`, `requireAuthOrFree` middleware |
| `src/web/auth/routes.ts` | Auth API endpoints: config, user info, free-tier, projects |

### Auth API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/auth/config` | Public | Cognito config for frontend SDK |
| GET | `/api/auth/me` | Public | Current user info |
| GET | `/api/auth/free-tier` | Public | Anonymous free-tier usage |
| GET | `/api/auth/projects` | Required | List user's DynamoDB projects |
| POST | `/api/auth/projects/sync` | Required | Merge localStorage projects to DynamoDB |
| DELETE | `/api/auth/projects/:projectId` | Required | Delete a project |
| GET | `/api/auth/projects/:projectId/chat` | Required | Get chat history |
| PUT | `/api/auth/projects/:projectId/chat` | Required | Save chat history |

### Free-Tier Tracking

- Anonymous users get `FREE_TIER_MAX_CONVERSIONS` (default: 5) free conversions
- Tracked by fingerprint cookie (`ftfp`, httpOnly, 1-year expiry)
- **With DynamoDB**: Persists across server restarts (atomic counter at `FP#{fingerprint}|USAGE`)
- **Without DynamoDB**: In-memory `Map` (resets on restart)
- Authenticated users bypass free-tier limits entirely

### Anonymous → Login Sync Flow

1. Anonymous user converts 3 designs → stored in localStorage + DynamoDB free-tier counter
2. User logs in → `syncProjectsAfterLogin()` in `app.js`:
   - POST localStorage projects + fingerprint → `/api/auth/projects/sync`
   - Server: BatchWrite under `USER#{sub}`, link `FP#{fp}` → `USER#{sub}`
   - GET `/api/auth/projects` → merge into localStorage (later `updatedAt` wins)
3. Future conversions saved to DynamoDB directly, free-tier not charged

---

## DNS Configuration

**Provider:** Wherever `nesterlabs.com` is registered

| Type | Name | Value |
|------|------|-------|
| `A` | `compose` | `<Lightsail static IP>` |

Caddy automatically handles:
- HTTP → HTTPS redirect
- Let's Encrypt certificate provisioning
- Certificate auto-renewal (before expiry)

---

## Docker Image Details

### Builder Stage
- Base: `node:22-alpine`
- Installs all dependencies (`npm ci`)
- Compiles TypeScript (`npm run build` → `dist/`)

### Production Stage
- Base: `node:22-alpine`
- Production dependencies only (`npm ci --omit=dev`)
- Copies: `dist/`, `prompts/`, `dist/web/public/`, `dist/figma-to-code-starter-main/`
- Entry: `node dist/web/server.js`
- Exposes: port 3000

### Volumes

| Volume | Mount | Purpose |
|--------|-------|---------|
| `web_output` | `/app/web_output` | Persistent conversion results |
| `caddy_data` | `/data` | SSL certificates + ACME state |
| `caddy_config` | `/config` | Caddy runtime config |

### docker-compose.yml Environment Loading

All credentials and config live in a single `.env` file, loaded via `env_file: .env`. The `environment:` section only sets container-specific overrides:

```yaml
environment:
  - NODE_ENV=production
  - PORT=3000
  - SERVER_OUTPUT_DIR=/app/web_output
```

Everything else (FIGMA_TOKEN, LLM keys, AWS credentials, DynamoDB, Cognito, Supabase, fidelity) comes from `.env` automatically.

---

## Session & Persistence Architecture

### In-Memory Sessions (server.ts)
- `Map<sessionId, SessionEntry>` with 1-hour TTL
- Holds: ConversionResult, conversation history, LLM provider, frameworks
- Cleaned up every 10 minutes

### Disk Fallback
- Conversion outputs written to `/app/web_output/{ComponentName}-{sessionId}/`
- When session expires from memory, `loadResultFromDisk(sessionId)` restores it
- Enables preview/download even after server restart

### Client-Side (localStorage)
- Projects stored with: `frameworkOutputs`, `chatHistory`, `assets`, `componentPropertyDefinitions`
- Quota protection: on `QuotaExceededError`, progressively strips assets → chatHistory → oldest projects

### DynamoDB (when enabled)
- Project metadata synced for authenticated users
- Chat history persisted for cross-device access
- Free-tier counters survive restarts
- 90-day TTL on projects, 365-day TTL on fingerprints

---

## Common Operations

### SSH into Server

```bash
ssh -i ~/.ssh/your-lightsail-key.pem ubuntu@<LIGHTSAIL_IP>
cd ~/app
```

### View Running Containers

```bash
docker compose ps
```

### View App Logs

```bash
# All services
docker compose logs -f

# App only
docker compose logs -f app

# Caddy only
docker compose logs -f caddy

# Last 100 lines
docker compose logs --tail 100 app

# Grep for specific events
docker compose logs app | grep '\[refine\]'
docker compose logs app | grep '\[free-tier\]'
docker compose logs app | grep '\[convert\]'
```

### Restart Services

```bash
# Restart everything
docker compose restart

# Restart app only (no rebuild)
docker compose restart app

# Full rebuild and restart
docker compose up -d --build
```

### Stop Everything

```bash
docker compose down
```

### Update Environment Variables

```bash
# Edit .env on server
nano ~/app/.env

# Restart to pick up changes
docker compose up -d
```

### Check SSL Certificate

```bash
# From local machine
curl -vI https://compose.nesterlabs.com 2>&1 | grep -A5 "SSL certificate"

# From server — check Caddy cert storage
docker compose exec caddy caddy list-modules
docker compose exec caddy ls /data/caddy/certificates/
```

### Force SSL Certificate Renewal

```bash
# Caddy auto-renews, but if needed:
docker compose restart caddy
```

### Clean Up Disk Space

```bash
# Remove old Docker images
docker image prune -f

# Remove all unused Docker data (images, containers, volumes not in use)
docker system prune -f

# Check disk usage
df -h
du -sh ~/app/web_output/
```

### View Conversion Output Files

```bash
ls ~/app/web_output/
# Each conversion creates: {ComponentName}-{sessionId}/
```

### Check DynamoDB Data

```bash
# Check free-tier usage for a fingerprint
aws dynamodb get-item \
  --region us-west-2 \
  --table-name figma-to-code \
  --key '{"PK":{"S":"FP#<fingerprint>"},"SK":{"S":"USAGE"}}'

# List a user's projects
aws dynamodb query \
  --region us-west-2 \
  --table-name figma-to-code \
  --key-condition-expression "PK = :pk AND begins_with(SK, :prefix)" \
  --expression-attribute-values '{":pk":{"S":"USER#<cognitoSub>"},":prefix":{"S":"PROJ#"}}'

# Scan all items (small tables only)
aws dynamodb scan \
  --region us-west-2 \
  --table-name figma-to-code \
  --select COUNT
```

---

## Manual Deployment (Without CI/CD)

If GitHub Actions is down or you need to deploy manually:

```bash
# 1. On your local machine — push code to server
rsync -avz --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='output' \
  --exclude='web_output' \
  --exclude='.env' \
  ./ ubuntu@<LIGHTSAIL_IP>:/home/ubuntu/app/

# 2. SSH into server
ssh -i ~/.ssh/your-key.pem ubuntu@<LIGHTSAIL_IP>

# 3. Build and deploy
cd ~/app
docker compose up -d --build --remove-orphans
docker image prune -f
```

---

## Changing the Domain

If you need to point to a different domain:

### 1. Update Caddyfile

```
newdomain.com {
    reverse_proxy app:3000 {
        flush_interval -1
    }
}
```

### 2. Update DNS

Add an `A` record for the new domain pointing to the Lightsail IP.

### 3. Deploy

Push to a deploy branch or run manually. Caddy will auto-provision a new SSL certificate for the new domain.

---

## Adding a Second Domain / Subdomain

Edit the `Caddyfile` to add another block:

```
compose.nesterlabs.com {
    reverse_proxy app:3000 {
        flush_interval -1
    }
}

api.nesterlabs.com {
    reverse_proxy app:3000 {
        flush_interval -1
    }
}
```

Add the DNS `A` record for the new subdomain, then redeploy.

---

## Scaling Considerations

### Current State
- **Single Lightsail instance** — Docker Compose with Caddy + Node app
- **DynamoDB** for persistent state (free-tier tracking, user projects)
- **In-memory sessions** with disk fallback (1hr TTL, survives restarts via disk)
- **Cognito** for optional user authentication
- **No rate limiting** beyond free-tier tracking

### If You Need to Scale

| Need | Solution |
|------|----------|
| More CPU/RAM | Upgrade Lightsail plan |
| Persistent sessions | Already partially solved via disk fallback; add Redis for full session store |
| Multiple instances | Add load balancer (Caddy can do this); DynamoDB already handles shared state |
| Monitoring | Add health endpoint + Prometheus/Grafana |
| Rate limiting | Add express-rate-limit middleware |
| CDN | Put Cloudflare in front of Caddy |
| Full-text search on projects | Add DynamoDB GSI or ElasticSearch |

### Cost Estimates (us-west-2, On-Demand)

| Scale | DynamoDB Writes/mo | Reads/mo | DynamoDB Cost |
|-------|-------------------|----------|---------------|
| 100 users/day, 500 conversions/day | ~205K WCU | ~765K RCU | **~$0.55** |
| 1,000 users/day, 5,000 conversions/day | ~2M WCU | ~7.6M RCU | **~$5.50** |

Storage: negligible (~10MB). Likely within AWS Free Tier for first 12 months.

---

## Disaster Recovery

### Backup Conversion Outputs

```bash
# From server
tar czf ~/backup-$(date +%Y%m%d).tar.gz ~/app/web_output/

# Copy to local
scp -i ~/.ssh/key.pem ubuntu@<IP>:~/backup-*.tar.gz ./
```

### Backup SSL Certificates

```bash
# Caddy stores certs in the caddy_data volume
docker compose exec caddy tar czf /tmp/certs.tar.gz /data/caddy/certificates/
docker compose cp caddy:/tmp/certs.tar.gz ./certs-backup.tar.gz
```

### Backup DynamoDB Table

```bash
# Export to S3 (requires S3 bucket)
aws dynamodb export-table-to-point-in-time \
  --region us-west-2 \
  --table-arn arn:aws:dynamodb:us-west-2:<ACCOUNT_ID>:table/figma-to-code \
  --s3-bucket <backup-bucket> \
  --s3-prefix dynamodb-backups/

# Or use on-demand backup
aws dynamodb create-backup \
  --region us-west-2 \
  --table-name figma-to-code \
  --backup-name figma-to-code-$(date +%Y%m%d)
```

### Full Server Recovery

1. Launch new Lightsail instance (Ubuntu, us-west-2)
2. Install Docker + Docker Compose
3. Copy `.env` to `/home/ubuntu/app/.env`
4. Update `LIGHTSAIL_HOST` secret in GitHub
5. Update DNS A record to new IP
6. Push to deploy branch — CI/CD handles the rest
7. Caddy auto-provisions new SSL cert
8. DynamoDB data is unchanged (separate service)

### Install Docker on Fresh Instance

```bash
# Ubuntu
sudo apt update
sudo apt install -y docker.io docker-compose-plugin
sudo usermod -aG docker ubuntu
# Log out and back in for group to take effect
```

---

## Server Timeouts Reference

| Timeout | Value | Location |
|---------|-------|----------|
| Express keepAliveTimeout | 10 min | `src/web/server.ts` |
| Express headersTimeout | 10 min + 1s | `src/web/server.ts` |
| Express requestTimeout | Disabled (0) | `src/web/server.ts` |
| SSE heartbeat | 15 seconds | `src/web/server.ts` |
| Session TTL | 1 hour | `src/web/server.ts` |
| Session cleanup interval | 10 min | `src/web/server.ts` |
| Caddy flush_interval | -1 (immediate) | `Caddyfile` |
| CI/CD SSH command_timeout | 20 min | `deploy.yml` |
| DynamoDB project TTL | 90 days | `src/web/db/project-repo.ts` |
| DynamoDB free-tier TTL | 365 days | `src/web/db/free-tier-repo.ts` |
| Fingerprint cookie maxAge | 1 year | `src/web/auth/middleware.ts` |

---

## API Endpoints Reference

### Conversion & Preview

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/convert` | AuthOrFree | SSE — Figma-to-code conversion |
| POST | `/api/refine` | Required | SSE — iterative chat refinement |
| GET | `/api/preview/:sessionId` | None | Standalone preview HTML |
| GET | `/api/preview/:sessionId/assets/:filename` | None | SVG assets for preview |
| GET | `/api/download/:sessionId` | Required | ZIP download of component |

### Authentication & Projects

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/auth/config` | None | Cognito config for frontend |
| GET | `/api/auth/me` | None | Current user info |
| GET | `/api/auth/free-tier` | None | Free-tier usage status |
| GET | `/api/auth/projects` | Required | List user projects (DynamoDB) |
| POST | `/api/auth/projects/sync` | Required | Migrate localStorage → DynamoDB |
| DELETE | `/api/auth/projects/:projectId` | Required | Delete project |
| GET | `/api/auth/projects/:projectId/chat` | Required | Get chat history |
| PUT | `/api/auth/projects/:projectId/chat` | Required | Save chat history |

---

## Known Issues

### Visual Edit CSS Loss During Refinement
**Status:** Identified, not yet fixed.

When using visual edit to change text or color, the preview sometimes renders without CSS. Root cause: the safety net (`server.ts:557`) only catches when the LLM completely drops CSS (`!refined.css`). When the LLM outputs partial/truncated CSS, `refined.css` is truthy and the safety net is bypassed, resulting in missing styles. Affects larger components with complex CSS more frequently.

### In-Memory Session Volatility
Sessions are stored in-memory with a 1-hour TTL. Container restarts lose active sessions. Disk fallback (`loadResultFromDisk`) restores conversion results but not conversation history. DynamoDB stores chat history for authenticated users only.

---

## Troubleshooting

### App Not Responding

```bash
# Check container status
docker compose ps

# Check app logs for errors
docker compose logs --tail 50 app

# Check if port 3000 is listening inside container
docker compose exec app netstat -tlnp
```

### SSL Certificate Issues

```bash
# Check Caddy logs
docker compose logs --tail 50 caddy

# Common causes:
# - DNS not pointing to this IP yet
# - Ports 80/443 blocked in Lightsail firewall
# - Rate limited by Let's Encrypt (max 5 certs/week per domain)
```

### DynamoDB Connection Issues

```bash
# Check app logs for DynamoDB errors
docker compose logs app | grep -i 'dynamodb\|dynamo\|free-tier'

# Test DynamoDB connectivity from server
aws dynamodb describe-table --region us-west-2 --table-name figma-to-code

# Common causes:
# - AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY not set or expired
# - Table doesn't exist in the specified region
# - IAM permissions insufficient
# - App falls back to in-memory silently (check for "falling back to memory" in logs)
```

### Free-Tier Not Persisting After Restart

```bash
# Verify DynamoDB is enabled
docker compose exec app env | grep DYNAMODB

# Check a specific fingerprint (get from ftfp cookie)
aws dynamodb get-item \
  --region us-west-2 \
  --table-name figma-to-code \
  --key '{"PK":{"S":"FP#<fingerprint>"},"SK":{"S":"USAGE"}}'
```

### Lightsail Firewall

Ensure these ports are open in **Lightsail → Networking → Firewall**:

| Port | Protocol | Purpose |
|------|----------|---------|
| 22 | TCP | SSH |
| 80 | TCP | HTTP (Caddy redirect to HTTPS) |
| 443 | TCP | HTTPS |
| 443 | UDP | HTTP/3 (QUIC) |

### Out of Disk Space

```bash
# Check usage
df -h

# Cleanup candidates
docker system prune -f           # Old images/containers
du -sh ~/app/web_output/*        # Conversion outputs
ls -lt ~/app/web_output/ | tail  # Oldest outputs
```

### Container Won't Build

```bash
# Check Docker build logs
docker compose build --no-cache app 2>&1 | tail -50

# Common causes:
# - npm ci fails (lock file mismatch) → run npm install locally, commit lock file
# - TypeScript errors → run npm run build locally first
```

### SSE Streams Dropping

The Caddyfile includes `flush_interval -1` which disables response buffering for SSE. If streams still drop:

```bash
# Check server timeouts in src/web/server.ts:
# keepAliveTimeout: 10 minutes
# headersTimeout: 10 minutes + 1 second
# requestTimeout: 0 (disabled for SSE)

# Check Caddy logs for timeout errors
docker compose logs caddy | grep -i timeout
```

---

## Deployment Checklist (New Setup)

1. **Lightsail**: Launch Ubuntu instance in `us-west-2`, attach static IP
2. **Docker**: Install Docker + Docker Compose on instance
3. **DNS**: Add `A` record for `compose.nesterlabs.com` → static IP
4. **Firewall**: Open ports 22, 80, 443 (TCP), 443 (UDP) in Lightsail
5. **DynamoDB**: Create table with CLI command above (one-time)
6. **IAM**: Create IAM user with DynamoDB permissions, get access keys
7. **Cognito**: Create User Pool + App Client in us-west-2 (optional)
8. **Server .env**: Create `/home/ubuntu/app/.env` with all required vars
9. **GitHub Secrets**: Set `LIGHTSAIL_HOST` and `LIGHTSAIL_SSH_KEY`
10. **Deploy**: Push to `main` or `release/v1.0.0` → CI/CD handles the rest
11. **Verify**: Visit `https://compose.nesterlabs.com`, convert a design, check DynamoDB

### Verification Tests

1. **Free tier survives restart**: Convert 3x → `docker compose restart app` → refresh → badge shows "7 remaining"
2. **Anonymous → login sync**: Convert 2 projects → login → projects show under account
3. **No DynamoDB fallback**: Remove `DYNAMODB_TABLE_NAME` from .env → works exactly as before
4. **Cross-device**: Login device A → convert → login device B → projects appear
5. **SSL working**: `curl -I https://compose.nesterlabs.com` returns 200 with valid cert
