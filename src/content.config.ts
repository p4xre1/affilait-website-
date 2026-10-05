import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

const articles = defineCollection({
  loader: glob({ base: './src/content/articles', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string().min(8),
    description: z.string().min(50).max(180),
    category: z.enum(['semrush-guides', 'education', 'editorial']),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    readTime: z.number().int().positive(),
    shortAnswer: z.string().min(40),
    featured: z.boolean().default(false),
    topPick: z.string().min(2),
    comparison: z.array(z.object({
      product: z.string().min(2),
      bestFor: z.string().min(8),
      standout: z.string().min(8),
      keepInMind: z.string().min(8),
    })).min(2),
    pros: z.array(z.string().min(4)).min(2),
    cons: z.array(z.string().min(4)).min(2),
    productLink: z.object({
      product: z.string().min(2),
      label: z.string().min(3),
      href: z.url().refine((value) => new URL(value).protocol === 'https:', 'Product links must use HTTPS.'),
    }),
    sources: z.array(z.object({
      label: z.string().min(3),
      href: z.url().refine((value) => new URL(value).protocol === 'https:', 'Sources must use HTTPS.'),
    })).default([]),
  }),
});

export const collections = { articles };
