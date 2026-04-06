# CloudWatch Logs — Query Reference

**Log Groups:**
- `/figma-to-code/app` — App server logs (conversions, refine, LLM, auth)
- `/figma-to-code/caddy` — Caddy reverse proxy logs (HTTP requests, TLS)

**Region:** `us-west-2` (Oregon)

**How to use:** AWS Console → CloudWatch → Logs → Logs Insights → Select log group → Paste query → Run

---

## Visitors & Traffic

### Unique visitors today
```
fields @timestamp, @message
| filter @message like "[visit]"
| parse @message /ip=(?<ip>\S+)/
| stats count_distinct(ip) as uniqueVisitors
```

### Unique visitors per day (last 7 days)
```
fields @timestamp, @message
| filter @message like "[visit]"
| parse @message /ip=(?<ip>\S+)/
| stats count_distinct(ip) as uniqueVisitors by bin(1d)
| sort @timestamp desc
```

### Total page views per day
```
fields @timestamp, @message
| filter @message like "[visit]"
| stats count() as pageViews by bin(1d)
| sort @timestamp desc
```

### Unique visitors per hour (traffic pattern)
```
fields @timestamp, @message
| filter @message like "[visit]"
| parse @message /ip=(?<ip>\S+)/
| stats count_distinct(ip) as visitors, count() as pageViews by bin(1h)
| sort @timestamp desc
```

---

## Conversions

### All conversions (start, success, fail)
```
fields @timestamp, @message
| filter @message like "[convert]"
| sort @timestamp desc
| limit 50
```

### Conversions per day (success vs failure)
```
fields @timestamp, @message
| filter @message like "[convert]" and (@message like "SUCCESS" or @message like "FAILED")
| parse @message /(?<status>SUCCESS|FAILED)/
| stats count() as total by status, bin(1d)
| sort @timestamp desc
```

### Average conversion duration (seconds)
```
fields @timestamp, @message
| filter @message like "[convert]" and @message like "SUCCESS"
| parse @message /duration=(?<dur>[\d.]+)s/
| stats avg(dur) as avgSeconds, min(dur) as fastest, max(dur) as slowest, count() as total by bin(1d)
```

### Failed conversions (with error messages)
```
fields @timestamp, @message
| filter @message like "[convert]" and @message like "FAILED"
| sort @timestamp desc
| limit 20
```

### Conversions by LLM provider
```
fields @timestamp, @message
| filter @message like "[convert]" and @message like "SUCCESS"
| parse @message /llm=(?<llm>\S+)/
| stats count() as total by llm
```

### Conversions by framework
```
fields @timestamp, @message
| filter @message like "[convert]" and @message like "START"
| parse @message /frameworks=\[(?<fw>[^\]]+)\]/
| stats count() as total by fw
```

---

## Refine / Chat

### All refine requests
```
fields @timestamp, @message
| filter @message like "[refine]"
| sort @timestamp desc
| limit 50
```

### Visual edit refines (element targeting)
```
fields @timestamp, @message
| filter @message like "[refine-target]"
| sort @timestamp desc
| limit 30
```

### LLM reasoning blocks
```
fields @timestamp, @message
| filter @message like "[refine-reasoning]"
| sort @timestamp desc
| limit 20
```

### Wrong element changes (verification warnings)
```
fields @timestamp, @message
| filter @message like "[refine-verify]" and @message like "NOT FOUND"
| sort @timestamp desc
| limit 20
```

### Refines per day
```
fields @timestamp, @message
| filter @message like "[refine]" and @message like "sessionId="
| stats count() as refines by bin(1d)
| sort @timestamp desc
```

---

## LLM Calls

### All LLM calls (model, duration, size)
```
fields @timestamp, @message
| filter @message like "[llm]"
| sort @timestamp desc
| limit 30
```

### LLM errors
```
fields @timestamp, @message
| filter @message like "[llm]" and @message like "ERROR"
| sort @timestamp desc
| limit 20
```

### LLM response times
```
fields @timestamp, @message
| filter @message like "[llm]" and @message like "duration="
| parse @message /duration=(?<dur>[\d.]+)/
| stats avg(dur) as avgMs, max(dur) as maxMs, count() as calls by bin(1h)
```

---

## Auth & Free Tier

### Free tier blocks (limit reached)
```
fields @timestamp, @message
| filter @message like "Free tier" or @message like "limit"
| sort @timestamp desc
| limit 20
```

### Auth errors
```
fields @timestamp, @message
| filter @message like "auth" and (@message like "error" or @message like "failed")
| sort @timestamp desc
| limit 20
```

---

## Errors & Issues

### All errors
```
fields @timestamp, @message
| filter @message like "[ERROR]"
| sort @timestamp desc
| limit 30
```

### Fatal errors (uncaught exceptions)
```
fields @timestamp, @message
| filter @message like "[fatal]"
| sort @timestamp desc
| limit 10
```

### Server restarts
```
fields @timestamp, @message
| filter @message like "running at"
| sort @timestamp desc
| limit 10
```

---

## User Activity

### Top users by conversions
```
fields @timestamp, @message
| filter @message like "[convert]" and @message like "START"
| parse @message /user=(?<user>\S+)/
| stats count() as conversions by user
| sort conversions desc
| limit 20
```

### Top users by refines
```
fields @timestamp, @message
| filter @message like "[refine]" and @message like "sessionId="
| parse @message /user=(?<user>\S+)/
| stats count() as refines by user
| sort refines desc
| limit 20
```

### Activity for a specific user (replace USER_ID)
```
fields @timestamp, @message
| filter @message like "user=USER_ID"
| sort @timestamp desc
| limit 50
```

---

## Caddy (HTTP Traffic)

### All HTTP requests (from Caddy log group)
```
fields @timestamp, @message
| filter @message like "handled_request" or @message like "\"status\""
| sort @timestamp desc
| limit 50
```

---

## CLI Alternatives

### Tail logs in real-time
```bash
aws logs tail /figma-to-code/app --region us-west-2 --follow
```

### Last 30 minutes of logs
```bash
aws logs tail /figma-to-code/app --region us-west-2 --since 30m
```

### Filter for errors only
```bash
aws logs tail /figma-to-code/app --region us-west-2 --follow --filter-pattern "[ERROR]"
```

### Filter for conversions only
```bash
aws logs tail /figma-to-code/app --region us-west-2 --follow --filter-pattern "[convert]"
```
