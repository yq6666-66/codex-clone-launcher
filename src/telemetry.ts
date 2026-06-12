import * as Sentry from '@sentry/react';

let telemetryEnabled = false;

function redactString(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[redacted-api-key]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [redacted]')
    .replace(/(api[_-]?key|access[_-]?token|refresh[_-]?token|password)=([^&\s]+)/gi, '$1=[redacted]');
}

function sanitizeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactString(value);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/api[_-]?key|access[_-]?token|refresh[_-]?token|password|authorization/i.test(key)) {
      output[key] = '[redacted]';
    } else {
      output[key] = sanitizeValue(item, seen);
    }
  }
  return output;
}

export function initTelemetry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  if (!dsn) return;

  telemetryEnabled = true;
  Sentry.init({
    dsn,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
    beforeSend(event) {
      return sanitizeValue(event) as typeof event;
    },
  });
}

export function reportError(
  error: unknown,
  context: { area: string; action: string; detail?: string },
) {
  if (!telemetryEnabled) return;
  Sentry.withScope((scope) => {
    scope.setTag('area', context.area);
    scope.setTag('action', context.action);
    if (context.detail) scope.setExtra('detail', redactString(context.detail));
    Sentry.captureException(error);
  });
}

export const TelemetryErrorBoundary = Sentry.ErrorBoundary;
