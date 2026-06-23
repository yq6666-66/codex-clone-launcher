import { AlertTriangle, Database, Download, FolderOpen, Loader2, RefreshCw, ShieldCheck, Wrench } from 'lucide-react';
import type { CodexSyncPackagePreflightReport, CodexSyncPackageStatus, DiagnosticsSnapshot } from '../../shared/types';
import { redactSensitiveText, type LocalErrorEvent } from '../../telemetry';

type DiagnosticsUpdaterState = {
  message: string;
  version?: string;
  checkedAt?: number;
  diagnostic?: string;
  hasUpdate: boolean;
  ownerRepo: string;
  endpoint: string;
};

export type DiagnosticsPanelLabels = {
  title: string;
  lead: string;
  quickActions: string;
  packageFreshness: string;
  launcherVersion: string;
  diagnosticsPid: string;
  codexPath: string;
  pathPlaceholder: string;
  diagnosticsLogDir: string;
  issueSummary: string;
  noIssues: string;
  refreshing: string;
  refresh: string;
  copyReport: string;
  openLogDir: string;
  openSyncPackage: string;
  reportPreview: string;
  logs: string;
  noLogs: string;
};

type DiagnosticsPanelProps = {
  syncPackage: CodexSyncPackageStatus | null;
  syncPackagePreflight: CodexSyncPackagePreflightReport | null;
  updater: DiagnosticsUpdaterState;
  localErrors: LocalErrorEvent[];
  diagnostics: DiagnosticsSnapshot | null;
  codexAppPath: string;
  appVersion: string;
  diagnosticsReport: string;
  busy: string;
  packageState: string;
  summary: string;
  labels: DiagnosticsPanelLabels;
  onRefreshDiagnostics: () => unknown;
  onCopyDiagnosticsReport: () => unknown;
  onOpenLogDir: () => unknown;
  onOpenSyncPackage: () => unknown;
};

type DiagnosticSignal = {
  id: string;
  label: string;
  value: number;
  status: 'ok' | 'warning' | 'error' | 'muted';
  detail: string;
};

function clampSignal(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function logLineCount(value?: string | null): number {
  return value ? value.split(/\r?\n/).filter(Boolean).length : 0;
}

function buildDiagnosticSignals(props: DiagnosticsPanelProps): DiagnosticSignal[] {
  const runtimeLogLines = logLineCount(props.diagnostics?.latestLogTail);
  const startupLogLines = logLineCount(props.diagnostics?.startupLogTail);
  const localErrorCount = props.localErrors.length;
  const preflight = props.syncPackagePreflight;
  const preflightIssueCount = (preflight?.errorCount ?? 0) + (preflight?.warningCount ?? 0);
  const updaterFailed = props.updater.message.includes('失败') || props.updater.diagnostic;

  return [
    {
      id: 'runtime-logs',
      label: '日志覆盖',
      value: clampSignal((runtimeLogLines + startupLogLines) * 8),
      status: runtimeLogLines || startupLogLines ? 'ok' : 'muted',
      detail: `${runtimeLogLines} runtime / ${startupLogLines} startup lines`,
    },
    {
      id: 'startup-mutex',
      label: '启动锁',
      value: props.diagnostics?.startupMutexName ? 100 : 45,
      status: props.diagnostics?.startupMutexName ? 'ok' : 'muted',
      detail: props.diagnostics?.startupMutexName ?? 'Global\\CodexCloneLauncherStartup',
    },
    {
      id: 'updater',
      label: '更新器',
      value: props.updater.hasUpdate ? 72 : updaterFailed ? 38 : 92,
      status: props.updater.hasUpdate ? 'warning' : updaterFailed ? 'error' : 'ok',
      detail: props.updater.message,
    },
    {
      id: 'sync-preflight',
      label: '同步包扫描',
      value: preflight ? (preflight.readyToApply ? 96 : Math.max(20, 78 - preflightIssueCount * 18)) : 34,
      status: preflight
        ? preflight.errorCount
          ? 'error'
          : preflight.warningCount
            ? 'warning'
            : 'ok'
        : 'muted',
      detail: preflight
        ? `${preflight.status} / ${preflight.entriesChecked} entries / ${preflight.resourcesChecked} resources`
        : 'preflight not checked',
    },
    {
      id: 'sentry-buffer',
      label: 'Sentry 缓冲',
      value: localErrorCount ? Math.max(18, 88 - localErrorCount * 18) : 100,
      status: localErrorCount ? 'error' : 'ok',
      detail: localErrorCount ? `${localErrorCount} local errors captured` : 'quiet',
    },
  ];
}

export function DiagnosticsPanel(props: DiagnosticsPanelProps) {
  const labels = props.labels;
  const diagnosticSignals = buildDiagnosticSignals(props);
  const diagnosticsLogPreview = props.diagnostics?.latestLogTail
    ? redactSensitiveText(props.diagnostics.latestLogTail.split(/\r?\n/).filter(Boolean).slice(-6).join('\n'))
    : labels.noLogs;
  const startupLogPreview = props.diagnostics?.startupLogTail
    ? redactSensitiveText(props.diagnostics.startupLogTail.split(/\r?\n/).filter(Boolean).slice(-6).join('\n'))
    : labels.noLogs;
  const packageIssues = [
    ...(props.syncPackage?.warnings ?? []),
    ...(props.syncPackage?.skipped ?? []).map((item) => `skipped: ${item}`),
  ].slice(0, 5);
  const preflightIssues = (props.syncPackagePreflight?.checks ?? [])
    .filter((check) => check.status !== 'ok')
    .slice(0, 4);
  const latestErrors = props.localErrors.slice(0, 4);

  return (
    <section className="settings-diagnostics diagnostics-card">
      <div className="card-title-row">
        <span>{labels.title}</span>
        <Wrench size={18} />
      </div>
      <p>{labels.lead}</p>
      <div className="diagnostics-list">
        <div>
          <strong>{labels.quickActions}</strong>
          <span>{props.summary}</span>
        </div>
        <div>
          <strong>{labels.packageFreshness}</strong>
          <span>{props.packageState}</span>
        </div>
        <div>
          <strong>{labels.launcherVersion}</strong>
          <span>{props.appVersion ? props.appVersion : 'unknown'}</span>
        </div>
        <div>
          <strong>{labels.diagnosticsPid}</strong>
          <span>{props.diagnostics ? String(props.diagnostics.launcherPid) : 'unknown'}</span>
        </div>
        <div>
          <strong>{labels.codexPath}</strong>
          <span>{props.codexAppPath ? props.codexAppPath : labels.pathPlaceholder}</span>
        </div>
        <div>
          <strong>Resolved Codex path</strong>
          <span>
            {props.diagnostics?.codexLaunchPath
              ? `${props.diagnostics.codexLaunchPath} (${props.diagnostics.codexLaunchPathSource})`
              : props.diagnostics?.codexLaunchPathSource ?? 'unknown'}
          </span>
        </div>
        <div>
          <strong>{labels.diagnosticsLogDir}</strong>
          <span>{props.diagnostics?.logDir ?? 'unknown'}</span>
        </div>
        <div>
          <strong>Startup mutex</strong>
          <span>{props.diagnostics?.startupMutexName ?? 'Global\\CodexCloneLauncherStartup'}</span>
        </div>
        <div className={packageIssues.length ? 'diagnostics-issues has-issues' : 'diagnostics-issues'}>
          <strong>{labels.issueSummary}</strong>
          <span>{packageIssues.length ? packageIssues.join(' / ') : labels.noIssues}</span>
        </div>
      </div>
      <div className="diagnostics-status-grid">
        <div className={props.updater.hasUpdate ? 'diagnostics-status-card warning' : 'diagnostics-status-card'}>
          <div>
            <strong>Updater</strong>
            <Download size={16} />
          </div>
          <span>{props.updater.message}</span>
          <small>{props.updater.version ? `version ${props.updater.version}` : props.updater.ownerRepo || props.updater.endpoint}</small>
          {props.updater.diagnostic ? <small>{redactSensitiveText(props.updater.diagnostic)}</small> : null}
        </div>
        <div
          className={
            props.syncPackagePreflight?.readyToApply
              ? 'diagnostics-status-card'
              : props.syncPackagePreflight
                ? 'diagnostics-status-card warning'
                : 'diagnostics-status-card muted'
          }
        >
          <div>
            <strong>Sync preflight</strong>
            <ShieldCheck size={16} />
          </div>
          <span>
            {props.syncPackagePreflight
              ? `${props.syncPackagePreflight.status} / errors ${props.syncPackagePreflight.errorCount} / warnings ${props.syncPackagePreflight.warningCount}`
              : 'not checked'}
          </span>
          {preflightIssues.length ? (
            <small>{preflightIssues.map((check) => `${check.status}: ${check.label}`).join(' / ')}</small>
          ) : (
            <small>{props.syncPackagePreflight?.readyToApply ? 'ready to apply' : 'run preflight before sync/repair'}</small>
          )}
        </div>
        <div className={latestErrors.length ? 'diagnostics-status-card error' : 'diagnostics-status-card'}>
          <div>
            <strong>Local errors</strong>
            <AlertTriangle size={16} />
          </div>
          <span>{latestErrors.length ? `${props.localErrors.length} captured` : labels.noIssues}</span>
          {latestErrors.length ? (
            <small>
              {latestErrors
                .map((event) => `${redactSensitiveText(event.area)}/${redactSensitiveText(event.action)}: ${redactSensitiveText(event.message)}`)
                .join(' / ')}
            </small>
          ) : (
            <small>Sentry {props.localErrors.length ? 'buffered' : 'quiet'}</small>
          )}
        </div>
      </div>
      <div className="diagnostics-signal-chart" aria-label="诊断状态分布">
        <div className="diagnostics-signal-chart-title">
          <strong>诊断状态分布</strong>
          <span>日志 / mutex / updater / preflight / Sentry</span>
        </div>
        <div className="diagnostics-signal-bars">
          {diagnosticSignals.map((signal) => (
            <div className={`diagnostics-signal-row ${signal.status}`} key={signal.id}>
              <div className="diagnostics-signal-label">
                <strong>{signal.label}</strong>
                <span>{signal.detail}</span>
              </div>
              <div
                aria-label={`${signal.label}: ${signal.value}%`}
                className="diagnostics-signal-track"
                role="meter"
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={signal.value}
              >
                <span style={{ width: `${signal.value}%` }} />
              </div>
              <code>{signal.value}%</code>
            </div>
          ))}
        </div>
      </div>
      <div className="dashboard-actions compact">
        <button disabled={Boolean(props.busy)} onClick={() => void props.onRefreshDiagnostics()} type="button">
          {props.busy === 'diagnostics-refresh' ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
          {props.busy === 'diagnostics-refresh' ? labels.refreshing : labels.refresh}
        </button>
        <button disabled={Boolean(props.busy)} onClick={() => void props.onCopyDiagnosticsReport()} type="button">
          <ShieldCheck size={16} />
          {labels.copyReport}
        </button>
        <button disabled={Boolean(props.busy) || !props.diagnostics?.logDir} onClick={() => void props.onOpenLogDir()} type="button">
          <FolderOpen size={16} />
          {labels.openLogDir}
        </button>
        <button disabled={Boolean(props.busy) || !props.syncPackage?.exists} onClick={() => void props.onOpenSyncPackage()} type="button">
          <Database size={16} />
          {labels.openSyncPackage}
        </button>
      </div>
      {props.diagnosticsReport ? (
        <div className="diagnostics-report-preview">
          <strong>{labels.reportPreview}</strong>
          <pre>{props.diagnosticsReport}</pre>
        </div>
      ) : null}
      <div className="log-preview">
        <strong>{labels.logs}</strong>
        <code>{redactSensitiveText(props.diagnostics?.latestLogFile ?? labels.noLogs)}</code>
        <pre>{diagnosticsLogPreview}</pre>
      </div>
      <div className="log-preview">
        <strong>Startup log</strong>
        <code>{redactSensitiveText(props.diagnostics?.startupLogFile ?? labels.noLogs)}</code>
        <pre>{startupLogPreview}</pre>
      </div>
    </section>
  );
}
