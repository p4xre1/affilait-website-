/**
 * Comprehensive input protection, anti-script verification, and boundary limits.
 * Protects APIs against XSS, script injection, HTML injection, prototype pollution,
 * parameter pollution, and oversized payloads.
 */

export const SCRIPT_INJECTION_PATTERN = /<\s*script\b|<\s*\/\s*script\s*>|<\s*(?:iframe|object|embed|applet|base|link|meta|style|form|svg|math)\b|<\s*[^>]*\bon[a-z]+\s*=|\bjavascript\s*:|\bvbscript\s*:|\bdata\s*:\s*text\/html|(?:^|\s)on(?:load|error|click|mouse\w+|key\w+|focus|blur|change|submit|input|pointer\w+|touch\w+|animation\w+)\s*=/i;

export class InputValidationError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = 'InputValidationError';
  }
}

/** Check whether a string contains any script or dangerous HTML injection patterns. */
export function hasScript(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return SCRIPT_INJECTION_PATTERN.test(value);
}

/** Reject any value that contains script injection patterns. */
export function assertNoScript(value: string, fieldName = 'input'): void {
  if (hasScript(value)) {
    throw new InputValidationError(fieldName, `The ${fieldName} contains forbidden script or HTML patterns.`);
  }
}

/** Sanitize text: strip control characters, null bytes, and Unicode bidi overrides. */
export function sanitizeCleanText(value: string, maxLength = 2_048): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .trim()
    .slice(0, maxLength);
}

/** Validate string bounds and ensure no scripts. */
export function validateBoundedString(
  value: unknown,
  fieldName: string,
  minLength: number,
  maxLength: number,
): string {
  if (typeof value !== 'string') {
    throw new InputValidationError(fieldName, `${fieldName} must be a string.`);
  }
  const clean = sanitizeCleanText(value, maxLength + 1);
  if (clean.length < minLength || clean.length > maxLength) {
    throw new InputValidationError(fieldName, `${fieldName} must contain ${minLength}–${maxLength} characters.`);
  }
  assertNoScript(clean, fieldName);
  return clean;
}

/** Protect against prototype pollution and parameter pollution on JSON bodies. */
export function assertSafeObject(obj: unknown, maxKeys = 10, label = 'Request body'): Record<string, unknown> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new InputValidationError('body', `${label} must be a JSON object.`);
  }
  const keys = Object.keys(obj);
  if (keys.length > maxKeys) {
    throw new InputValidationError('body', `${label} exceeds the maximum allowed ${maxKeys} fields.`);
  }
  for (const key of keys) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new InputValidationError('body', 'Invalid object property name.');
    }
  }
  return obj as Record<string, unknown>;
}
