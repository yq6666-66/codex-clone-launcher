import * as Sentry from '@sentry/react';

let telemetryEnabled = false;
let globalListenersInstalled = false;

export type LocalErrorEvent = {
  area: string;
  action: string;
  detail?: string;
  message: string;
  occurredAt: number;
};

const LOCAL_ERROR_LIMIT = 20;
const localErrors: LocalErrorEvent[] = [];

export function redactSensitiveText(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[redacted-api-key]')
    .replace(/\b(authorization)\s*[:=]\s*Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1: Bearer [redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [redacted]')
    .replace(/(api[_-]?key|access[_-]?token|refresh[_-]?token|password)=([^&\s]+)/gi, '$1=[redacted]')
    .replace(/\bauthorization=([^&\s]+)/gi, 'authorization=[redacted]')
    .replace(/"(api[_-]?key|access[_-]?token|refresh[_-]?token|password|authorization)"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"')
    .replace(/C:\\Users\\([^\\\s]+)\\/gi, 'C:\\Users\\[user]\\')
    .replace(/\/Users\/([^/\s]+)\//g, '/Users/[user]/');
}

function sanitizeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactSensitiveText(value);
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
  if (!globalListenersInstalled && typeof window !== 'undefined') {
    globalListenersInstalled = true;
    window.addEventListener('error', (event) => {
      reportError(event.error || event.message, {
        area: 'window',
        action: 'error',
        detail: `${event.filename || 'unknown'}:${event.lineno || 0}:${event.colno || 0}`,
      });
    });
    window.addEventListener('unhandledrejection', (event) => {
      reportError(event.reason || 'Unhandled promise rejection', {
        area: 'window',
        action: 'unhandledrejection',
      });
    });
  }

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
  const message = error instanceof Error ? error.message : String(error);
  localErrors.unshift({
    area: redactSensitiveText(context.area),
    action: redactSensitiveText(context.action),
    detail: context.detail ? redactSensitiveText(context.detail) : undefined,
    message: redactSensitiveText(message),
    occurredAt: Date.now(),
  });
  localErrors.splice(LOCAL_ERROR_LIMIT);

  if (!telemetryEnabled) return;
  Sentry.withScope((scope) => {
    scope.setTag('area', context.area);
    scope.setTag('action', context.action);
    if (context.detail) scope.setExtra('detail', redactSensitiveText(context.detail));
    Sentry.captureException(error);
  });
}

export function getLocalErrorEvents(): LocalErrorEvent[] {
  return localErrors.slice();
}

export const TelemetryErrorBoundary = Sentry.ErrorBoundary;
