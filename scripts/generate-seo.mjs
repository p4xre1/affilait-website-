import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const siteOrigin = 'https://fatorati.me';

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile() && entry.name.endsWith('.html')) files.push(absolute);
  }
  return files;
}

function publicPath(absolutePath) {
  const relative = path.relative(root, absolutePath).split(path.sep).join('/');
  if (relative === 'index.html') return '/';
  if (relative.endsWith('/index.html')) return `/${relative.slice(0, -'index.html'.length)}`;
  return `/${relative.replace(/\.html$/, '')}/`;
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

const pages = [...new Set((await walk(root)).map(publicPath))]
  .filter((route) => route !== '/404/' && !route.startsWith('/admin/') && !route.startsWith('/api/'))
  .sort((a, b) => a.localeCompare(b));

if (pages.length === 0) {
  throw new Error('No public HTML pages found. Build the site before generating the sitemap.');
}

const entries = pages.map((route) => `  <url>\n    <loc>${escapeXml(`${siteOrigin}${route}`)}</loc>\n  </url>`);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
await writeFile(path.join(root, 'sitemap.xml'), sitemap, 'utf8');
console.log(`Generated sitemap.xml with ${entries.length} public English URLs.`);
