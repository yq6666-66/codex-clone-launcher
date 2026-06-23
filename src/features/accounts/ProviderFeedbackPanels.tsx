import { CheckCircle2, CircleAlert, ShieldCheck } from 'lucide-react';
import type {
  CodexProviderConnectionTestResult,
  CodexProviderModelsFetchResult,
} from '../../shared/types';

export type ProviderConfigAuditTone = 'ok' | 'warning' | 'blocked' | 'muted';

export type ProviderConfigAuditCheck = {
  id: string;
  status: ProviderConfigAuditTone;
  label: string;
  detail: string;
};

export type ProviderConfigAudit = {
  tone: ProviderConfigAuditTone;
  label: string;
  detail: string;
  normalizedBaseUrl: string;
  duplicatePresetCount: number;
  similarPresetCount: number;
  blockingCount: number;
  warningCount: number;
  checks: ProviderConfigAuditCheck[];
};

export type ProviderFeedbackLabels = {
  providerAuditTitle: string;
  providerAuditLead: string;
  providerModelsFetched: string;
  providerModelsEmpty: string;
  providerModelsCountUnit: string;
  providerModelsHiddenPrefix: string;
  providerModelsHiddenSuffix: string;
  providerLatencyLabel: string;
  providerTtfbLabel: string;
  providerHealthCodexReady: string;
  providerNeedsRelay: string;
  providerTestHealthy: string;
  providerTestDegraded: string;
  providerTestChatOnly: string;
  providerTestFailed: string;
};

export function ProviderConfigAuditPanel(props: {
  audit: ProviderConfigAudit;
  labels: ProviderFeedbackLabels;
}) {
  const visibleChecks = props.audit.checks
    .filter((check) => check.status !== 'ok' || props.audit.tone === 'ok')
    .slice(0, 7);
  const Icon = props.audit.tone === 'blocked' || props.audit.tone === 'warning' ? CircleAlert : ShieldCheck;
  return (
    <div className={`provider-audit-panel wide ${props.audit.tone}`}>
      <div className="provider-audit-title">
        <Icon size={16} />
        <strong>{props.labels.providerAuditTitle}</strong>
        <span>{props.audit.label}</span>
      </div>
      <p>{props.labels.providerAuditLead}</p>
      <div className="provider-audit-metrics">
        <code>{props.audit.normalizedBaseUrl || 'Base URL empty'}</code>
        <span>{props.audit.detail}</span>
        <span>duplicate presets {props.audit.duplicatePresetCount}</span>
        <span>similar presets {props.audit.similarPresetCount}</span>
      </div>
      <div className="provider-audit-checks">
        {visibleChecks.map((check) => (
          <small className={check.status} key={check.id} title={check.detail}>
            {check.label}: {check.detail}
          </small>
        ))}
      </div>
    </div>
  );
}

export function ProviderModelsPanel(props: {
  result: CodexProviderModelsFetchResult;
  currentModel: string;
  labels: ProviderFeedbackLabels;
  onSelect: (model: string) => void;
}) {
  const visibleModels = props.result.models.slice(0, 48);
  const hiddenCount = Math.max(0, props.result.models.length - visibleModels.length);
  const current = props.currentModel.trim();
  return (
    <div className={`provider-models-panel wide ${props.result.ok ? 'ok' : props.result.status}`}>
      <div className="provider-test-title">
        <strong>{props.result.ok ? props.labels.providerModelsFetched : props.labels.providerModelsEmpty}</strong>
        <span>{props.result.httpStatus ? `HTTP ${props.result.httpStatus}` : props.result.status}</span>
      </div>
      <p>{props.result.message}</p>
      <div className="provider-test-metrics">
        <span>{props.result.modelCount} {props.labels.providerModelsCountUnit}</span>
        <span>{props.labels.providerLatencyLabel} {props.result.latencyMs}ms</span>
      </div>
      <code>{props.result.endpoint}</code>
      {visibleModels.length ? (
        <div className="provider-model-list">
          {visibleModels.map((model) => (
            <button
              className={model === current ? 'selected' : ''}
              disabled={model === current}
              key={model}
              onClick={() => props.onSelect(model)}
              title={model}
              type="button"
            >
              {model === current ? <CheckCircle2 size={13} /> : null}
              <span>{model}</span>
            </button>
          ))}
          {hiddenCount ? (
            <small>
              {props.labels.providerModelsHiddenPrefix}
              {hiddenCount}
              {props.labels.providerModelsHiddenSuffix}
            </small>
          ) : null}
        </div>
      ) : null}
      {props.result.responsePreview && !visibleModels.length ? <small>{props.result.responsePreview}</small> : null}
    </div>
  );
}

export function ProviderTestPanel(props: {
  result: CodexProviderConnectionTestResult;
  labels: ProviderFeedbackLabels;
}) {
  const tone = props.result.codexReady ? (props.result.status === 'degraded' ? 'warning' : 'ok') : props.result.ok ? 'warning' : 'error';
  return (
    <div className={`provider-test-panel wide ${tone}`}>
      <div className="provider-test-title">
        <strong>{providerTestStatusLabel(props.result, props.labels)}</strong>
        <span>{props.result.httpStatus ? `HTTP ${props.result.httpStatus}` : props.result.protocol}</span>
      </div>
      <p>{props.result.message}</p>
      <div className="provider-test-metrics">
        <span>protocol {props.result.protocol}</span>
        <span>{props.labels.providerTtfbLabel} {props.result.ttfbMs ?? '-'}ms</span>
        <span>{props.labels.providerLatencyLabel} {props.result.latencyMs}ms</span>
        <span>{props.result.codexReady ? props.labels.providerHealthCodexReady : props.labels.providerNeedsRelay}</span>
      </div>
      <code>{props.result.endpoint}</code>
      {props.result.responsePreview ? <small>{props.result.responsePreview}</small> : null}
    </div>
  );
}

export function providerTestStatusLabel(
  result: CodexProviderConnectionTestResult,
  labels: ProviderFeedbackLabels,
): string {
  if (result.status === 'healthy') return labels.providerTestHealthy;
  if (result.status === 'degraded') return labels.providerTestDegraded;
  if (result.status === 'chatBridge') return labels.providerTestChatOnly;
  if (result.status === 'chatOnly') return labels.providerTestChatOnly;
  return labels.providerTestFailed;
}
