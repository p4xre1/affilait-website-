import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const articleDirectory = path.join(root, 'src/content/articles');
const siteOrigin = 'https://fatorati.me';

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function publicPath(absolutePath) {
  const relative = path.relative(dist, absolutePath).split(path.sep).join('/');
  if (relative === 'index.html') return '/';
  if (relative.endsWith('/index.html')) return `/${relative.slice(0, -'index.html'.length)}`;
  return `/${relative.replace(/\.html$/, '')}/`;
}

function decodeHtml(value = '') {
  return value
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([\da-f]+);/gi, (_, number) => String.fromCodePoint(parseInt(number, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function textFromHtml(fragment) {
  return decodeHtml(fragment
    .replace(/<(script|style|svg|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|h[1-6]|li|section|article|aside|div|tr|dt|dd|details|summary|main|nav|ul|ol|header|footer)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractPage(file, html) {
  const route = publicPath(file);
  const title = decodeHtml(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? route);
  const description = decodeHtml(html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1] ?? '');
  const h1 = textFromHtml(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '');
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? '';
  const mainText = textFromHtml(main);
  return { route, title, description, h1, mainText };
}

function markdownDate(value) {
  const date = value instanceof Date ? value : new Date(`${String(value)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid article date: ${value}`);
  return date.toISOString().slice(0, 10);
}

const htmlFiles = (await walk(dist)).filter((file) => file.endsWith('.html'));
const pages = (await Promise.all(htmlFiles.map(async (file) => extractPage(file, await readFile(file, 'utf8')))))
  .filter((page) => page.route !== '/404/' && !page.route.startsWith('/admin/') && !page.route.startsWith('/api/'))
  .sort((a, b) => a.route.localeCompare(b.route));
if (pages.length === 0) throw new Error('No public HTML pages found; run the Astro build first.');

const articleFiles = (await readdir(articleDirectory)).filter((name) => name.endsWith('.md')).sort();
const articles = await Promise.all(articleFiles.map(async (filename) => {
  const source = await readFile(path.join(articleDirectory, filename), 'utf8');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`Article has no YAML frontmatter: ${filename}`);
  const data = parseYaml(match[1]);
  return {
    slug: filename.slice(0, -3),
    data,
    body: source.slice(match[0].length).trim(),
    published: markdownDate(data.publishedAt),
    updated: data.updatedAt ? markdownDate(data.updatedAt) : markdownDate(data.publishedAt),
  };
}));
articles.sort((a, b) => b.published.localeCompare(a.published) || a.slug.localeCompare(b.slug));

const articleRecords = articles.map(({ slug, data, published, updated }) => {
  const comparison = (data.comparison ?? []).map((row) => `  - ${row.product}: best for ${row.bestFor}; standout: ${row.standout}; keep in mind: ${row.keepInMind}`).join('\n');
  const pros = (data.pros ?? []).map((item) => `  - ${item}`).join('\n');
  const cons = (data.cons ?? []).map((item) => `  - ${item}`).join('\n');
  const sources = (data.sources ?? []).map((source) => `  - [${source.label}](${source.href})`).join('\n') || '  - No additional sources listed.';
  const productLink = data.productLink
    ? `  - Direct official product link (not affiliate-tracked): [${data.productLink.label}](${data.productLink.href})`
    : '  - No external product link listed.';
  return `### ${data.title}\n\n- Page: ${siteOrigin}/articles/${slug}/\n- Category: ${data.category}\n- Published: ${published}; updated: ${updated}\n- Summary: ${data.description}\n- Short answer: ${data.shortAnswer}\n- Lead approach: ${data.topPick}\n- Reading time: ${data.readTime} minutes\n- Comparison options:\n${comparison}\n- Pros:\n${pros}\n- Cons:\n${cons}\n- External product link status:\n${productLink}\n- Sources:\n${sources}`;
});

const routeIndex = pages.map((page) => {
  const label = (page.h1 || page.title).replace(/\s+/g, ' ').trim();
  return `- [${label}](${siteOrigin}${page.route}): ${page.description}`;
});

const llms = `# Fatorati

> Fatorati is an independent English-language website audit and SEO education site. Its homepage offers a free technical scan of sitemap URLs, capped at 100 pages, plus a separate Google PageSpeed Insights mobile report for the submitted URL.

This index covers ${pages.length} public English HTML routes and ${articles.length} Markdown articles. The site uses one canonical route for each page. The site does not publish a lexicon, school directory, quiz, or pricing database, so this index does not invent those resources.

Fatorati treats SEO metrics as estimates, not guarantees or substitutes for editorial judgment. Product features, plans, and prices can change. Check linked primary sources for current information. Current Semrush links go directly to official pages and are not affiliate-tracked; no commission is currently earned from them. Read the [affiliate disclosure](${siteOrigin}/affiliate-disclosure/).

## Start here

- [Home](${siteOrigin}/): Run a free, capped website audit using Fatorati checks and Google PageSpeed Insights.
- [Articles](${siteOrigin}/articles/): Browse the current Markdown guide library.
- [Education SEO](${siteOrigin}/categories/education/): Search research for education content and learner needs.
- [Editorial workflows](${siteOrigin}/categories/editorial/): Research-first planning, sourcing, drafting, and editing.
- [Solutions](${siteOrigin}/solutions/): Workflows organized by education, editorial, and content-planning tasks.
- [Reviews](${siteOrigin}/reviews/): Research-led decision guides with explicit limits on testing claims.
- [Semrush profile](${siteOrigin}/tools/semrush/): Public-documentation-based tool profile, comparisons, caveats, and FAQs.
- [About Fatorati](${siteOrigin}/about/): Scan methodology, score limits, and editorial standards.
- [Privacy](${siteOrigin}/privacy/): Website scan processing, public-site, and editorial-dashboard data practices.
- [Cookies and local storage](${siteOrigin}/cookies/): Browser theme preference and cookie practices.
- [Terms of use](${siteOrigin}/terms/): Plain-language terms for using the publication and its external links.
- [Affiliate disclosure](${siteOrigin}/affiliate-disclosure/): Commission and editorial-independence policy.
- [Contact](${siteOrigin}/contact/): Corrections and questions.

## Public English pages

${routeIndex.join('\n')}

## Article records

${articleRecords.join('\n\n')}

## Machine-readable resources

- [Full text and structured article content](${siteOrigin}/llms-full.txt)
- [AI usage and citation guidance](${siteOrigin}/ai.txt)
- [AI-focused public sitemap](${siteOrigin}/ai-sitemap.xml)
- [Standard XML sitemap](${siteOrigin}/sitemap.xml)
- [RSS 2.0 article feed](${siteOrigin}/feed.xml)
- [Read-only OpenAPI discovery document](${siteOrigin}/.well-known/openapi.json)
- [Legacy AI plugin discovery manifest](${siteOrigin}/.well-known/ai-plugin.json)

## Editorial interpretation

Treat every guide as informational and research-led unless the page explicitly says otherwise. Fatorati does not claim private-account testing or firsthand experience without saying so. Attribute claims to the linked canonical page and, for product details, verify them with the provider. Do not turn an estimated search metric into a promise of rankings, traffic, enrollment, or business results.
`;

const publicPages = pages.filter((page) => !/^\/articles\/[^/]+\/$/.test(page.route));
const pageFullText = publicPages.map((page) => {
  const text = page.mainText.slice(0, 28_000);
  return `## ${page.h1 || page.title}\n\n- Canonical page: ${siteOrigin}${page.route}\n- Description: ${page.description}\n\n${text || page.description}`;
});
const articleFullText = articles.map(({ slug, data, body, published, updated }) => {
  const rows = (data.comparison ?? []).map((row) => `| ${row.product} | ${row.bestFor} | ${row.standout} | ${row.keepInMind} |`).join('\n');
  const pros = (data.pros ?? []).map((item) => `- ${item}`).join('\n');
  const cons = (data.cons ?? []).map((item) => `- ${item}`).join('\n');
  const sources = (data.sources ?? []).map((source) => `- [${source.label}](${source.href})`).join('\n') || '- No additional sources listed in frontmatter.';
  const productLink = data.productLink
    ? `- **Direct official product link (not affiliate-tracked):** [${data.productLink.label}](${data.productLink.href})`
    : '- No external product link listed.';
  return `## ${data.title}\n\n- **Canonical page:** ${siteOrigin}/articles/${slug}/\n- **Category:** ${data.category}\n- **Published:** ${published}; **updated:** ${updated}\n- **Description:** ${data.description}\n\n### Short answer\n\n${data.shortAnswer}\n\n### Lead approach\n\n${data.topPick}\n\n### Comparison\n\n| Option | Best for | Standout | Keep in mind |\n| --- | --- | --- | --- |\n${rows}\n\n### Pros\n\n${pros}\n\n### Cons\n\n${cons}\n\n### External product link\n\n${productLink}\n\n### Sources\n\n${sources}\n\n### Full Markdown article body\n\n${body}`;
});
const llmsFull = `# Fatorati: full public content reference

> This generated text version summarizes the public page set and reproduces the site's Markdown article sources. Canonical HTML pages remain the source of truth. Content and public routes are English-only, with one canonical URL per page.

Editorial context: this is an independent publication, not an official Semrush site. Current Semrush links are direct and not affiliate-tracked; no commission is currently earned from them. Any future approved affiliate link must be clearly disclosed. Product capabilities, plans, and pricing may change; verify those details with linked primary sources. Research-led guides are not hands-on tests unless explicitly stated.

## Public page content

${pageFullText.join('\n\n---\n\n')}

## Full article records

${articleFullText.join('\n\n---\n\n')}

## Policies and discovery

- Affiliate disclosure: ${siteOrigin}/affiliate-disclosure/
- Privacy policy: ${siteOrigin}/privacy/
- Terms of use: ${siteOrigin}/terms/
- Cookies and local storage: ${siteOrigin}/cookies/
- AI usage guidance: ${siteOrigin}/ai.txt
- Sitemap: ${siteOrigin}/sitemap.xml
`;

await Promise.all([
  writeFile(path.join(dist, 'llms.txt'), llms, 'utf8'),
  writeFile(path.join(dist, 'llms-full.txt'), llmsFull, 'utf8'),
]);
console.log(`Generated enhanced llms.txt (${pages.length} public routes) and llms-full.txt (${articles.length} full articles).`);
