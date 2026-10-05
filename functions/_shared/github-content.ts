import { parse as parseYaml } from 'yaml';
import type { AdminEnv } from './admin-auth';

const CONTENT_DIRECTORY = 'src/content/articles';
const CONTENT_LIMIT_BYTES = 250_000;
const CATEGORY_VALUES = new Set(['semrush-guides', 'education', 'editorial']);
const GITHUB_API = 'https://api.github.com';

export interface ArticleSummary {
  slug: string;
  title: string;
  category: string;
  publishedAt: string;
  sha: string;
}

export interface ArticleRecord extends ArticleSummary {
  content: string;
}

interface GitHubFile {
  name: string;
  path: string;
  type: string;
  sha: string;
  content?: string;
  encoding?: string;
}

export class ContentApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ContentApiError';
  }
}

function repositoryConfig(env: AdminEnv) {
  const token = env.GITHUB_TOKEN?.trim();
  const owner = env.GITHUB_OWNER?.trim();
  const repository = env.GITHUB_REPO?.trim();
  const branch = env.GITHUB_BRANCH?.trim() || 'main';
  if (!token || !owner || !repository) {
    throw new ContentApiError('The editorial repository is not configured. Contact the site administrator.', 503);
  }
  return { token, owner, repository, branch };
}

function apiUrl(env: AdminEnv, path: string, query?: Record<string, string>): URL {
  const { owner, repository } = repositoryConfig(env);
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const url = new URL(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${encodedPath}`, GITHUB_API);
  if (query) {
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  }
  return url;
}

async function githubFetch(env: AdminEnv, url: URL, init: RequestInit = {}): Promise<Response> {
  const { token } = repositoryConfig(env);
  return fetch(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers ?? {}),
    },
  });
}

async function readGitHubFile(env: AdminEnv, path: string): Promise<GitHubFile | null> {
  const { branch } = repositoryConfig(env);
  const response = await githubFetch(env, apiUrl(env, path, { ref: branch }));
  if (response.status === 404) return null;
  if (!response.ok) {
    console.error('GitHub content read failed:', response.status);
    throw new ContentApiError('Could not read article content from the repository.', 502);
  }
  const file = await response.json() as GitHubFile;
  if (!file || file.type !== 'file' || typeof file.sha !== 'string') {
    throw new ContentApiError('The requested article was not found in the repository.', 404);
  }
  return file;
}

function decodeGitHubFile(file: GitHubFile): string {
  if (file.encoding !== 'base64' || typeof file.content !== 'string') {
    throw new ContentApiError('The repository returned an unsupported article format.', 502);
  }
  try {
    const binary = atob(file.content.replace(/\s/g, ''));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ContentApiError('The repository article could not be decoded.', 502);
  }
}

function parseFrontmatter(markdown: string): Record<string, unknown> {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match || match[1].length > 32_000) {
    throw new ContentApiError('Article must begin with a valid YAML frontmatter block.', 400);
  }
  try {
    const metadata: unknown = parseYaml(match[1], { maxAliasCount: 0 });
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new Error('Frontmatter must be an object.');
    }
    return metadata as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ContentApiError) throw error;
    throw new ContentApiError('Article frontmatter contains invalid YAML.', 400);
  }
}

function requireString(record: Record<string, unknown>, key: string, minimum: number, maximum = Number.POSITIVE_INFINITY): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length < minimum || value.trim().length > maximum) {
    throw new ContentApiError(`Article field “${key}” must contain ${minimum}${Number.isFinite(maximum) ? `–${maximum}` : ' or more'} characters.`, 400);
  }
  return value.trim();
}

function requireDate(record: Record<string, unknown>, key: string, optional = false): string | undefined {
  const value = record[key];
  if (value === undefined && optional) return undefined;
  const normalized = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  const parsed = typeof normalized === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? new Date(`${normalized}T00:00:00Z`)
    : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new ContentApiError(`Article field “${key}” must be a valid YYYY-MM-DD date.`, 400);
  }
  return normalized as string;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContentApiError(`${label} must be a YAML object.`, 400);
  }
  return value as Record<string, unknown>;
}

function validateMarkdown(markdown: string): { title: string; category: string; publishedAt: string } {
  if (!markdown.trim()) throw new ContentApiError('Article content cannot be empty.', 400);
  const metadata = parseFrontmatter(markdown);
  const title = requireString(metadata, 'title', 8);
  requireString(metadata, 'description', 50, 180);
  const category = requireString(metadata, 'category', 1);
  if (!CATEGORY_VALUES.has(category)) {
    throw new ContentApiError('Category must be semrush-guides, education, or editorial.', 400);
  }
  const publishedAt = requireDate(metadata, 'publishedAt')!;
  requireDate(metadata, 'updatedAt', true);
  if (!Number.isInteger(metadata.readTime) || Number(metadata.readTime) < 1) {
    throw new ContentApiError('Article field “readTime” must be a positive whole number.', 400);
  }
  requireString(metadata, 'shortAnswer', 40);
  requireString(metadata, 'topPick', 2);

  if (!Array.isArray(metadata.comparison) || metadata.comparison.length < 2) {
    throw new ContentApiError('Comparison must include at least two options.', 400);
  }
  for (const [index, item] of metadata.comparison.entries()) {
    const row = requireRecord(item, `Comparison option ${index + 1}`);
    requireString(row, 'product', 2);
    requireString(row, 'bestFor', 8);
    requireString(row, 'standout', 8);
    requireString(row, 'keepInMind', 8);
  }
  for (const key of ['pros', 'cons']) {
    const items = metadata[key];
    if (!Array.isArray(items) || items.length < 2 || items.some((item) => typeof item !== 'string' || item.trim().length < 4)) {
      throw new ContentApiError(`Article field “${key}” must be a list with at least two useful points.`, 400);
    }
  }

  const productLink = requireRecord(metadata.productLink, 'External product link');
  requireString(productLink, 'product', 2);
  requireString(productLink, 'label', 3);
  const productHref = requireString(productLink, 'href', 1);
  try {
    if (new URL(productHref).protocol !== 'https:') throw new Error('HTTPS required');
  } catch {
    throw new ContentApiError('External product links must use a valid HTTPS URL.', 400);
  }

  if (metadata.sources !== undefined) {
    if (!Array.isArray(metadata.sources)) throw new ContentApiError('Sources must be a YAML list.', 400);
    for (const [index, item] of metadata.sources.entries()) {
      const source = requireRecord(item, `Source ${index + 1}`);
      requireString(source, 'label', 3);
      const href = requireString(source, 'href', 1);
      try {
        if (new URL(href).protocol !== 'https:') throw new Error('HTTPS required');
      } catch {
        throw new ContentApiError('Source links must use valid HTTPS URLs.', 400);
      }
    }
  }

  if (metadata.featured !== undefined && typeof metadata.featured !== 'boolean') {
    throw new ContentApiError('Article field “featured” must be true or false.', 400);
  }
  const bodyMatch = markdown.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!bodyMatch?.[1].trim()) {
    throw new ContentApiError('Article body cannot be empty.', 400);
  }
  return { title, category, publishedAt };
}

function safeMetadata(markdown: string, slug: string): { title: string; category: string; publishedAt: string } {
  try {
    return validateMarkdown(markdown);
  } catch (error) {
    if (!(error instanceof ContentApiError) || error.status !== 400) throw error;
    const fallbackTitle = slug.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
    return { title: fallbackTitle, category: 'Needs review', publishedAt: '' };
  }
}

function articlePath(slug: string): string {
  if (slug.length < 2 || slug.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new ContentApiError('Slug must use 2–80 lowercase letters, numbers, and single hyphens.', 400);
  }
  return `${CONTENT_DIRECTORY}/${slug}.md`;
}

export async function listArticles(env: AdminEnv): Promise<ArticleSummary[]> {
  const { branch } = repositoryConfig(env);
  const response = await githubFetch(env, apiUrl(env, CONTENT_DIRECTORY, { ref: branch }));
  if (!response.ok) {
    console.error('GitHub article list failed:', response.status);
    throw new ContentApiError('Could not list articles from the repository.', 502);
  }
  const entries = await response.json() as GitHubFile[];
  if (!Array.isArray(entries)) throw new ContentApiError('The repository returned an invalid article list.', 502);
  const markdownFiles = entries.filter((entry) => entry.type === 'file' && entry.name.endsWith('.md'));
  if (markdownFiles.length > 100) throw new ContentApiError('The article library exceeds the dashboard limit of 100 files.', 413);

  const articles = await Promise.all(markdownFiles.map(async (entry) => {
    const slug = entry.name.slice(0, -3);
    try {
      articlePath(slug);
    } catch {
      return null;
    }
    const file = await readGitHubFile(env, entry.path);
    if (!file) return null;
    const content = decodeGitHubFile(file);
    const metadata = safeMetadata(content, slug);
    return { slug, title: metadata.title, category: metadata.category, publishedAt: metadata.publishedAt, sha: file.sha } satisfies ArticleSummary;
  }));
  return articles.filter((article): article is ArticleSummary => article !== null)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function getArticle(env: AdminEnv, slug: string): Promise<ArticleRecord> {
  const path = articlePath(slug);
  const file = await readGitHubFile(env, path);
  if (!file) throw new ContentApiError('Article not found in the repository.', 404);
  const content = decodeGitHubFile(file);
  const metadata = safeMetadata(content, slug);
  return { slug, title: metadata.title, category: metadata.category, publishedAt: metadata.publishedAt, content, sha: file.sha };
}

export async function saveArticle(
  env: AdminEnv,
  input: { slug: string; content: string; expectedSha?: string },
): Promise<{ slug: string; title: string; sha: string; commitUrl?: string }> {
  const path = articlePath(input.slug);
  const contentBytes = new TextEncoder().encode(input.content);
  if (contentBytes.byteLength > CONTENT_LIMIT_BYTES) {
    throw new ContentApiError('Article source is too large. Maximum size is 250 KB.', 413);
  }
  const metadata = validateMarkdown(input.content);
  const { branch } = repositoryConfig(env);
  const currentFile = await readGitHubFile(env, path);
  if (currentFile && currentFile.sha !== input.expectedSha) {
    throw new ContentApiError('This article changed in the repository since it was opened. Refresh the list and reload it before saving.', 409);
  }
  if (!currentFile && input.expectedSha) {
    throw new ContentApiError('This article no longer exists on the selected branch. Refresh the list before saving.', 409);
  }

  const bytes = contentBytes;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  const body: Record<string, unknown> = {
    message: `content(site): ${currentFile ? 'update' : 'add'} article ${input.slug}`,
    content: btoa(binary),
    branch,
  };
  if (currentFile) body.sha = currentFile.sha;

  const response = await githubFetch(env, apiUrl(env, path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    console.error('GitHub article save failed:', response.status);
    if (response.status === 409 || response.status === 422) {
      throw new ContentApiError('GitHub could not apply this change. Refresh the article list and try again.', 409);
    }
    throw new ContentApiError('Could not publish article to the repository.', 502);
  }
  const result = await response.json() as { content?: { sha?: string }; commit?: { html_url?: string } };
  const sha = result.content?.sha;
  if (!sha) throw new ContentApiError('GitHub saved the file but returned no article revision.', 502);
  return { slug: input.slug, title: metadata.title, sha, commitUrl: result.commit?.html_url };
}
