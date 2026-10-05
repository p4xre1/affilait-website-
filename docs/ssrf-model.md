# Outbound Network Security & SSRF Threat Model

**Classification:** Technical Network Security Specification  
**Component:** `SafeOutboundRequest` Centralized Security Layer  
**Target Runtime:** Cloudflare Pages Edge Functions (`workerd`)

---

## 1. The Threat of SSRF in Web Scanners

A web scanner fundamentally fetches user-supplied URLs. Without rigorous controls, an attacker can supply targets such as:
1. `http://127.0.0.1` or `http://localhost` (Local isolate services)
2. `http://169.254.169.254` (Cloud instance metadata services)
3. `http://10.0.0.1` or `http://192.168.0.1` (Internal VPC or container network addresses)
4. Obfuscated IP representations (hex, octal, dword decimal, IPv6-mapped IPv4)
5. DNS Rebinding domains (names resolving to public IPs initially, then private IPs upon fetch)
6. Open redirect chains (`https://public.example/redirect?to=http://127.0.0.1`)

---

## 2. Centralized Outbound Request Layer (`SafeOutboundRequest`)

All network requests to untrusted, scanner-controlled destinations MUST pass through `SafeOutboundRequest`. Direct calls to global `fetch()` on untrusted URLs are strictly prohibited.

### Flow Architecture

```
User URL Input
      │
      ▼
1. URL Canonicalization & Normalization
   ├── Reject non-HTTP/HTTPS schemes
   ├── Reject credentials in authority (user:pass)
   ├── Reject non-standard ports (allowed: 80, 443)
   ├── Strip query parameters and fragment
   └── Check length limits (<= 2,048 chars)
      │
      ▼
2. IP Representation & Hostname Normalization
   ├── Reject control characters ([\x00-\x1f\x7f])
   ├── Lowercase and strip trailing dots
   ├── Detect and parse decimal, hex, octal, dotted numeric forms
   ├── Normalize IPv6 bracketed hosts and IPv4-mapped IPv6
   └── Evaluate against Reserved & Private CIDR ranges
      │
      ▼
3. Domain Policy & TLD Classification
   ├── Verify TLD is >= 2 alphabetic characters or punycode (xn--)
   ├── Reject private/special-use TLDs (.internal, .local, .onion, .test, etc.)
   ├── Reject dynamic DNS and DNS-rebinding services (.nip.io, .sslip.io, etc.)
   └── Reject cloud metadata hostnames (metadata.google.internal, instance-data, etc.)
      │
      ▼
4. Connection Execution with Abort Controller & Byte Cap
   ├── Manual redirect mode (`redirect: 'manual'`)
   ├── Timeout timer (3s discovery, 5s page fetch)
   └── Bounded streaming reader (abort on byte limit exceeded)
      │
      ▼
5. Redirect Interception & Re-Validation
   ├── If 3xx received: extract `Location` header
   ├── Form absolute URL using current URL as base
   ├── Loop back to Step 1 for the redirect target
   ├── Enforce same-site / crawl scope boundary
   └── Enforce maximum hop limit (max 3 redirects)
```

---

## 3. Explicit Prohibited IP Ranges

The following address spaces are normalized, parsed, and strictly blocked:

| Range / Subnet | Classification | Justification |
|---|---|---|
| `0.0.0.0/8` | "This network" (RFC 1122) | Source-only address |
| `10.0.0.0/8` | Private network (RFC 1918) | Internal VPC / container routing |
| `100.64.0.0/10` | Carrier-grade NAT (RFC 6598) | Shared address space / cloud internals |
| `127.0.0.0/8` | Loopback (RFC 1122) | Localhost access |
| `169.254.0.0/16` | Link-local (RFC 3927) | AWS/GCP/Azure instance metadata services |
| `172.16.0.0/12` | Private network (RFC 1918) | Internal VPC routing |
| `192.0.0.0/24` | IETF Protocol Assignments (RFC 6890) | Reserved protocol block |
| `192.0.2.0/24` | TEST-NET-1 (RFC 5737) | Documentation/test only |
| `192.168.0.0/16` | Private network (RFC 1918) | Home/corporate intranet routing |
| `198.18.0.0/15` | Benchmarking (RFC 2544) | Network performance testing |
| `198.51.100.0/24` | TEST-NET-2 (RFC 5737) | Documentation/test only |
| `203.0.113.0/24` | TEST-NET-3 (RFC 5737) | Documentation/test only |
| `224.0.0.0/4` | Multicast (RFC 5771) | Multicast group routing |
| `240.0.0.0/4` | Reserved for future use (RFC 1112) | Unusable public address space |
| `255.255.255.255/32` | Limited Broadcast (RFC 919) | Local network broadcast |
| `::1/128` | IPv6 Loopback (RFC 4291) | Localhost access |
| `fe80::/10` | IPv6 Link-Local (RFC 4291) | Link-local addressing |
| `fc00::/7` | IPv6 Unique Local (RFC 4193) | Private IPv6 addressing |
| `ff00::/8` | IPv6 Multicast (RFC 4291) | IPv6 multicast groups |
| `::ffff:0:0/96` | IPv4-mapped IPv6 (RFC 4291) | Mapped addresses evaluated against all IPv4 rules above |

---

## 4. Cloudflare Runtime Networking Limitations & DNS Rebinding

### Architectural Fact
In the Cloudflare Workers / Pages edge runtime (`workerd`):
* Standard Node.js `net.Socket` and raw OS-level socket APIs are unavailable.
* The edge runtime's global `fetch()` performs DNS resolution internally when establishing TLS connections.
* Application-level code cannot pin a TCP socket directly to a pre-resolved IP address while preserving SNI for TLS verification in standard Workers environments.

### Mitigations Implemented
1. All hostnames are checked against known DNS rebinding wildcard domains (`nip.io`, `sslip.io`, etc.).
2. Hostnames with embedded private IPs or suspicious hex/octal forms are rejected outright.
3. Redirect destinations are intercepted and re-validated at each step before issuing the subsequent request.
4. Crawl scope strictly confines fetches to the submitted public domain.

### Residual Risk
If an attacker creates an authoritative nameserver for a custom public domain that returns a public IP with a 0-second TTL on query 1, and returns `10.0.0.1` on query 2, the edge runtime's internal HTTP connection pool might resolve to the secondary IP at the socket level.  
**Platform Guarantee:** We enforce the strongest possible defenses at the application layer and explicitly acknowledge that complete, uncompromised DNS rebinding protection against dual-homed subnets requires Cloudflare Enterprise Egress Gateway IP filtering.
