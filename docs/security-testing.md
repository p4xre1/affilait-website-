# Security Testing Strategy & Adversarial Verification

**Classification:** Security Verification Plan  
**Coverage:** Automated Security Test Suite (`scripts/test-security.mjs`)  

---

## 1. Test Suite Categories

The automated security test suite verifies compliance against the following categories:

### 1. SSRF & Address Representation Testing
* Loopback addresses: `127.0.0.1`, `http://127.1`, `http://127.0.1`
* Private IPv4 networks: `10.0.0.1`, `172.16.0.1`, `192.168.1.1`
* Carrier-grade NAT: `100.64.0.1`
* Cloud instance metadata: `169.254.169.254`, `http://metadata.google.internal/`
* Alternative IP encodings:
  * Hexadecimal notation: `0x7f000001`, `0x7f.1`
  * Octal notation: `0177.0.0.1`
  * Decimal dword integer: `2130706433` (127.0.0.1), `2852039166` (169.254.169.254)
* IPv6 representations:
  * Loopback: `http://[::1]/`
  * Link-local: `http://[fe80::1]/`
  * Unique-local: `http://[fc00::1]/`
  * IPv4-mapped IPv6: `http://[::ffff:127.0.0.1]/`, `http://[::ffff:169.254.169.254]/`
* Multi-hop redirect chains leading from public URL to private IP

### 2. Crawl & Resource Exhaustion Abuse
* Giant HTML responses exceeding byte caps (cut off immediately)
* Giant XML sitemaps with > 5,000 URLs (capped at safe limit)
* Recursive redirect loops (301/302 self-referencing)
* Oversized request bodies (> 18 KB rejected with 413)
* Parameter pollution attacks (> 10 JSON keys rejected)
* Prototype pollution attempts (`__proto__`, `constructor`)

### 3. Authentication & JWT Hardening
* Missing token (401)
* Expired token (401)
* Invalid signature (401)
* Algorithm confusion attempt (`HS256` symmetric attack rejected)
* Malformed JWT string (401)
* Allowed email mismatch (403)

### 4. Database & Multi-Tenant RLS Isolation
* User A cannot query User B projects
* User A cannot insert scans into User B projects
* User A cannot update or delete User B scans or findings
* Anonymous role has zero select, insert, update, delete permissions

### 5. Content Sanitization & Stored XSS
* Script tags in titles, headings, and descriptions stripped
* Event handlers (`onload=`, `onerror=`) neutralized
* Bidirectional Unicode override characters stripped
* Markdown editor script injection rejected before committing

### 6. Defensive Deception & Honeytokens
* Accessing decoy endpoint `/api/internal-test` logs a security event
* Decoy endpoint reveals no real production secrets or internal infrastructure
* Canary provider token access raises immediate alert

### 7. AI & Prompt Injection Resistance
* Adversarial strings ("Ignore previous instructions", "Reveal secrets") embedded in crawled content are verified as inert data.
