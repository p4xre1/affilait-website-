/** Provider-neutral source labels. This file defines boundaries only; it does not fetch or synthesize provider data. */
export const PROVIDER_KINDS = [
  'crawl',
  'search-console',
  'analytics',
  'keyword-research',
  'serp',
  'backlinks',
  'ai',
  'business',
  'manual',
] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];
export type EvidenceMode = 'observed' | 'inferred' | 'manually-confirmed';
export type ProviderState = 'available' | 'partial' | 'not-configured' | 'not-authorized' | 'unavailable';
export type ReviewStatus = 'candidate' | 'accepted' | 'rejected' | 'deferred';
export type OpportunityPriority = 'low' | 'medium' | 'high';

export interface EvidenceProvenance {
  provider: ProviderKind;
  mode: EvidenceMode;
  observedAt?: string;
  collectedAt: string;
  periodStart?: string;
  periodEnd?: string;
  method?: string;
  sourceUrl?: string;
}

/** A measured value is only valid when tied to an actual observation and its source. */
export interface ObservedMetric {
  name: string;
  value: number | string;
  unit?: string;
  provenance: EvidenceProvenance & { mode: 'observed' };
}

/** Crawl-derived evidence stays explicitly inferred and cannot be confused with an external query or metric. */
export interface InferredEvidence {
  kind: 'inferred';
  provider: 'crawl';
  description: string;
  pageUrl?: string;
  excerpt?: string;
  confidence: number;
  method: string;
  collectedAt: string;
}

export interface ObservedEvidence {
  kind: 'observed';
  provider: Exclude<ProviderKind, 'crawl' | 'manual'>;
  description: string;
  entity?: string;
  metric?: ObservedMetric;
  sourceUrl?: string;
  collectedAt: string;
}

export interface ManualEvidence {
  kind: 'manually-confirmed';
  provider: 'manual';
  description: string;
  confirmedBy?: string;
  confirmedAt: string;
}

export type IntelligenceEvidence = InferredEvidence | ObservedEvidence | ManualEvidence;

export interface ProviderCoverage {
  provider: ProviderKind;
  state: ProviderState;
  checkedAt: string;
  recordCount?: number;
  periodStart?: string;
  periodEnd?: string;
  note?: string;
}

/** Reviewable hypothesis only. Priority is a triage label, never a predicted ranking or business outcome. */
export interface ReviewableOpportunity {
  id: string;
  title: string;
  rationale: string;
  suggestedNextStep: string;
  priority?: OpportunityPriority;
  confidence?: number;
  confidenceBasis?: string;
  evidence: IntelligenceEvidence[];
  reviewStatus: ReviewStatus;
  requiresHumanReview: true;
}

export interface IntelligenceSnapshot {
  id: string;
  createdAt: string;
  coverage: ProviderCoverage[];
  opportunities: ReviewableOpportunity[];
}
