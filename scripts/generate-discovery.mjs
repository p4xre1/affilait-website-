import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const articleDirectory = path.join(root, 'src/content/articles');
const outputDirectory = path.join(root, 'dist');
const siteOrigin = 'https://fatorati.me';

function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function asDate(value) {
  const date = value instanceof Date ? value : new Date(`${String(value)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid article date: ${value}`);
  return date;
}

const filenames = (await readdir(articleDirectory)).filter((name) => name.endsWith('.md')).sort();
const articles = await Promise.all(filenames.map(async (filename) => {
  const source = await readFile(path.join(articleDirectory, filename), 'utf8');
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) throw new Error(`Article has no YAML frontmatter: ${filename}`);
  const metadata = parseYaml(frontmatter[1]);
  const slug = filename.slice(0, -3);
  return { slug, metadata, published: asDate(metadata.publishedAt) };
}));
articles.sort((a, b) => b.published.getTime() - a.published.getTime() || a.slug.localeCompare(b.slug));

const items = articles.map(({ slug, metadata, published }) => {
  const link = `${siteOrigin}/articles/${slug}/`;
  const description = metadata.shortAnswer || metadata.description;
  return `  <item>\n    <title>${xml(metadata.title)}</title>\n    <link>${xml(link)}</link>\n    <guid isPermaLink="true">${xml(link)}</guid>\n    <pubDate>${xml(published.toUTCString())}</pubDate>\n    <description>${xml(description)}</description>\n    <category>${xml(metadata.category)}</category>\n  </item>`;
});
const rss = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n  <title>Fatorati — SEO education and Semrush guides</title>\n  <link>${siteOrigin}/</link>\n  <description>Research-led SEO education, Semrush tutorials, and editorial workflow guides from Fatorati.</description>\n  <language>en</language>\n  <atom:link href="${siteOrigin}/feed.xml" rel="self" type="application/rss+xml" />\n  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n${items.join('\n')}\n</channel>\n</rss>\n`;

await writeFile(path.join(outputDirectory, 'feed.xml'), rss, 'utf8');
console.log(`Generated RSS 2.0 feed.xml for ${articles.length} articles.`);
