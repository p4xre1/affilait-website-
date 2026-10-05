export type ScanLimitKind = 'prepare' | 'batches';

export interface ScanLimitSubject {
  ip: string;
  userId?: string;
  projectId?: string;
  domain?: string;
}

export interface ScanLimiter {
  allow(kind: ScanLimitKind, subject: ScanLimitSubject, now?: number): boolean;
  retryAfterSeconds(kind: ScanLimitKind): number;
}

interface LimitBucket {
  prepare: number[];
  batches: number[];
}

const WINDOW_MS = 10 * 60 * 1000;
const LIMITS: Record<ScanLimitKind, number> = { prepare: 2, batches: 20 };
const MAX_SUBJECTS_PER_ISOLATE = 2_000;

/** Best-effort per-isolate limiter. Only IP is active until authenticated scan identities exist. */
export class InMemoryScanLimiter implements ScanLimiter {
  private readonly buckets = new Map<string, LimitBucket>();

  allow(kind: ScanLimitKind, subject: ScanLimitSubject, now = Date.now()): boolean {
    const key = subject.ip.trim().slice(0, 100) || 'unknown';
    let bucket = this.buckets.get(key);
    if (bucket) {
      bucket.prepare = bucket.prepare.filter((timestamp) => now - timestamp < WINDOW_MS);
      bucket.batches = bucket.batches.filter((timestamp) => now - timestamp < WINDOW_MS);
      if (bucket.prepare.length === 0 && bucket.batches.length === 0) {
        this.buckets.delete(key);
        bucket = undefined;
      }
    }

    if (!bucket) {
      if (this.buckets.size >= MAX_SUBJECTS_PER_ISOLATE) this.removeExpiredBuckets(now);
      if (this.buckets.size >= MAX_SUBJECTS_PER_ISOLATE) return false;
      bucket = { prepare: [], batches: [] };
      this.buckets.set(key, bucket);
    }

    const events = bucket[kind];
    if (events.length >= LIMITS[kind]) return false;
    events.push(now);
    return true;
  }

  retryAfterSeconds(_kind: ScanLimitKind): number {
    return Math.ceil(WINDOW_MS / 1000);
  }

  private removeExpiredBuckets(now: number): void {
    for (const [key, bucket] of this.buckets) {
      bucket.prepare = bucket.prepare.filter((timestamp) => now - timestamp < WINDOW_MS);
      bucket.batches = bucket.batches.filter((timestamp) => now - timestamp < WINDOW_MS);
      if (bucket.prepare.length === 0 && bucket.batches.length === 0) this.buckets.delete(key);
    }
  }
}

export const scanLimiter: ScanLimiter = new InMemoryScanLimiter();
