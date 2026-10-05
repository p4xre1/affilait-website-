# Fatorati

An English-only website audit and SEO education site for **fatorati.me**. The homepage offers a free, capped audit of public sitemap pages with a separate Google PageSpeed Insights mobile snapshot for the submitted URL. Supporting pages and Markdown articles explain SEO workflows and optional tools; Fatorati does not sell Semrush or promise that a subscription will fix audit findings.

## Stack and routes

- Astro static output; the entire site is generated to `dist/` at build time.
- Articles are authored in Markdown in `src/content/articles/` and rendered through one reusable article template.
- A dedicated `/tools/semrush/` profile brings the tool evaluation, workflow guides, caveats, and official links together without inventing review scores or current pricing.
- All public content is English-only and uses one clean root-domain route per page, such as `/`, `/articles/`, and `/about/`. Former `/us/` and `/uk/` URLs redirect to the matching clean route.
- Required public pages include Home, Articles, Categories, About, Contact, Privacy, Terms of Use, Cookies & Local Storage, and Affiliate Disclosure. Legal pages document only the site’s actual practices; they do not claim unsupported regulatory certifications or tracking behavior.
- Every public page has a self-referencing canonical URL on the root route. No duplicate regional editions or hreflang alternates are generated.
- The shared `AEOHead` generates canonical metadata, Open Graph/Twitter tags, direct-answer abstracts, breadcrumbs, and JSON-LD. The build generates `sitemap.xml`, `ai-sitemap.xml`, `feed.xml`, `llms.txt`, `llms-full.txt`, `ai.txt`, and read-only discovery files under `.well-known/`; `robots.txt` allows public content while excluding private admin and scan API paths.
- No analytics, tracking pixels, third-party fonts, or affiliate tracking IDs are installed. The theme preference is stored locally in the browser; private editor access uses Cloudflare Access.
- The site is independent, not an official Google or Semrush property. Current Semrush links go directly to official pages, are not affiliate-tracked, and do not earn a commission. The affiliate disclosure describes how an approved future affiliate link would be labeled.

## Local development

Requires Node.js 22.12.0 or newer.

```sh
npm install
npm run dev
```

The local site is available at `http://localhost:4321/`. The homepage is served directly at `/`; public pages use clean root-domain paths with no language subfolders.

```sh
npm run check
npm run build
npm run preview
```

`npm run build` creates the static pages, generates `dist/sitemap.xml`, verifies required routes and metadata, and runs scanner, audit-client, search-intelligence, theme-toggle, and foundation regression tests. The scanner tests cover crawl safeguards, bounded heading evidence, inferred page/question signals, correlation IDs, rate limits, optional RLS-aware persistence, and valid, invalid, and absent JSON-LD. The query-structure tests cover modifiers, intent, page roles, and the limits of crawl-derived evidence. `npm run preview` serves that build with Wrangler Pages locally, including Cloudflare redirects and headers.

**Network-safety limitation:** the existing scanner validates hostnames and redirects but does not resolve and pin DNS answers to verified public IP addresses. The new intelligence code adds no fetch path, but DNS-rebinding/egress hardening remains a separate production security follow-up; do not treat this scanner as a security assessment.

## Website scanner and PageSpeed quota

The scanner uses the visitor-submitted public URL to discover an XML sitemap (referenced by `robots.txt` or `/sitemap.xml`), filters same-site HTML page candidates, and checks up to 100 URLs. It makes page-check requests in batches of up to 10, while the Pages Function fetches up to four pages concurrently. Google PageSpeed Insights runs only for the submitted URL; it is a separate mobile Lighthouse result, not a whole-site measurement. Fatorati removes query strings and fragments before scanning. The public no-account form remains stateless and does not save reports. A separate opt-in persistence path requires a configured Supabase connection, a trusted Supabase Auth JWT, and an RLS-visible owner project whose domain matches the scanned host; without all of these, scanning continues without persistence. A bounded set of title and H1–H3 evidence (at most 18 headings and six question patterns per page) also powers a local page/topic/question summary in the browser. This is inferred from crawled content—not a search-query log, demand estimate, ranking report, or cannibalization finding; no Search Console or keyword provider is connected.

The existing `functions/_shared/search-intelligence.ts` query, topic, variant, mapping, evidence, and provider contracts and the deterministic English modifier/intent parsing remain in use. `functions/_shared/intelligence-contracts.ts` adds provider-neutral provenance, availability, metric, and reviewable-opportunity shapes; it does not connect providers. The Supabase migration and repository adapter provide a minimal owner-scoped foundation for projects, scans, crawl pages, and findings. The current scanner can optionally persist bounded crawl-page rows for an authenticated owner; browser-computed report findings are not persisted, and there is no general scanner-user authentication, project-management UI, saved-report UI, or retention/cleanup job. Semantic query clustering, external search-performance data, cannibalization conclusions, and a ranked action list remain later phases requiring real data and validation rather than crawl-only guesses.

The scanner also detects JSON-LD blocks and checks only whether each block parses as JSON. JSON-LD is optional and its absence is not scored; this check does not validate Schema.org properties, rich-result eligibility, rankings, or AI-search inclusion.

Page checks time out after five seconds; sitemap discovery has a 15-second total budget and each discovery fetch has a three-second timeout. The endpoint limits each IP to two scan preparations and 20 page batches per 10 minutes, but these in-memory limits are best-effort per isolate, not a global Cloudflare rate limit. Configure an account-level rate-limiting/WAF rule for `/api/scan` before broad promotion. PageSpeed Insights runs only on the submitted URL, times out after 20 seconds, and remains subject to Google's quotas. The function can use the API without a key for modest use; for repeated or public production usage, set `GOOGLE_PAGESPEED_API_KEY` as a Cloudflare Pages **secret** for the Production environment (never expose it to browser code). See the [official PageSpeed Insights API guide](https://developers.google.com/speed/docs/insights/v5/get-started).

## Add an article

Create a Markdown file in `src/content/articles/`, for example `src/content/articles/my-guide.md`. Required frontmatter is validated during the build:

```yaml
---
title: "A clear, specific guide title"
description: "A useful search description between 50 and 180 characters."
category: semrush-guides # semrush-guides, education, or editorial
publishedAt: 2026-10-04
updatedAt: 2026-10-04
readTime: 6
shortAnswer: "Give the reader a direct answer in one or two useful sentences."
featured: false
topPick: "The recommended workflow or approach"
comparison:
  - product: "Tool or approach one"
    bestFor: "A specific kind of reader or use"
    standout: "The most meaningful point of difference"
    keepInMind: "A real limitation or caveat"
  - product: "Tool or approach two"
    bestFor: "Another specific kind of reader or use"
    standout: "The most meaningful point of difference"
    keepInMind: "A real limitation or caveat"
pros:
  - "A concrete advantage"
  - "Another concrete advantage"
cons:
  - "A concrete limitation"
  - "Another concrete limitation"
productLink:
  product: "Product or brand name"
  label: "Explore the official site"
  href: "https://example.com/product"
sources:
  - label: "Primary product or research source"
    href: "https://example.com/product"
---

Write the article body in Markdown. The page template automatically adds the short-answer panel, comparison table, pros-and-cons section, a direct external product link, and a note that the current Semrush links are not affiliate-tracked.
```

Use primary sources, distinguish tool estimates from verified facts, and state clearly when guidance is research-led rather than hands-on testing. External product links must use HTTPS. Do not add an affiliate tracking URL or represent a link as commercial until the program has approved it and the URL is supplied. Do not commit credentials or tracking IDs; update the disclosure before publishing any approved affiliate link.

## AI discovery and answer-engine metadata

The build creates machine-readable discovery material from the **actual static routes and Markdown sources**—it does not invent directory, quiz, glossary, or pricing content:

- `/llms.txt` indexes the generated English root-domain public routes and summarizes each article's direct answer, comparison options, caveats, external product-link status, and sources.
- `/llms-full.txt` contains readable public page text and the complete Markdown article bodies with structured metadata.
- `/ai.txt` gives attribution and editorial guidance for AI systems; `/ai-sitemap.xml` lists the real public routes and discovery files.
- `/.well-known/ai-plugin.json` is a legacy, read-only discovery manifest, not an active ChatGPT plugin or action API. `/.well-known/openapi.json` documents public GET-only static resources and pages.
- `AEOHead` is used by the shared layout. It emits direct-answer abstracts, breadcrumb JSON-LD, and page-specific speakable selectors. FAQ structured data is added only where the visible page contains those Q&As; Article, CollectionPage, Product, and HowTo schema are used only where the page content supports them.

`npm run build` regenerates these files automatically. If refreshing after an Astro build, use `npm run ai:generate` (or run `node scripts/generate-llms-enhanced.mjs`, `node scripts/optimize-ai-seo.mjs`, and `node scripts/generate-discovery.mjs`). Counts reflect the current site; they are not fixed targets.

## Editorial dashboard and secure deployment

Public-facing pages are statically generated. Cloudflare Pages Functions power the secured `/admin/` dashboard and `/api/admin/*` editorial endpoints, plus the public `/api/scan` audit service. The scanner is excluded from robots indexing, rejects IP literals and local-like hostnames, validates same-site redirects, caps work, and returns no-store responses; these functions do not change public page rendering into server-side rendering.

There is intentionally no local password form. Cloudflare Access is the login layer, and each Pages Function independently verifies the Access JWT signature, issuer, audience, and allowlisted email before serving private content or accepting changes. The browser never receives the GitHub token. Article writes validate the Markdown schema and use the current GitHub revision SHA to prevent silent overwrites.

Before enabling the dashboard in production:

1. Create a Cloudflare Access self-hosted application for `fatorati.me/admin*` and a second application for `fatorati.me/api/admin*` (or equivalent path rules). Apply an allow policy restricted to the editorial administrators. Both paths must be protected by Access; do not rely on a hidden URL.
2. In the Cloudflare Pages project settings, add the following runtime variables for the Production environment. Keep the GitHub token as a **secret**, not a plain-text variable.

   | Variable | Value |
   | --- | --- |
   | `CF_ACCESS_TEAM_DOMAIN` | Your Access team hostname, such as `your-team.cloudflareaccess.com` (no path) |
   | `CF_ACCESS_AUD` | The Access application's AUD tag; comma-separated values are supported |
   | `ADMIN_EMAILS` | Comma-separated, lowercase email addresses permitted to edit content |
   | `GITHUB_OWNER` | GitHub repository owner |
   | `GITHUB_REPO` | Repository name |
   | `GITHUB_BRANCH` | Branch Pages builds from, normally `main` |
   | `GITHUB_TOKEN` | Secret fine-grained GitHub token with Contents read/write on this repository |

3. Confirm Pages builds deploy the `functions/` directory along with `dist/`. Use `npm run build` and `dist` as the output directory. The token's GitHub account must be allowed to write to the configured branch; branch protection that disallows direct commits will prevent publishing.
4. Test that an unauthenticated request to `/admin/` and `/api/admin/content` is denied, an allowed Access account can list and edit articles, and a successful GitHub commit triggers a Pages deployment.

The app fails closed: if Access or repository settings are absent, the dashboard/API returns an error rather than accepting a fake login or falling back to insecure access. Do not put any of the values above in source code, `wrangler.toml`, browser JavaScript, or committed `.dev.vars` files. Wrangler can use a local ignored `.dev.vars` file for non-production testing; real Access JWT sessions still need a valid Cloudflare Access flow.

## Cloudflare Pages

**Cloudflare Pages Git build settings**

- Framework preset: Astro (or configure manually)
- Build command: `npm run build`
- Build output directory: `dist`
- Node version: `22.12.0` or newer
- Add `fatorati.me` as the custom domain and enable HTTPS.

The public website is static Astro output. Pages Functions in the repository's top-level `functions/` directory serve the secured editorial routes and the public website scanner. The scanner discovers sitemap URLs, checks at most 100 pages per run in batches of up to 10, and runs one PageSpeed Insights report on the submitted URL. It does not render JavaScript or follow arbitrary off-site links. The public form remains stateless; the opt-in server-side persistence hook stores bounded crawl-page rows only when an authenticated owner/project context is supplied and Supabase RLS permits the write. The current UI has no scanner login or saved-report view. For the separate early-access content map, the scanner returns capped title/heading evidence labeled as inferred; it does not use query-demand, Search Console, ranking, or SERP data. Sitemap discovery is time-limited to 15 seconds, reads at most six sitemap files and 5,000 URL entries, and reports when a discovery cap is hit. The in-memory `ScanLimiter` remains best-effort per function isolate, so configure Cloudflare rate limiting/WAF protection before promoting the endpoint widely. The `public/_redirects` file permanently maps legacy `/us/` and `/uk/` URLs to clean root routes; Cloudflare Pages also serves the security headers in `public/_headers`. `wrangler.toml` configures local development and Cloudflare Pages `preview` (staging) and `production` environments; Pages Wrangler supports `preview` and `production`, not an `env.staging` block. See [Website Intelligence Engine foundation](docs/website-intelligence-foundation.md) for runtime variables, persistence setup, RLS, and operational/security limits. To deploy from a machine already authenticated with Cloudflare, run `npm run build` followed by `npx wrangler pages deploy dist --project-name=fatorati-me` from the repository root so Wrangler can include the Functions. No Cloudflare token is stored in this repository.

The canonical host is `https://fatorati.me` (without `www`). Configure preferred-host and DNS behavior in Cloudflare when connecting the domain.

## Before launch

- Set up and monitor `hello@fatorati.me`, or replace it in the contact, privacy, and disclosure pages.
- Review the Semrush interface, feature availability, current plan details, and all citations before publishing; this site does not quote live pricing or unverified affiliate terms. Its current Semrush links are direct and not affiliate-tracked.
- Have education-sector subject matter owners verify admissions, course, tuition, and accreditation information before publishing related content.
- Add region-appropriate affiliate destinations only after approval. The site currently publishes one English-language route set; review market-specific policy language before promotion in additional markets.
- Review the privacy notice and disclosure against the final Cloudflare settings and any affiliate programs you use.
- Keep public canonicals, sitemap entries, RSS items, and AI-discovery resources on the single root-domain route set.
