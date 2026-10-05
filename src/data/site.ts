export const SITE = {
  name: 'Fatorati',
  domain: 'fatorati.me',
  url: 'https://fatorati.me',
  description: 'Free website SEO checks, transparent technical findings, and practical next steps for site owners.',
  socialImage: '/social-card.png',
  author: 'The Fatorati editorial team',
} as const;

export const EDITIONS = {
  en: {
    code: 'en',
    label: 'English',
    shortLabel: 'English',
    language: 'en',
  },
} as const;

export type EditionCode = keyof typeof EDITIONS;
export type Edition = (typeof EDITIONS)[EditionCode];

export interface Category {
  slug: string;
  title: string;
  eyebrow: string;
  description: string;
  number: string;
}

export const CATEGORIES: Category[] = [
  {
    slug: 'semrush-guides',
    title: 'Semrush guides',
    eyebrow: 'SEO tools, explained',
    description: 'Straightforward tutorials and independent tool guidance for making better SEO decisions.',
    number: '01',
  },
  {
    slug: 'education',
    title: 'Education SEO',
    eyebrow: 'For learning teams',
    description: 'Useful search strategies for schools, universities, course creators, and education publishers.',
    number: '02',
  },
  {
    slug: 'editorial',
    title: 'Editorial workflows',
    eyebrow: 'For publishers',
    description: 'Research-first content processes that put readers, evidence, and editor judgment first.',
    number: '03',
  },
];

export function getEdition(_code?: string): Edition {
  return EDITIONS.en;
}

export function getCategory(slug: string): Category {
  const category = CATEGORIES.find((item) => item.slug === slug);
  if (!category) throw new Error(`Unknown category: ${slug}`);
  return category;
}

function cleanRoute(routePath = ''): string {
  return routePath.replace(/^\/+|\/+$/g, '');
}

export function localizedPath(_code: EditionCode, routePath = ''): string {
  const route = cleanRoute(routePath);
  return route ? `/${route}/` : '/';
}

export function absolutePageUrl(_code: EditionCode, routePath = ''): string {
  return new URL(localizedPath('en', routePath), SITE.url).toString();
}

export function formatDate(date: Date, edition: Edition = EDITIONS.en): string {
  return new Intl.DateTimeFormat(edition.language, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
