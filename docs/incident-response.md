# Security Incident Response & Compromise Containment

**Classification:** Operational Security Runbook  
**System:** Fatorati Platform  

---

## 1. Incident Response Tiers

| Severity | Definition | Examples | Response Target |
|---|---|---|---|
| **P1 - Critical** | Secret exposure, unauthorized database write/delete across tenants, active SSRF breach | Leaked `GITHUB_TOKEN`, bypass of Supabase RLS, exploit of edge function | < 1 hour |
| **P2 - High** | Denial of service, rate limit bypass, stored XSS vulnerability, honeytoken trip | Access to `/api/internal-test` decoy endpoint, abnormal sitemap flood | < 4 hours |
| **P3 - Medium** | Non-exploitable validation bypass, suspicious redirect chain blocked | Malformed crawler target, single tenant rate limit spike | < 24 hours |
| **P4 - Low** | Header discrepancy, documentation gap | Minor security header tuning | Next release cycle |

---

## 2. Compromise Containment Playbooks

### Scenario A: Compromised GitHub Personal Access Token (`GITHUB_TOKEN`)
1. **Immediate Revocation:** Log in to GitHub -> Developer Settings -> Personal Access Tokens -> Immediately Revoke token.
2. **Key Rotation:** Generate a fresh fine-grained token scoped strictly to repository `contents:write` on the specific repository.
3. **Deploy Secret:** Update `GITHUB_TOKEN` in Cloudflare Pages Environment Variables:
   `wrangler pages secret put GITHUB_TOKEN --project-name fatorati-me`
4. **Audit History:** Review recent git commits for unexpected modifications:
   `git log --since="48 hours ago" --oneline`

### Scenario B: Compromised Cloudflare Access Session / Credential
1. **Session Revocation:** Open Cloudflare Zero Trust Dashboard -> My Team -> Users -> Revoke all active sessions for the compromised identity.
2. **Audience Rotation:** Regenerate the Cloudflare Access Application AUD tag if token leakage is suspected.
3. **Access Audit:** Review Cloudflare Access Access Logs for unauthorized editorial actions.

### Scenario C: Database Credential / Dump Exposure
1. **Assessment:** Because all client requests use user JWTs and public anon keys, verify that no service-role key exists in application code.
2. **Token Rotation:** In Supabase dashboard, rotate the JWT secret. All active user sessions are invalidated.
3. **Data Impact:** Review `public.security_events` to identify unauthorized reads or modifications.
