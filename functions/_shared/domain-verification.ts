/**
 * Domain Verification Logic
 * Generates unguessable, single-use, time-bounded verification challenges
 * to verify domain ownership (DNS TXT or HTML meta tag).
 */

export interface VerificationChallenge {
  token: string;
  dnsTxtRecord: { name: string; value: string };
  htmlMetaTag: { name: string; content: string };
  expiresAt: string;
}

export function normalizeDomain(domain: string): string {
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//i, '').split('/')[0].replace(/\.$/, '');
  return clean;
}

export function generateVerificationChallenge(domain: string, ttlHours = 24): VerificationChallenge {
  const normalized = normalizeDomain(domain);
  const randomBytes = crypto.getRandomValues(new Uint8Array(24));
  const hex = Array.from(randomBytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const token = `fatorati-verify-${hex}`;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

  return {
    token,
    dnsTxtRecord: {
      name: `_fatorati-challenge.${normalized}`,
      value: `fatorati-verification=${token}`,
    },
    htmlMetaTag: {
      name: 'fatorati-verification',
      content: token,
    },
    expiresAt,
  };
}
