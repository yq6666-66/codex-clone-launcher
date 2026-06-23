import { Loader2, RefreshCw } from 'lucide-react';

export type UpdatePanelStatus = {
  message: string;
  version?: string;
  notes?: string;
  downloaded?: number;
  total?: number;
  checkedAt?: number;
  diagnostic?: string;
};

export type UpdatePanelLabels = {
  title: string;
  currentVersion: string;
  unknownVersion: string;
  lead: string;
  repository: string;
  endpoint: string;
  latestVersion: string;
  checkedAt: string;
  autoCheck: string;
  check: string;
  checking: string;
  install: string;
  checkAndInstall: string;
  installing: string;
  skip: string;
  resumeSkipped: string;
  openReleases: string;
  never: string;
};

type UpdatePanelProps = {
  appVersion: string;
  busy: string;
  status: UpdatePanelStatus;
  hasUpdate: boolean;
  autoCheck: boolean;
  skippedVersion: string;
  ownerRepo: string;
  endpoint: string;
  labels: UpdatePanelLabels;
  onAutoCheckChange: (enabled: boolean) => void;
  onCheck: () => void;
  onInstall: () => void;
  onSkip: () => void;
  onClearSkip: () => void;
  onOpenReleases: () => void;
};

function formatTime(timestamp: number | undefined, fallback: string): string {
  if (!timestamp) return fallback;
  return new Date(timestamp).toLocaleString();
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function UpdatePanel(props: UpdatePanelProps) {
  const labels = props.labels;
  const isChecking = props.busy === 'app-update-check';
  const isInstalling = props.busy === 'app-update-install';
  const downloaded = props.status.downloaded ?? 0;
  const total = props.status.total ?? 0;
  const progress = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;

  return (
    <section className="update-panel">
      <div>
        <span>{labels.title}</span>
        <strong>
          {labels.currentVersion}: {props.appVersion || labels.unknownVersion}
        </strong>
        <p>{labels.lead}</p>
        <small>
          {labels.repository}: {props.ownerRepo}
        </small>
        <small>
          {labels.endpoint}: {props.endpoint}
        </small>
      </div>
      <div className="update-status">
        <strong>{props.status.message}</strong>
        {props.status.version ? (
          <small>
            {labels.latestVersion}: {props.status.version}
          </small>
        ) : null}
        {props.status.notes ? <small>{props.status.notes}</small> : null}
        {props.status.checkedAt ? (
          <small>
            {labels.checkedAt}: {formatTime(props.status.checkedAt, labels.never)}
          </small>
        ) : null}
        {props.status.diagnostic ? <small title={props.status.diagnostic}>{props.status.diagnostic}</small> : null}
        {isInstalling ? (
          <div className="update-progress">
            <span style={{ width: `${progress}%` }} />
          </div>
        ) : null}
        {isInstalling ? <small>{total > 0 ? `${formatBytes(downloaded)} / ${formatBytes(total)}` : formatBytes(downloaded)}</small> : null}
      </div>
      <div className="update-actions">
        <label className="update-toggle">
          <input
            checked={props.autoCheck}
            disabled={Boolean(props.busy)}
            name="app-update-auto-check"
            onChange={(event) => props.onAutoCheckChange(event.currentTarget.checked)}
            type="checkbox"
          />
          <span>{labels.autoCheck}</span>
        </label>
        <button disabled={Boolean(props.busy)} onClick={props.onCheck} type="button">
          {isChecking ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
          {isChecking ? labels.checking : labels.check}
        </button>
        <button disabled={Boolean(props.busy)} onClick={props.onInstall} type="button">
          {isInstalling ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
          {isInstalling ? labels.installing : props.hasUpdate ? labels.install : labels.checkAndInstall}
        </button>
        {props.hasUpdate ? (
          <button disabled={Boolean(props.busy)} onClick={props.onSkip} type="button">
            {labels.skip}
          </button>
        ) : null}
        {props.skippedVersion ? (
          <button disabled={Boolean(props.busy)} onClick={props.onClearSkip} type="button">
            {labels.resumeSkipped}: {props.skippedVersion}
          </button>
        ) : null}
        <button disabled={Boolean(props.busy)} onClick={props.onOpenReleases} type="button">
          {labels.openReleases}
        </button>
      </div>
    </section>
  );
}
