import { appEnvironment, type RuntimeEnv } from './runtime-env';

export interface RequestTrace {
  requestId: string;
  scanId?: string | null;
  environment: string;
}

export type SafeLogValue = string | number | boolean | null;
export type SafeLogFields = Record<string, SafeLogValue | undefined>;

export function newTraceId(): string {
  return crypto.randomUUID();
}

/** Structured logs deliberately accept scalar fields only; callers must not pass URLs, tokens, or raw errors. */
export function logStructured(
  level: 'info' | 'warn' | 'error',
  event: string,
  trace: RequestTrace,
  fields: SafeLogFields = {},
): void {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    service: 'fatorati-scan',
    environment: trace.environment,
    event,
    requestId: trace.requestId,
    scanId: trace.scanId ?? null,
    ...fields,
  };
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function requestTrace(env: RuntimeEnv, requestId: string, scanId?: string | null): RequestTrace {
  return { requestId, scanId: scanId ?? null, environment: appEnvironment(env) };
}
