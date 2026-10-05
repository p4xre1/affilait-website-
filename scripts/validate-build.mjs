import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(projectRoot, 'dist');
const readPage = (relativePath) => readFile(path.join(dist, relativePath), 'utf8');

function assertNoExecutableInlineScripts(html, label) {
  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((match) => match[0]);
  const inline = scripts.filter((tag) => !/\bsrc\s*=/i.test(tag) && !/\btype=[\"']application\/ld\+json[\"']/i.test(tag));
  assert.equal(inline.length, 0, `${label} should not include executable inline scripts under the strict CSP.`);
}

function parseJsonLd(html, label) {
  const marker = '<script type="application/ld+json">';
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `${label} should include JSON-LD.`);
  const content = html.slice(start + marker.length).split('</script>')[0];
  return JSON.parse(content);
}

const articleSlugs = (await readdir(path.join(projectRoot, 'src/content/articles')))
  .filter((filename) => filename.endsWith('.md'))
  .map((filename) => filename.slice(0, -3))
  .sort();
const categorySlugs = ['semrush-guides', 'education', 'editorial'];
const requiredPages = [
  'index.html',
  'articles/index.html',
  'about/index.html',
  'contact/index.html',
  'privacy/index.html',
  'cookies/index.html',
  'terms/index.html',
  'affiliate-disclosure/index.html',
  'tools/semrush/index.html',
  'solutions/index.html',
  'reviews/index.html',
  ...categorySlugs.map((slug) => `categories/${slug}/index.html`),
  ...articleSlugs.map((slug) => `articles/${slug}/index.html`),
];

for (const relativePage of requiredPages) {
  const routePath = relativePage === 'index.html'
    ? ''
    : relativePage.endsWith('/index.html')
      ? relativePage.slice(0, -'/index.html'.length)
      : relativePage.replace(/\.html$/, '');
  const canonicalUrl = `https://fatorati.me/${routePath ? `${routePath}/` : ''}`;
  const page = await readPage(relativePage);
  assertNoExecutableInlineScripts(page, relativePage);

  assert.ok(page.includes('<html lang="en" dir="ltr">'), `${relativePage} should declare English and left-to-right direction.`);
  assert.ok(page.includes(`rel="canonical" href="${canonicalUrl}"`), `${relativePage} should have its clean canonical URL.`);
  assert.doesNotMatch(page, /hreflang=/i, `${relativePage} should not emit regional alternate links.`);
  assert.doesNotMatch(page, /href="\/(?:us|uk)\//i, `${relativePage} should not link to a legacy locale subfolder.`);
  assert.ok(page.includes('<meta name="description"'), `${relativePage} should have a meta description.`);
  assert.ok(page.includes('href="/llms.txt"'), `${relativePage} should advertise the AI-readable index.`);
  const pageGraph = parseJsonLd(page, relativePage)['@graph'];
  const pageEntity = pageGraph.find((node) => node['@type'] === 'WebPage');
  assert.ok(pageEntity?.abstract, `${relativePage} should have a direct-answer abstract.`);
  assert.ok(pageEntity?.speakable?.cssSelector?.length, `${relativePage} should expose speakable selectors.`);
  if (routePath) assert.ok(pageGraph.some((node) => node['@type'] === 'BreadcrumbList'), `${relativePage} should include breadcrumb schema.`);
}

const affiliateArticlePaths = articleSlugs.map((slug) => `articles/${slug}/index.html`);
for (const relativePath of affiliateArticlePaths) {
  const article = await readPage(relativePath);
  assert.match(article, /class="short-answer"/, `${relativePath} should include its short answer.`);
  assert.match(article, /class="comparison-table-wrap"/, `${relativePath} should include its comparison table.`);
  assert.match(article, /class="pros-cons"/, `${relativePath} should include pros and cons.`);
  assert.match(article, /class="article-disclosure"/, `${relativePath} should include an automatic disclosure.`);
  assert.match(article, /class="product-link"/, `${relativePath} should render a direct external product link.`);
  assert.doesNotMatch(article, /rel="sponsored/, `${relativePath} must not mark the current direct product link as sponsored.`);
  assert.match(article, /not affiliate-tracked/i, `${relativePath} should disclose the current link status.`);
  const productLinks = [...article.matchAll(/<a class="product-link" href="([^"]+)"/g)].map((match) => new URL(match[1]));
  assert.ok(productLinks.length > 0, `${relativePath} should include a product link.`);
  for (const productLink of productLinks) {
    assert.equal(productLink.hostname, 'www.semrush.com', `${relativePath} should link directly to the official Semrush domain.`);
    assert.equal(productLink.search, '', `${relativePath} must not include tracking query parameters in its Semrush product link.`);
  }
  assert.match(article, /<table class="comparison-table">/, `${relativePath} should render a semantic comparison table.`);
}

const typographyFiles = [
  'src/styles/global.css',
  'src/styles/site-audit.css',
  'src/pages/admin/index.astro',
];
for (const relativePath of typographyFiles) {
  const typography = await readFile(path.join(projectRoot, relativePath), 'utf8');
  const pixelFontSizes = [...typography.matchAll(/font-size\s*:\s*([\d.]+)px/gi)].map((match) => Number(match[1]));
  assert.ok(pixelFontSizes.every((size) => size >= 16), `${relativePath} should not use hard-to-read text smaller than 16px.`);
  assert.doesNotMatch(typography, /var\(--serif\)|Georgia|font-style\s*:\s*(?:italic|oblique)/i, `${relativePath} should use the unified upright sans-serif system.`);
}
const globalTypography = await readFile(path.join(projectRoot, 'src/styles/global.css'), 'utf8');
assert.match(globalTypography, /--display:\s*var\(--sans\)/, 'Display and body copy should use the same sans-serif stack.');
const socialCardSvg = await readFile(path.join(projectRoot, 'public/social-card.svg'), 'utf8');
assert.doesNotMatch(socialCardSvg, /Georgia|Times New Roman/i, 'The social card should use the same simple sans-serif style.');

const home = await readPage('index.html');
const homeJsonLd = parseJsonLd(home, 'Home page');
assert.ok(homeJsonLd['@graph'].some((node) => node['@type'] === 'BreadcrumbList'));
assert.ok(homeJsonLd['@graph'].some((node) => node['@type'] === 'FAQPage'));
assert.match(home, /class="[^"]*\bhome-faq\b/);
assert.match(home, /id="site-audit-form"/, 'Homepage should foreground the website scanner.');
assert.match(home, /class="audit-how-it-works__image"[\s\S]*?src="\/website-audit-editorial\.jpg"/, 'Homepage should include its editorial audit image.');
assert.match(home, /alt="Illustrative photograph[^\"]*no live scan data is shown"/, 'The audit image should be clearly identified as illustrative.');
assert.match(home, /<ol class="audit-how-grid"[^>]*aria-label="Three stages of the website scan"/);
assert.equal([...home.matchAll(/class="audit-how-grid__number"/g)].length, 3, 'Homepage infographic should show its three scan stages.');
assert.ok((await readFile(path.join(dist, 'website-audit-editorial.jpg'))).byteLength > 0, 'The audit image should be emitted to the static site.');
assert.match(home, /id="audit-intelligence-title"/, 'The report should include the separate crawl-derived intelligence panel.');
assert.match(home, /not observed search queries/i, 'The report should disclose that inferred content patterns are not observed demand.');
assert.match(home, /class="header-cta" href="\/#site-audit-url"/, 'Header CTA should lead to the free scanner.');
assert.match(home, /Google PageSpeed Insights/);
assert.match(home, /up to 100 sitemap URLs/i);
assert.match(home, /Finding it can take up to 15 seconds/i);
assert.match(home, /five-second time limit/i);
assert.match(home, /two scan starts and 20 page batches per IP address/i);
assert.match(home, /These limits are not exact and may vary between servers/i);
assert.match(home, /Google may limit how often it can run/i);
assert.match(home, /does not save results from this no-account scan/i);
assert.match(home, /Does Fatorati sell Semrush or earn a commission\?/);
assert.match(home, /not affiliate-tracked/i);
assert.doesNotMatch(home, /rel="sponsored/);
const auditClient = await readPage('site-audit.js');
const themeClient = await readPage('theme-toggle.js');
assert.match(themeClient, /data-theme-toggle/);
assert.match(auditClient, /fetch\('\/api\/scan'/);
assert.match(auditClient, /permissionInput\.checked/);
assert.match(auditClient, /scan-pages/);
assert.match(auditClient, /renderSearchIntelligence/);
const scanFunction = await readFile(path.join(projectRoot, 'functions/api/scan.ts'), 'utf8');
assert.match(scanFunction, /MAX_PAGES_PER_SCAN = 100/);
assert.match(scanFunction, /MAX_PAGES_PER_BATCH = 10/);
assert.match(scanFunction, /MAX_URLS_FROM_SITEMAPS = 5_000/);
assert.match(scanFunction, /Google PageSpeed Insights/);
assert.match(scanFunction, /sameSiteHost/);
assert.match(scanFunction, /isPublicHostname/);
assert.match(scanFunction, /inspectJsonLd/);
assert.match(scanFunction, /extractHeadingEvidence/);
assert.match(scanFunction, /inferPageContentEvidence/);
const intelligenceModule = await readFile(path.join(projectRoot, 'functions/_shared/search-intelligence.ts'), 'utf8');
assert.match(intelligenceModule, /site-content-inferred/);
assert.match(intelligenceModule, /MAX_HEADINGS_PER_PAGE = 18/);
assert.match(intelligenceModule, /MAX_QUESTIONS_PER_PAGE = 6/);
assert.match(auditClient, /jsonld-syntax/);
assert.match(auditClient, /Schema.org or eligibility review/);
const disclosurePage = await readPage('affiliate-disclosure/index.html');
assert.match(disclosurePage, /does not earn commission/i);
assert.match(disclosurePage, /not affiliate-tracked/i);
assert.doesNotMatch(disclosurePage, /rel="sponsored/);

const profile = await readPage('tools/semrush/index.html');
assert.match(profile, /tool-profile-answer/);
assert.match(profile, /class="comparison-table-wrap"/);
assert.match(profile, /class="pros-cons"/);
assert.match(profile, /class="article-disclosure"/);
assert.match(profile, /class="product-link"/);
assert.doesNotMatch(profile, /rel="sponsored/);
assert.match(profile, /not affiliate-tracked/i);
assert.match(profile, /Not a hands-on test/);
assert.match(profile, /class="tool-profile-faq__item"/);
const profileJsonLd = parseJsonLd(profile, 'Semrush profile');
assert.ok(profileJsonLd['@graph'].some((node) => node['@type'] === 'Product'));
assert.ok(profileJsonLd['@graph'].some((node) => node['@type'] === 'FAQPage'));

const article = await readPage('articles/semrush-keyword-research-for-beginners/index.html');
const jsonLd = parseJsonLd(article, 'Article page');
assert.ok(jsonLd['@graph'].some((node) => node['@type'] === 'Article'));
assert.ok(jsonLd['@graph'].some((node) => node['@type'] === 'BreadcrumbList'));
assert.ok(jsonLd['@graph'].some((node) => node['@type'] === 'HowTo'), 'Step-based article should expose a HowTo schema.');
assert.ok(jsonLd['@graph'].some((node) => node['@type'] === 'FAQPage'), 'Visible article questions should expose FAQ schema.');
const articleWebPage = jsonLd['@graph'].find((node) => node['@type'] === 'WebPage');
assert.ok(articleWebPage.abstract, 'Article WebPage should include a direct-answer abstract.');
assert.ok(articleWebPage.speakable?.cssSelector?.includes('.short-answer h2'));

const sitemap = await readFile(path.join(dist, 'sitemap.xml'), 'utf8');
assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
assert.match(sitemap, /<loc>https:\/\/fatorati\.me\/</);
assert.match(sitemap, /https:\/\/fatorati\.me\/articles\/semrush-keyword-research-for-beginners\//);
assert.match(sitemap, /https:\/\/fatorati\.me\/tools\/semrush\//);
assert.match(sitemap, /https:\/\/fatorati\.me\/terms\//);
assert.match(sitemap, /https:\/\/fatorati\.me\/cookies\//);
assert.doesNotMatch(sitemap, /hreflang=|fatorati\.me\/(?:us|uk)\//);

const robots = await readFile(path.join(dist, 'robots.txt'), 'utf8');
assert.match(robots, /User-agent: \*/);
assert.match(robots, /Disallow: \/admin/);
assert.match(robots, /Disallow: \/api\/admin/);
assert.match(robots, /Disallow: \/api\/scan/);
assert.match(robots, /Sitemap: https:\/\/fatorati\.me\/sitemap\.xml/);
assert.match(robots, /Sitemap: https:\/\/fatorati\.me\/ai-sitemap\.xml/);
assert.match(robots, /https:\/\/fatorati\.me\/llms\.txt/);

const llms = await readFile(path.join(dist, 'llms.txt'), 'utf8');
const llmsFull = await readFile(path.join(dist, 'llms-full.txt'), 'utf8');
const aiGuide = await readFile(path.join(dist, 'ai.txt'), 'utf8');
const aiSitemap = await readFile(path.join(dist, 'ai-sitemap.xml'), 'utf8');
const feed = await readFile(path.join(dist, 'feed.xml'), 'utf8');
assert.match(llms, /^# Fatorati/m);
assert.match(llms, /public English HTML routes/i);
assert.match(llms, /https:\/\/fatorati\.me\/articles\/semrush-keyword-research-for-beginners\//);
assert.match(llms, /https:\/\/fatorati\.me\/terms\//);
assert.match(llms, /https:\/\/fatorati\.me\/cookies\//);
assert.match(llms, /https:\/\/fatorati\.me\/llms-full\.txt/);
assert.match(llmsFull, /Semrush keyword research: a beginner's workflow/i);
assert.match(llmsFull, /Direct official product link \(not affiliate-tracked\)/);
assert.doesNotMatch(llmsFull, /Affiliate link \(sponsored\)/);
assert.match(llmsFull, /Public page content/);
assert.match(aiGuide, /Summarize accurately/);
assert.match(aiSitemap, /https:\/\/fatorati\.me\/solutions\//);
assert.doesNotMatch(aiSitemap, /hreflang=|fatorati\.me\/(?:us|uk)\//);
const aiPlugin = JSON.parse(await readFile(path.join(dist, '.well-known/ai-plugin.json'), 'utf8'));
const openApi = JSON.parse(await readFile(path.join(dist, '.well-known/openapi.json'), 'utf8'));
assert.equal(aiPlugin.api.url, 'https://fatorati.me/.well-known/openapi.json');
assert.equal(openApi.openapi, '3.0.3');
assert.ok(openApi.paths['/llms.txt']?.get);
assert.ok(openApi.paths['/articles/semrush-keyword-research-for-beginners/']?.get);
assert.ok(openApi.paths['/terms/']?.get);
assert.ok(openApi.paths['/cookies/']?.get);
assert.doesNotMatch(JSON.stringify(openApi.paths), /"(?:post|put|patch|delete)"\s*:/i);
assert.match(feed, /<rss version="2.0"/);
assert.match(feed, /<atom:link href="https:\/\/fatorati\.me\/feed\.xml" rel="self" type="application\/rss\+xml" \/>/);
assert.match(feed, /<item>/);
assert.match(feed, /https:\/\/fatorati\.me\/articles\/semrush-keyword-research-for-beginners\//);
assert.match(await readPage('articles/index.html'), /href="\/feed\.xml"/);

const adminPage = await readPage('admin/index.html');
assertNoExecutableInlineScripts(adminPage, 'admin page');
assert.match(adminPage, /\/_astro\/[^\"]+\.js/);
assert.match(adminPage, /<meta name="robots" content="noindex, nofollow, noarchive"/);
assert.match(await readFile(path.join(dist, '_headers'), 'utf8'), /\/admin\/\*/);
assert.match(await readFile(path.join(dist, '_headers'), 'utf8'), /\/api\/scan/);
assert.match(await readFile(path.join(dist, '_headers'), 'utf8'), /X-Robots-Tag: noindex, nofollow, noarchive/);
assert.match(await readFile(path.join(dist, '_headers'), 'utf8'), /script-src 'self'/);
assert.doesNotMatch(sitemap, /\/admin\//);
const redirects = await readFile(path.join(projectRoot, 'public/_redirects'), 'utf8');
assert.match(redirects, /^\/us\/ \/ 301/m);
assert.match(redirects, /^\/uk\/ \/ 301/m);
assert.match(redirects, /^\/us\/\* \/:splat 301/m);
assert.match(redirects, /^\/uk\/\* \/:splat 301/m);
assert.doesNotMatch(redirects, /^\/ \/.* 301/m, 'The canonical homepage should no longer redirect.');

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

const generatedText = (await Promise.all((await walkFiles(dist))
  .filter((file) => /\.(?:html|xml|txt|json|svg|js|css|toml)$/i.test(file))
  .map((file) => readFile(file, 'utf8')))).join('\n');
const forbiddenPatterns = [
  { label: 'Mizan branding', pattern: /mizan/i },
  { label: 'Arabic text', pattern: /[\u0600-\u06ff]/u },
  { label: 'right-to-left markup', pattern: /dir\s*=\s*["']rtl["']/i },
  { label: 'Google Analytics identifier', pattern: /\bG-[A-Z0-9]{7,}\b/ },
  { label: 'Google Tag Manager identifier', pattern: /\bGTM-[A-Z0-9]+\b/ },
  { label: 'legacy Analytics identifier', pattern: /\bUA-\d{4,}-\d+\b/ },
  { label: 'Google verification token', pattern: /google-site-verification/i },
  { label: 'live secret-like token', pattern: /\b(?:sk_live|rk_live|whsec)_[A-Za-z0-9_-]{8,}\b/ },
  { label: 'retired consumer-tech starter content', pattern: /best-password-managers|travel-noise-cancelling-headphones|choose-a-usb-c-dock|INDEPENDENT BUYING GUIDES/i },
];
for (const item of forbiddenPatterns) {
  assert.doesNotMatch(generatedText, item.pattern, `Generated output contains a ${item.label}.`);
}

console.log(`Build validation passed: ${requiredPages.length} clean English routes, SEO metadata, structured data, feeds, AI discovery files, access headers, and clean output checked.`);
