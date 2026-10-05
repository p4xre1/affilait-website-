# Security Architecture: Zero-Trust & Compartmentalization

**Classification:** Technical Security Architecture Specification  
**System:** Fatorati Website Intelligence Platform  
**Target:** Edge Runtime (Cloudflare Pages), Storage (Supabase PostgreSQL), CMS (Cloudflare Access & GitHub)

---

## 1. Zero-Trust Architecture Principles

The architecture enforces a pipeline where no component assumes trust from another:

```
[Untrusted Input]
       │
       ▼
[Validation]  ────────► Length, Character, Script Pattern & CIDR Checks
       │
       ▼
[Authorization]  ─────► Origin, CSRF, Token & RLS Policy Enforcement
       │
       ▼
[Bounded Processing] ─► Fixed Size Streams, Time Budgets & Queue Caps
       │
       ▼
[Isolated Resource] ──► Least-Privilege Network & Storage Operations
       │
       ▼
[Sanitized Output]  ──► Escaped Plaintext, Safe JSON & Strict Headers
```

### Invariant Rules
1. **Never trust client-provided identities:** Client-supplied IDs (`owner_id`, `user_id`, `project_id`) are never used for access authorization; identity is derived exclusively from the verified JWT context (`auth.uid()`).
2. **Never trust crawled content:** External web pages are treated strictly as untrusted binary/text data, never as code, markup, or configuration instructions.
3. **Never trust external redirects:** Every HTTP 3xx response is intercepted manually; the target destination is evaluated from scratch against all SSRF and scope policies before following.
4. **Independent server-side authorization:** The frontend UI is treated as untrusted; every state-changing API request is authorized server-side.

---

## 2. Component Separation & Key Hierarchy

To prevent lateral movement and catastrophic compromise, keys and credentials are compartmentalized across distinct operational boundaries:

```
┌────────────────────────────────────────────────────────┐
│ Cloudflare Pages Environment Secrets (Never in Git)    │
│  ├── GITHUB_TOKEN (Scoped repository contents only)   │
│  ├── CF_ACCESS_AUD / CF_ACCESS_TEAM_DOMAIN            │
│  ├── ADMIN_EMAILS                                      │
│  ├── SUPABASE_URL / SUPABASE_ANON_KEY (Public Key Only)│
│  ├── MASTER_ENCRYPTION_KEY (For envelope crypto)       │
│  └── CANARY_HONEYTOKEN_SECRET (Zero privileges)        │
└────────────────────────────────────────────────────────┘
```

### Key Separation Matrix

| Key Domain | Purpose | Storage Location | Compromise Blast Radius |
|---|---|---|---|
| **Cloudflare Access JWT** | Editorial CMS authentication | Edge memory / HTTP Header | Access to editorial dashboard until token expires; cannot access Supabase or cloud infrastructure. |
| **Supabase Anon Key** | Public PostgREST endpoint access | Cloudflare environment | Restricted by PostgreSQL Row-Level Security; cannot read other users' data or bypass RLS without valid user JWT. |
| **User JWT (Supabase Auth)** | User tenant authorization | Request header | Scoped strictly to the specific user's projects and scans via `auth.uid()`. |
| **GitHub Personal Token** | Committing Markdown articles | Cloudflare Workers secret | Scoped strictly to content repository markdown files; cannot access database or users. |
| **Master Encryption Key** | Envelope encryption of secrets | Cloudflare secret (outside DB) | If database is stolen, ciphertext cannot be decrypted without this key. |
| **Canary / Honeytoken** | Intrusion detection decoy | Telemetry / Decoy endpoint | Zero operational privileges; triggers immediate security event alert. |

---

## 3. Cryptographic Envelope Architecture

For storing sensitive external credentials (such as provider refresh tokens or OAuth secrets in future milestones), the system defines an envelope encryption standard:

```
[Master Key (Cloudflare Secret)]
       │
       ▼ (HKDF-SHA256 Derivation)
[Key Encryption Key (KEK)]
       │
       ▼ (Wraps per-record keys)
[Data Encryption Key (DEK)] ────► Encrypts Secret via AES-256-GCM
       │
       ▼
[Ciphertext + IV + Tag (Stored in DB)]
```

* **Algorithm:** AES-GCM 256-bit with random 96-bit IV and 128-bit authentication tag.
* **Key Derivation:** HKDF with SHA-256 using platform secret and domain salt.
* **Separation:** Encryption keys live strictly in Cloudflare worker runtime secrets, never inside PostgreSQL tables.

---

## 4. Edge Security Layer & Headers

All responses emitted from Cloudflare Pages enforce defense-in-depth headers:

* **Strict-Transport-Security:** `max-age=63072000; includeSubDomains; preload`
* **X-Content-Type-Options:** `nosniff`
* **X-Frame-Options:** `DENY`
* **Cross-Origin-Opener-Policy:** `same-origin`
* **Cross-Origin-Resource-Policy:** `same-origin`
* **X-Permitted-Cross-Domain-Policies:** `none`
* **Permissions-Policy:** Locks down camera, microphone, geolocation, payment, usb, bluetooth, and tracking APIs.
* **Content-Security-Policy:**
  `default-src 'self'; base-uri 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests; block-all-mixed-content`

---

## 5. Deception Architecture & Honeytokens

To detect reconnaissance without taking offensive action or collecting personal data:
1. **Decoy Endpoints (`/api/internal-test`):**
   * Endpoint mimics an internal test or administrative interface.
   * Performs zero production actions and connects to no database.
   * Generates a structured `security_events` record with timestamp, request ID, and route.
   * Returns a standard 404 or generic 403 to terminate connection immediately.
2. **Canary Tokens:**
   * Canary credentials (`CANARY_PROVIDER_TOKEN`) are monitored.
   * If any request submits a canary token, an alert is raised immediately.
   * No retaliatory action or unauthorized probing is attempted.
