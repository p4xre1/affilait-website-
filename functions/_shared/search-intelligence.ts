export type ModifierCategory =
  | 'commercial'
  | 'comparison'
  | 'audience'
  | 'constraint'
  | 'compatibility'
  | 'location'
  | 'informational'
  | 'post-purchase'
  | 'context'
  | 'recommendation'
  | 'risk';

export type SearchIntent =
  | 'informational'
  | 'navigational'
  | 'commercial-investigation'
  | 'transactional'
  | 'local'
  | 'post-purchase-support';

export type FunnelStage = 'awareness' | 'consideration' | 'conversion' | 'retention' | 'navigation';
export type PageRole =
  | 'homepage'
  | 'category'
  | 'subcategory'
  | 'product'
  | 'service'
  | 'commercial-landing'
  | 'comparison'
  | 'buying-guide'
  | 'blog-article'
  | 'informational-guide'
  | 'faq'
  | 'documentation'
  | 'location'
  | 'author'
  | 'legal'
  | 'utility'
  | 'other';
export type ContentFormat =
  | 'comparison'
  | 'curated-recommendations'
  | 'step-by-step-guide'
  | 'definition'
  | 'pricing-information'
  | 'troubleshooting-guide'
  | 'setup-guide'
  | 'local-landing-page'
  | 'unspecified';
export type QuerySource = 'manual' | 'site-content-inferred' | 'search-console' | 'keyword-provider' | 'internal-search';

/** Character offsets refer to `SearchQuery.normalizedQuery`; a detected modifier is not a separate page recommendation. */
export interface QueryModifier {
  text: string;
  category: ModifierCategory;
  value?: string;
  start: number;
  end: number;
  confidence: number;
}

export interface QueryConstraint {
  text: string;
  kind: 'price' | 'feature' | 'availability' | 'compatibility' | 'location' | 'other';
  value?: string;
  unit?: string;
  confidence: number;
}

export interface EntityReference {
  text: string;
  type?: string;
  confidence: number;
}

export interface IntentSignal {
  label: SearchIntent;
  confidence: number;
  evidence: string[];
}

/** Query interpretation only; confidence is not search-demand or ranking probability. */
export interface SearchQuery {
  id: string;
  rawQuery: string;
  normalizedQuery: string;
  language?: string;
  country?: string;
  tokens: string[];
  topic?: string;
  head?: string;
  modifiers: QueryModifier[];
  entities: EntityReference[];
  attributes: string[];
  constraints: QueryConstraint[];
  audience: string[];
  location: string[];
  context: string[];
  intent?: { primary?: SearchIntent; labels: IntentSignal[] };
  microIntent: string[];
  funnelStage?: FunnelStage;
  expectedPageRole?: PageRole;
  expectedContentFormat?: ContentFormat;
  source: QuerySource[];
  searchVolume?: number;
  competition?: number;
  confidence: number;
}

export interface SearchTopic {
  id: string;
  label: string;
  normalizedLabel: string;
  aliases: string[];
  queryIds: string[];
  source: QuerySource[];
  confidence: number;
  evidence: OpportunityEvidence[];
}

/** Variant relation is recorded as evidence; it does not imply deduplication or shared intent. */
export interface QueryVariant {
  queryId: string;
  relatedQueryId: string;
  relation: 'singular-plural' | 'word-order' | 'spelling' | 'long-tail' | 'modifier' | 'audience' | 'compatibility' | 'other';
  confidence: number;
  reason: string;
}

export interface QueryCluster {
  id: string;
  topicId: string;
  primaryQueryId: string;
  queryIds: string[];
  intent?: SearchIntent;
  microIntent: string[];
  variants: QueryVariant[];
  confidence: number;
  evidence: OpportunityEvidence[];
}

/** Topic overlap alone is insufficient; this is review-only and never triggers a merge, redirect, or new page. */
export interface CannibalizationCandidate {
  pageUrls: string[];
  topicOverlap: number;
  intentOverlap?: number;
  pageRoleOverlap?: number;
  queryOverlap?: number;
  serpOverlap?: number;
  confidence: number;
  evidence: OpportunityEvidence[];
  requiresHumanReview: true;
}

export interface ModifierDefinition {
  phrase: string;
  category: ModifierCategory;
  value?: string;
  microIntent?: string;
  contentFormat?: ContentFormat;
}

export interface QuestionEvidence {
  text: string;
  pageUrl: string;
  headingLevel: number;
  confidence: number;
  query: SearchQuery;
}

/** Page-role and topic confidence describe rule evidence, not performance likelihood. */
export interface PageRoleEvidence {
  role: PageRole;
  confidence: number;
  signals: string[];
}

export interface PageSearchEvidence {
  source: 'crawl';
  language: string | null;
  primaryTopic: string | null;
  topicConfidence: number;
  pageRole: PageRoleEvidence;
  headingEvidence: Array<{ level: number; text: string }>;
  questions: QuestionEvidence[];
  note: string;
}

export interface PageContentInput {
  url: string;
  title: string;
  description: string;
  htmlLang: string | null;
  headings: Array<{ level: number; text: string }>;
}

export interface SearchConsoleProvider {
  queriesForSite(options?: { startDate?: string; endDate?: string; country?: string; limit?: number }): Promise<SearchQuery[]>;
}

export interface KeywordProvider {
  discover(seed: string, options?: { language?: string; country?: string; limit?: number }): Promise<SearchQuery[]>;
  related(seed: string, options?: { language?: string; country?: string; limit?: number }): Promise<SearchQuery[]>;
  questions(seed: string, options?: { language?: string; country?: string; limit?: number }): Promise<SearchQuery[]>;
  metrics(queries: string[], options?: { language?: string; country?: string }): Promise<Array<Pick<SearchQuery, 'rawQuery' | 'searchVolume' | 'competition' | 'source'>>>;
}

export interface SERPProvider {
  resultsForQuery(query: string, options?: { language?: string; country?: string; limit?: number }): Promise<Array<{ url: string; title?: string; rank?: number }>>;
}

export interface AnalyticsProvider {
  conversionsForQueries(queries: string[], options?: { startDate?: string; endDate?: string }): Promise<Array<{ query: string; conversions: number; source: string }>>;
}

export interface BacklinkProvider {
  referringDomainsForPages(urls: string[]): Promise<Array<{ url: string; referringDomains: number; source: string }>>;
}

export interface TopicPageMapping {
  topic: string;
  queryId: string;
  pageUrl?: string;
  fit: 'strong' | 'partial' | 'weak' | 'none';
  confidence: number;
  evidence: string[];
}

export interface OpportunityEvidence {
  source: QuerySource | 'crawl' | 'serp' | 'analytics' | 'backlinks';
  description: string;
  url?: string;
  value?: string | number;
}

export interface SearchOpportunity {
  id: string;
  topic: string;
  queryIds: string[];
  recommendedAction: string;
  priority?: 'low' | 'medium' | 'high';
  confidence: number;
  effort?: 'low' | 'medium' | 'high';
  evidence: OpportunityEvidence[];
}

export const MODIFIER_DICTIONARY: readonly ModifierDefinition[] = [
  { phrase: 'better than', category: 'comparison', microIntent: 'comparison' },
  { phrase: 'how to', category: 'informational', microIntent: 'how-to', contentFormat: 'step-by-step-guide' },
  { phrase: 'how should', category: 'informational', microIntent: 'how-to', contentFormat: 'step-by-step-guide' },
  { phrase: 'how does', category: 'informational', microIntent: 'how-to', contentFormat: 'step-by-step-guide' },
  { phrase: 'how do', category: 'informational', microIntent: 'how-to', contentFormat: 'step-by-step-guide' },
  { phrase: 'how can', category: 'informational', microIntent: 'how-to', contentFormat: 'step-by-step-guide' },
  { phrase: 'how long', category: 'informational', microIntent: 'duration-question' },
  { phrase: 'how much', category: 'informational', microIntent: 'cost-question' },
  { phrase: 'how many', category: 'informational', microIntent: 'quantity-question' },
  { phrase: 'how often', category: 'informational', microIntent: 'frequency-question' },
  { phrase: 'what are', category: 'informational', microIntent: 'definition' },
  { phrase: 'what does', category: 'informational', microIntent: 'explanation' },
  { phrase: 'what can', category: 'informational', microIntent: 'capability-question' },
  { phrase: 'why does', category: 'informational', microIntent: 'explanation' },
  { phrase: 'why do', category: 'informational', microIntent: 'explanation' },
  { phrase: 'where can', category: 'informational', microIntent: 'location-question' },
  { phrase: 'which are', category: 'informational', microIntent: 'selection-question' },
  { phrase: 'which is', category: 'informational', microIntent: 'selection-question' },
  { phrase: 'what is', category: 'informational', microIntent: 'definition', contentFormat: 'definition' },
  { phrase: 'open source', category: 'constraint', value: 'open source', microIntent: 'open-source' },
  { phrase: 'compatible with', category: 'compatibility', microIntent: 'compatibility' },
  { phrase: 'works with', category: 'compatibility', microIntent: 'compatibility' },
  { phrase: 'integrates with', category: 'compatibility', microIntent: 'integration' },
  { phrase: 'for small businesses', category: 'audience', value: 'small businesses', microIntent: 'small-business' },
  { phrase: 'for small business', category: 'audience', value: 'small business', microIntent: 'small-business' },
  { phrase: 'for marathon runners', category: 'audience', value: 'marathon runners', microIntent: 'audience-specific' },
  { phrase: 'for beginners', category: 'audience', value: 'beginners', microIntent: 'beginner' },
  { phrase: 'for professionals', category: 'audience', value: 'professionals', microIntent: 'professional-audience' },
  { phrase: 'for freelancers', category: 'audience', value: 'freelancers', microIntent: 'freelancer-audience' },
  { phrase: 'for students', category: 'audience', value: 'students', microIntent: 'student-audience' },
  { phrase: 'near me', category: 'location', value: 'near me', microIntent: 'local' },
  { phrase: 'alternatives', category: 'comparison', microIntent: 'alternative' },
  { phrase: 'alternative', category: 'comparison', microIntent: 'alternative' },
  { phrase: 'comparison', category: 'comparison', microIntent: 'comparison' },
  { phrase: 'compare', category: 'comparison', microIntent: 'comparison' },
  { phrase: 'versus', category: 'comparison', microIntent: 'comparison' },
  { phrase: 'vs', category: 'comparison', microIntent: 'comparison' },
  { phrase: 'best', category: 'recommendation', microIntent: 'best/recommendation', contentFormat: 'curated-recommendations' },
  { phrase: 'top', category: 'recommendation', microIntent: 'best/recommendation', contentFormat: 'curated-recommendations' },
  { phrase: 'review', category: 'commercial', microIntent: 'review' },
  { phrase: 'reviews', category: 'commercial', microIntent: 'review' },
  { phrase: 'pricing', category: 'commercial', microIntent: 'pricing', contentFormat: 'pricing-information' },
  { phrase: 'price', category: 'commercial', microIntent: 'pricing', contentFormat: 'pricing-information' },
  { phrase: 'coupon', category: 'commercial', microIntent: 'discount' },
  { phrase: 'discount', category: 'commercial', microIntent: 'discount' },
  { phrase: 'affordable', category: 'commercial', microIntent: 'budget' },
  { phrase: 'cheap', category: 'commercial', microIntent: 'budget' },
  { phrase: 'sale', category: 'commercial', microIntent: 'discount' },
  { phrase: 'deal', category: 'commercial', microIntent: 'discount' },
  { phrase: 'buy', category: 'commercial', microIntent: 'purchase' },
  { phrase: 'order', category: 'commercial', microIntent: 'purchase' },
  { phrase: 'free', category: 'constraint', value: 'free', microIntent: 'free' },
  { phrase: 'waterproof', category: 'constraint', value: 'waterproof', microIntent: 'feature-constraint' },
  { phrase: 'lightweight', category: 'constraint', value: 'lightweight', microIntent: 'feature-constraint' },
  { phrase: 'fast', category: 'constraint', value: 'fast', microIntent: 'feature-constraint' },
  { phrase: 'troubleshooting', category: 'post-purchase', microIntent: 'troubleshooting', contentFormat: 'troubleshooting-guide' },
  { phrase: 'installation', category: 'post-purchase', microIntent: 'setup', contentFormat: 'setup-guide' },
  { phrase: 'configuration', category: 'post-purchase', microIntent: 'setup', contentFormat: 'setup-guide' },
  { phrase: 'warranty', category: 'post-purchase', microIntent: 'warranty' },
  { phrase: 'refund', category: 'post-purchase', microIntent: 'refund' },
  { phrase: 'setup', category: 'post-purchase', microIntent: 'setup', contentFormat: 'setup-guide' },
  { phrase: 'repair', category: 'post-purchase', microIntent: 'repair' },
  { phrase: 'online', category: 'context', value: 'online', microIntent: 'online-context' },
  { phrase: 'local', category: 'location', value: 'local', microIntent: 'local' },
  { phrase: 'nearby', category: 'location', value: 'nearby', microIntent: 'local' },
  { phrase: 'why', category: 'informational', microIntent: 'explanation' },
  { phrase: 'when', category: 'informational', microIntent: 'timing' },
  { phrase: 'where', category: 'informational', microIntent: 'location-question' },
  { phrase: 'who', category: 'informational', microIntent: 'audience-question' },
  { phrase: 'which', category: 'informational', microIntent: 'selection-question' },
  { phrase: 'should', category: 'informational', microIntent: 'decision-question' },
  { phrase: 'what', category: 'informational', microIntent: 'information-question' },
  { phrase: 'how', category: 'informational', microIntent: 'how-to', contentFormat: 'step-by-step-guide' },
];

const MAX_QUERY_CHARACTERS = 300;
const MAX_QUERY_TOKENS = 40;
const MAX_HEADINGS_PER_PAGE = 18;
const MAX_QUESTIONS_PER_PAGE = 6;
const MAX_HEADING_CHARACTERS = 180;
const MAX_PAGE_EVIDENCE_CHARACTERS = 2_400;
const WORD_TOKEN = /[\p{L}\p{M}\p{N}]+(?:'[\p{L}\p{M}\p{N}]+)*/gu;

function normalizedPhrase(value: string): string {
  return value.normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[‐‑‒–—−-]+/g, ' ')
    .replace(/[^\p{L}\p{M}\p{N}\s$€£¥%'.]/gu, ' ')
    .replace(/(\D)\./g, '$1 ')
    .replace(/\.(\D)/g, ' $1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeQuery(value: string): string {
  return normalizedPhrase(value.slice(0, MAX_QUERY_CHARACTERS));
}

export function tokenizeQuery(value: string): string[] {
  return [...normalizeQuery(value).matchAll(WORD_TOKEN)]
    .slice(0, MAX_QUERY_TOKENS)
    .map((match) => match[0]);
}

function stableQueryId(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return `q-${(hash >>> 0).toString(36)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phraseMatches(query: string, phrase: string): Array<{ start: number; end: number }> {
  const escaped = escapeRegExp(phrase);
  const expression = new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{M}\\p{N}])`, 'gu');
  const found: Array<{ start: number; end: number }> = [];
  for (const match of query.matchAll(expression)) {
    const prefixLength = match[1].length;
    const start = (match.index ?? 0) + prefixLength;
    found.push({ start, end: start + match[2].length });
  }
  return found;
}

function overlaps(range: { start: number; end: number }, ranges: Array<{ start: number; end: number }>): boolean {
  return ranges.some((item) => range.start < item.end && range.end > item.start);
}

function clampConfidence(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

function inferIntent(modifiers: QueryModifier[], constraints: QueryConstraint[], normalized: string, isQuestion: boolean): { primary?: SearchIntent; labels: IntentSignal[] } {
  const signals = new Map<SearchIntent, { confidence: number; evidence: string[] }>();
  const add = (label: SearchIntent, confidence: number, evidence: string) => {
    const current = signals.get(label) ?? { confidence: 0, evidence: [] };
    current.confidence = Math.max(current.confidence, confidence);
    if (!current.evidence.includes(evidence)) current.evidence.push(evidence);
    signals.set(label, current);
  };

  const categories = new Set(modifiers.map((modifier) => modifier.category));
  if (categories.has('location')) add('local', 0.82, 'A local or location modifier is present.');
  if (categories.has('post-purchase')) add('post-purchase-support', 0.84, 'A setup, repair, or support modifier is present.');
  if (/\b(?:login|log in|sign in|official website|customer service)\b/.test(normalized)) {
    add('navigational', 0.74, 'The query contains a site-navigation phrase.');
  }
  if (/\b(?:buy|order|purchase|book|hire|subscribe)\b/.test(normalized)) {
    add('transactional', 0.82, 'The query contains a direct action verb.');
  }
  if (categories.has('comparison') || categories.has('recommendation') || categories.has('commercial') || constraints.some((constraint) => constraint.kind === 'price')) {
    add('commercial-investigation', 0.7, 'The query contains a comparison, recommendation, pricing, or commercial signal.');
  }
  if (categories.has('informational') || isQuestion) {
    add('informational', isQuestion ? 0.78 : 0.67, isQuestion ? 'Question syntax is present.' : 'An informational modifier is present.');
  }
  const labels = [...signals.entries()]
    .map(([label, signal]) => ({ label, confidence: signal.confidence, evidence: signal.evidence }))
    .sort((a, b) => b.confidence - a.confidence);
  return { primary: labels[0]?.label, labels };
}

function inferFunnelStage(intent?: SearchIntent): FunnelStage | undefined {
  if (intent === 'informational') return 'awareness';
  if (intent === 'commercial-investigation') return 'consideration';
  if (intent === 'transactional' || intent === 'local') return 'conversion';
  if (intent === 'post-purchase-support') return 'retention';
  if (intent === 'navigational') return 'navigation';
  return undefined;
}

function expectedFormat(modifiers: QueryModifier[]): ContentFormat | undefined {
  const formats = modifiers
    .map((modifier) => MODIFIER_DICTIONARY.find((entry) => entry.phrase === modifier.text)?.contentFormat)
    .filter((format): format is ContentFormat => Boolean(format));
  if (modifiers.some((modifier) => modifier.category === 'comparison')) return 'comparison';
  if (formats.includes('troubleshooting-guide')) return 'troubleshooting-guide';
  if (formats.includes('setup-guide')) return 'setup-guide';
  if (formats.includes('pricing-information')) return 'pricing-information';
  if (formats.includes('definition')) return 'definition';
  if (formats.includes('step-by-step-guide')) return 'step-by-step-guide';
  if (formats.includes('curated-recommendations')) return 'curated-recommendations';
  if (modifiers.some((modifier) => modifier.category === 'location')) return 'local-landing-page';
  return undefined;
}

function expectedRole(format?: ContentFormat): PageRole | undefined {
  if (format === 'comparison') return 'comparison';
  if (format === 'curated-recommendations') return 'buying-guide';
  if (format === 'local-landing-page') return 'location';
  if (format === 'pricing-information') return 'commercial-landing';
  if (format === 'troubleshooting-guide' || format === 'setup-guide' || format === 'step-by-step-guide' || format === 'definition') return 'informational-guide';
  return undefined;
}

function parsePriceConstraints(query: string): Array<{ start: number; end: number; constraint: QueryConstraint }> {
  const results: Array<{ start: number; end: number; constraint: QueryConstraint }> = [];
  const pattern = /\b(under|below|less than|up to|at most|no more than)\s+([$€£¥]\s*)?(\d+(?:[.,]\d{1,2})?)\s*(usd|eur|gbp|dollars?|euros?|pounds?)?\b/giu;
  for (const match of query.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const amount = match[3].replace(',', '.');
    const unit = match[4] || match[2]?.trim() || undefined;
    results.push({
      start,
      end,
      constraint: {
        text: match[0],
        kind: 'price',
        value: `${match[1]} ${amount}`,
        ...(unit ? { unit } : {}),
        confidence: 0.9,
      },
    });
  }
  return results;
}

export function analyzeQueryStructure(rawValue: string, source: QuerySource = 'manual'): SearchQuery {
  const rawQuery = rawValue.slice(0, MAX_QUERY_CHARACTERS).trim();
  const normalizedQuery = normalizeQuery(rawQuery);
  const tokens = tokenizeQuery(normalizedQuery);
  const occupied: Array<{ start: number; end: number }> = [];
  const modifiers: QueryModifier[] = [];
  const constraints: QueryConstraint[] = [];
  const entities: EntityReference[] = [];

  for (const match of parsePriceConstraints(normalizedQuery)) {
    if (overlaps(match, occupied)) continue;
    occupied.push(match);
    constraints.push(match.constraint);
    modifiers.push({ text: match.constraint.text, category: 'constraint', value: match.constraint.value, start: match.start, end: match.end, confidence: 0.9 });
  }

  const definitions = [...MODIFIER_DICTIONARY].sort((a, b) => b.phrase.length - a.phrase.length);
  for (const definition of definitions) {
    const normalizedModifier = normalizedPhrase(definition.phrase);
    for (const match of phraseMatches(normalizedQuery, normalizedModifier)) {
      if (overlaps(match, occupied)) continue;
      occupied.push(match);
      const modifier: QueryModifier = {
        text: normalizedModifier,
        category: definition.category,
        ...(definition.value ? { value: definition.value } : {}),
        start: match.start,
        end: match.end,
        confidence: 0.78,
      };
      modifiers.push(modifier);
      if (definition.category === 'constraint') {
        constraints.push({ text: normalizedModifier, kind: normalizedModifier === 'free' ? 'availability' : 'feature', value: definition.value, confidence: 0.76 });
      }
    }
  }

  const knownPlatforms = ['shopify', 'wordpress', 'woocommerce', 'wix', 'squarespace', 'magento'];
  for (const platform of knownPlatforms) {
    const phrase = `for ${platform}`;
    const range = phraseMatches(normalizedQuery, phrase).find((match) => !overlaps(match, occupied));
    if (!range) continue;
    occupied.push(range);
    modifiers.push({ text: phrase, category: 'compatibility', value: platform, start: range.start, end: range.end, confidence: 0.78 });
    constraints.push({ text: phrase, kind: 'compatibility', value: platform, confidence: 0.78 });
    entities.push({ text: platform, type: 'software-platform', confidence: 0.76 });
  }

  const comparator = normalizedQuery.match(/\s+(?:vs|versus)\s+/);
  if (comparator?.index !== undefined) {
    const left = normalizedQuery.slice(0, comparator.index).trim();
    const right = normalizedQuery.slice(comparator.index + comparator[0].length).trim();
    if (left && right) {
      entities.push({ text: left, type: 'comparison-target', confidence: 0.62 });
      entities.push({ text: right, type: 'comparison-target', confidence: 0.62 });
    }
  }

  const locationValues: string[] = [];
  const audienceValues: string[] = [];
  const contextValues: string[] = [];
  const attributes: string[] = [];
  const microIntent = new Set<string>();
  for (const modifier of modifiers) {
    if (modifier.category === 'location' && modifier.value) locationValues.push(modifier.value);
    if (modifier.category === 'audience' && modifier.value) audienceValues.push(modifier.value);
    if (modifier.category === 'context' && modifier.value) contextValues.push(modifier.value);
    if (modifier.category === 'constraint' && modifier.value && !['price ceiling', 'free'].includes(modifier.value) && !/^(?:under|below|less than|up to|at most|no more than)\b/.test(modifier.text)) attributes.push(modifier.value);
    const definition = MODIFIER_DICTIONARY.find((entry) => normalizedPhrase(entry.phrase) === modifier.text);
    if (definition?.microIntent) microIntent.add(definition.microIntent);
  }
  if (constraints.some((constraint) => constraint.kind === 'price')) microIntent.add('budget');
  if (entities.length) microIntent.add('compatibility');

  const residual = normalizedQuery.split('').map((character, index) => occupied.some((range) => index >= range.start && index < range.end) ? ' ' : character).join('');
  const topicTokens = residual.split(/\s+/).filter(Boolean);
  const hasLeadingQuestionPattern = modifiers.some((modifier) => modifier.category === 'informational' && modifier.start === 0);
  if (hasLeadingQuestionPattern) {
    const grammaticalLead = new Set(['a', 'an', 'the', 'to', 'do', 'does', 'did', 'is', 'are', 'was', 'were', 'can', 'could', 'would', 'should', 'i', 'you', 'we', 'they', 'it', 'this', 'that']);
    let removed = 0;
    while (topicTokens.length && grammaticalLead.has(topicTokens[0]) && removed < 4) {
      topicTokens.shift();
      removed += 1;
    }
  }
  const topic = topicTokens.join(' ') || normalizedQuery;
  const isQuestion = rawValue.normalize('NFKC').includes('?') || /^(?:who|what|when|where|why|how|can|could|is|are|do|does|which|should)\b/.test(normalizedQuery);
  const intent = inferIntent(modifiers, constraints, normalizedQuery, isQuestion);
  const format = expectedFormat(modifiers);
  const signalCount = modifiers.length + constraints.length + (topic ? 1 : 0);
  const confidence = normalizedQuery
    ? clampConfidence(Math.min(0.88, 0.34 + (topic ? 0.23 : 0) + Math.min(signalCount, 3) * 0.09 + (intent.primary ? 0.08 : 0)))
    : 0;

  return {
    id: stableQueryId(normalizedQuery),
    rawQuery,
    normalizedQuery,
    language: 'en',
    tokens,
    topic,
    head: topic || undefined,
    modifiers: modifiers.sort((a, b) => a.start - b.start),
    entities,
    attributes: [...new Set(attributes)],
    constraints,
    audience: [...new Set(audienceValues)],
    location: [...new Set(locationValues)],
    context: [...new Set(contextValues)],
    intent: intent.labels.length ? intent : undefined,
    microIntent: [...microIntent],
    funnelStage: inferFunnelStage(intent.primary),
    expectedPageRole: expectedRole(format),
    expectedContentFormat: format,
    source: [source],
    confidence,
  };
}

export function isQuestionLikeHeading(value: string): boolean {
  const normalized = normalizeQuery(value);
  return value.normalize('NFKC').includes('?') || /^(?:who|what|when|where|why|how|can|could|is|are|do|does|which|should)\b/.test(normalized);
}

function inferPageRole(url: string, title: string, headings: Array<{ level: number; text: string }>): PageRoleEvidence {
  let pathname = '/';
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    // Keep the conservative default when a URL cannot be parsed.
  }
  const titleText = normalizeQuery(title);
  const headingText = headings.map((heading) => normalizeQuery(heading.text)).join(' ');
  const signals: string[] = [];
  if (pathname === '/' || pathname === '/index.html') return { role: 'homepage', confidence: 0.98, signals: ['Root URL.'] };
  if (/\/(?:privacy|terms|cookies|legal|affiliate-disclosure|contact|about)(?:\/|$)/.test(pathname)) {
    return { role: pathname.includes('privacy') || pathname.includes('terms') || pathname.includes('cookies') || pathname.includes('legal') ? 'legal' : 'utility', confidence: 0.86, signals: ['URL path matches a common utility or policy route.'] };
  }
  if (/\/(?:category|categories|collection|collections|catalog|catalogue)(?:\/|$)/.test(pathname)) {
    return { role: 'category', confidence: 0.78, signals: ['URL path contains a category or collection segment.'] };
  }
  if (/\/(?:product|products|item|items)(?:\/|$)/.test(pathname)) {
    return { role: 'product', confidence: 0.76, signals: ['URL path contains a product segment.'] };
  }
  if (/\/(?:service|services)(?:\/|$)/.test(pathname)) {
    return { role: 'service', confidence: 0.74, signals: ['URL path contains a service segment.'] };
  }
  if (/\/(?:docs|documentation|help|support)(?:\/|$)/.test(pathname)) {
    return { role: 'documentation', confidence: 0.72, signals: ['URL path contains a documentation or support segment.'] };
  }
  if (/\/(?:blog|article|articles|news|post|posts|guide|guides)(?:\/|$)/.test(pathname)) {
    return { role: 'blog-article', confidence: 0.74, signals: ['URL path contains an article or guide segment.'] };
  }
  if (/\b(?:vs|versus|comparison|compare|alternatives?)\b/.test(titleText)) {
    signals.push('Title contains a comparison phrase.');
    return { role: 'comparison', confidence: 0.68, signals };
  }
  if (/\b(?:best|top|buying guide|buyer guide)\b/.test(titleText)) {
    signals.push('Title contains a recommendation phrase.');
    return { role: 'buying-guide', confidence: 0.67, signals };
  }
  if (/\b(?:faq|frequently asked questions)\b/.test(titleText) || headings.filter((heading) => isQuestionLikeHeading(heading.text)).length >= 3) {
    signals.push('Title or heading structure suggests an FAQ page.');
    return { role: 'faq', confidence: 0.58, signals };
  }
  if (/\b(?:pricing|plans|schedule|book now|get started|request a quote)\b/.test(`${titleText} ${headingText}`)) {
    signals.push('Title or headings contain a commercial action or pricing phrase.');
    return { role: 'commercial-landing', confidence: 0.56, signals };
  }
  if (headings.filter((heading) => heading.level === 2 || heading.level === 3).length >= 3) {
    signals.push('The page has several section headings.');
    return { role: 'informational-guide', confidence: 0.48, signals };
  }
  return { role: 'other', confidence: 0.25, signals: ['No strong page-role pattern was detected.'] };
}

export function inferPageContentEvidence(input: PageContentInput): PageSearchEvidence {
  const headings = input.headings
    .filter((heading) => Number.isInteger(heading.level) && heading.level >= 1 && heading.level <= 3)
    .map((heading) => ({ level: heading.level, text: heading.text.trim().slice(0, MAX_HEADING_CHARACTERS) }))
    .filter((heading) => heading.text)
    .slice(0, MAX_HEADINGS_PER_PAGE);
  let language = input.htmlLang?.trim() || null;
  if (language) language = language.slice(0, 40);
  const mainHeading = headings.find((heading) => heading.level === 1)?.text;
  const primaryTopic = (mainHeading || input.title || '').trim().slice(0, MAX_HEADING_CHARACTERS) || null;
  const topicConfidence = primaryTopic
    ? mainHeading && input.title && normalizeQuery(mainHeading) === normalizeQuery(input.title)
      ? 0.8
      : mainHeading
        ? 0.68
        : 0.48
    : 0;
  const pageRole = inferPageRole(input.url, input.title, headings);
  const supportsEnglishRules = !language || /^en(?:-|$)/i.test(language);
  const questions: QuestionEvidence[] = supportsEnglishRules
    ? headings.filter((heading) => isQuestionLikeHeading(heading.text)).slice(0, MAX_QUESTIONS_PER_PAGE).map((heading) => ({
      text: heading.text,
      pageUrl: input.url,
      headingLevel: heading.level,
      confidence: heading.text.includes('?') ? 0.9 : 0.7,
      query: analyzeQueryStructure(heading.text, 'site-content-inferred'),
    }))
    : [];
  const headingEvidence = headings.map((heading) => ({ ...heading, text: heading.text.slice(0, 120) }));
  const evidenceText = headingEvidence.reduce((total, heading) => total + heading.text.length, 0);
  const boundedHeadings = evidenceText <= MAX_PAGE_EVIDENCE_CHARACTERS
    ? headingEvidence
    : headingEvidence.slice(0, 10);
  const note = !language
    ? 'Language is undeclared; English query patterns are provisional.'
    : supportsEnglishRules
      ? 'Topics and question patterns are inferred from crawled titles and headings, not observed search queries.'
      : 'Page-role and topic labels use crawl evidence; English query patterns were skipped for this page language.';
  return {
    source: 'crawl',
    language,
    primaryTopic,
    topicConfidence,
    pageRole,
    headingEvidence: boundedHeadings,
    questions,
    note,
  };
}
