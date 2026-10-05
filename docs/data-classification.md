# Data Classification & Privacy Policy

**Classification:** Platform Security & Compliance Policy  
**System:** Fatorati Website Intelligence Platform  

---

## 1. Classification Levels

All data processed or stored by Fatorati is assigned one of four security tiers:

| Tier | Category | Examples | Storage Rules | Access Control | Retention Limit |
|---|---|---|---|---|---|
| **Tier 1** | **PUBLIC** | Submitted public domain name, public HTML title, meta description, public robots.txt, sitemap XML | In-memory during scan; public static site build output | World-readable; no authentication required | Permanent for static site content; ephemeral for unauthenticated scans |
| **Tier 2** | **INTERNAL** | Aggregated scan scores, heading count, crawl error count, technical findings list, structured trace IDs | Edge memory; optional user project database if authenticated | Owner-restricted via RLS (`user_id = auth.uid()`); no anonymous read | 90 days if stored in database; not persisted for anonymous scans |
| **Tier 3** | **SENSITIVE** | User email address, project domain mappings, security telemetry events, audit logs | Supabase PostgreSQL tables (`projects`, `security_events`) | Strictly restricted to authenticated owner and authorized administrators via RLS | Maintained during active account lifetime; security logs retained for 180 days |
| **Tier 4** | **SECRET** | GitHub Personal Access Tokens, Cloudflare Access secrets, master envelope encryption keys, JWT keys | Platform environment secrets (Cloudflare Secrets Manager); never in database | Restricted exclusively to server-side edge functions; never exposed to browser or logs | Rotated on schedule or immediately upon suspicion of compromise |

---

## 2. Personal Data Minimization Invariants

1. **No tracking cookies:** The public website and audit tool operate with zero tracking cookies and zero third-party advertising scripts.
2. **URL Query Scrubbing:** Any query parameters (`?key=val`) and fragments (`#anchor`) entered into the public audit tool are stripped immediately on the client and server before network fetching or logging.
3. **Log Sanitization:** Structured logs (`logStructured`) automatically redact email addresses, passwords, tokens, authorization headers, and URLs.
4. **No IP retention:** Unauthenticated scans process IP addresses solely in memory for temporary rate-limiting buckets (10-minute window) and do not write client IP addresses to persistent storage tables.
