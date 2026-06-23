import { Copy, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { CardMenu } from '../../components/CardMenu';
import type {
  CodexSyncPackageBackupSummary,
  CodexSyncPackagePreflightReport,
  CodexSyncPackageStatus,
} from '../../shared/types';
import {
  ResourceLensPanel,
  SyncPackageBackupTimeline,
  SyncPackagePreflightSummary,
  SyncPackageResourceList,
  type ResourceLensLabels,
  type SyncPackageMaintenanceLabels,
} from './SyncPackageResources';
import {
  syncPackageEntryLabel,
  syncPackageEntryPreview,
  syncPackageExcludedSummary,
  syncPackageIncludedSummary,
  syncPackageResourceItems,
} from './syncPackageUtils';

export type SyncPackagePanelLabels = {
  title: string;
  missing: string;
  ready: string;
  stale: string;
  staleHint: string;
  applyMissing: string;
  refresh: string;
  refreshing: string;
  historyRefresh: string;
  preflight: string;
  moreActions: string;
  copyResources: string;
  copyPreflight: string;
  copyBackups: string;
  resourceLensCopy: string;
  details: string;
  manifestIncluded: string;
  manifestExcluded: string;
  manifestEntryPreview: string;
  manifestMoreEntries: string;
  manifestNoEntries: string;
  resourceLensTitle: string;
  backups: string;
};

type SyncPackagePanelProps = {
  status: CodexSyncPackageStatus | null;
  backups: CodexSyncPackageBackupSummary[];
  preflight: CodexSyncPackagePreflightReport | null;
  busy: string;
  labels: SyncPackagePanelLabels;
  resourceLensLabels: ResourceLensLabels;
  maintenanceLabels: SyncPackageMaintenanceLabels;
  formatBytes: (bytes: number) => string;
  formatTime: (timestamp?: number | null) => string;
  onExtract: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onPreflight: () => Promise<void>;
  onCopyResourceReport: () => Promise<void>;
  onCopyResourceLensReport: () => Promise<void>;
  onCopyBackupReport: () => Promise<void>;
  onCopyPreflightReport: () => Promise<void>;
  onOpenBackup: (path: string) => Promise<void>;
  onRestoreBackup: (backupId: string) => Promise<void>;
};

export function SyncPackagePanel(props: SyncPackagePanelProps) {
  const { formatBytes, formatTime, labels, status } = props;
  const isReady = Boolean(status?.exists);
  const isStale = Boolean(status?.stale);
  const resources = syncPackageResourceItems(status, formatBytes);
  const entryPreview = syncPackageEntryPreview(status);
  const hiddenEntryCount = Math.max(0, (status?.entries?.length ?? 0) - entryPreview.length);
  const updateHint = !isReady
    ? labels.applyMissing
    : isStale
      ? labels.staleHint
      : '当前同步包可用于创建或同步/修复分身；如本体刚升级或配置刚变化，请先刷新本体。';

  return (
    <div className={isReady ? `sync-package-panel ready${isStale ? ' stale' : ''}` : 'sync-package-panel'}>
      <div className="sync-package-main">
        <div>
          <div className="panel-title">
            <strong>{labels.title}</strong>
            <span>{isReady ? (isStale ? labels.stale : labels.ready) : labels.missing}</span>
          </div>
          <code>{status?.packagePath || 'C:\\Users\\admin\\.codex_clone_launcher\\sync-package\\codex-home'}</code>
          {isReady ? (
            <div className="package-stats">
              <span>{formatTime(status?.createdAt)}</span>
              {status?.sourceModifiedAt ? <span>本体 {formatTime(status.sourceModifiedAt)}</span> : null}
              <span>{status?.fileCount ?? 0} 文件</span>
              <span>{status?.directoryCount ?? 0} 目录</span>
              <span>{formatBytes(status?.copiedBytes ?? 0)}</span>
              {isStale ? <span className="warning">{labels.staleHint}</span> : null}
              {status?.warnings?.length ? <span className="warning">{status.warnings[0]}</span> : null}
            </div>
          ) : null}
        </div>
        <div className="package-actions">
          <button disabled={Boolean(props.busy)} onClick={() => void props.onExtract()} type="button">
            {props.busy === 'codex-sync-package-extract' ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
            {props.busy === 'codex-sync-package-extract' ? labels.refreshing : labels.refresh}
          </button>
          <button disabled={Boolean(props.busy)} onClick={() => void props.onRefresh()} type="button">
            {props.busy === 'codex-sync-package-status' ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
            {props.busy === 'codex-sync-package-status' ? labels.refreshing : labels.historyRefresh}
          </button>
          <button disabled={Boolean(props.busy)} onClick={() => void props.onPreflight()} type="button">
            {props.busy === 'codex-sync-package-preflight' ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}
            {labels.preflight}
          </button>
          <CardMenu disabled={Boolean(props.busy)} label={labels.moreActions}>
            <button disabled={Boolean(props.busy)} onClick={() => void props.onCopyResourceReport()} type="button">
              <Copy size={16} />
              {labels.copyResources}
            </button>
            <button disabled={Boolean(props.busy) || !props.preflight} onClick={() => void props.onCopyPreflightReport()} type="button">
              <Copy size={16} />
              {labels.copyPreflight}
            </button>
            <button disabled={Boolean(props.busy) || !props.backups.length} onClick={() => void props.onCopyBackupReport()} type="button">
              <Copy size={16} />
              {labels.copyBackups}
            </button>
            <button disabled={Boolean(props.busy)} onClick={() => void props.onCopyResourceLensReport()} type="button">
              <Copy size={16} />
              {labels.resourceLensCopy}
            </button>
          </CardMenu>
        </div>
      </div>
      <div className={isStale ? 'sync-package-update-strip stale' : 'sync-package-update-strip'}>
        <div>
          <strong>{isStale ? '需要刷新本体同步包' : '本体同步状态'}</strong>
          <span>{updateHint}</span>
        </div>
        <div>
          <small>package: {formatTime(status?.createdAt)}</small>
          <small>source: {formatTime(status?.sourceModifiedAt)}</small>
        </div>
      </div>

      <div className="sync-package-detail">
        <SyncPackagePreflightSummary
          preflight={props.preflight}
          busy={props.busy}
          labels={props.maintenanceLabels}
          formatTime={formatTime}
          showActions={false}
          onPreflight={props.onPreflight}
          onCopyPreflightReport={props.onCopyPreflightReport}
        />

        <details className="sync-package-collapsible">
          <summary>{labels.details}</summary>
          <div className="sync-package-boundary">
            <div>
              <span>{labels.manifestIncluded}</span>
              <strong>{syncPackageIncludedSummary(status, formatBytes)}</strong>
              <small>sessions、skills、MCP、memories、rules、AGENTS.md</small>
            </div>
            <div>
              <span>{labels.manifestExcluded}</span>
              <strong>{syncPackageExcludedSummary(status)}</strong>
              <small>账号、额度、plugins/cache/log 和运行临时文件不进入同步包</small>
            </div>
          </div>

          <SyncPackageResourceList className="sync-package-resources" resources={resources} />

          <div className="sync-package-manifest-preview">
            <div className="manifest-preview-title">
              <strong>{labels.manifestEntryPreview}</strong>
              <span>{status?.manifestPath ?? 'manifest 未加载'}</span>
            </div>
            {entryPreview.length ? (
              <div className="manifest-entry-list">
                {entryPreview.map((entry) => (
                  <div key={`${entry.kind}:${entry.path}`}>
                    <code>{entry.path}</code>
                    <span>{syncPackageEntryLabel(entry, formatBytes)}</span>
                    {entry.error ? <small>{entry.error}</small> : null}
                  </div>
                ))}
                {hiddenEntryCount ? (
                  <div className="manifest-more">
                    <code>{labels.manifestMoreEntries}</code>
                    <span>+{hiddenEntryCount.toLocaleString()}</span>
                  </div>
                ) : null}
              </div>
            ) : (
              <small className="manifest-empty">{labels.manifestNoEntries}</small>
            )}
          </div>
        </details>

        <details className="sync-package-collapsible">
          <summary>{labels.resourceLensTitle}</summary>
          <ResourceLensPanel labels={props.resourceLensLabels} resources={resources} busy={props.busy} />
        </details>

        <details className="sync-package-collapsible">
          <summary>{labels.backups}</summary>
          <SyncPackageBackupTimeline
            backups={props.backups}
            busy={props.busy}
            labels={props.maintenanceLabels}
            formatBytes={formatBytes}
            formatTime={formatTime}
            showCopyAction={false}
            onCopyBackupReport={props.onCopyBackupReport}
            onOpenBackup={props.onOpenBackup}
            onRestoreBackup={props.onRestoreBackup}
          />
        </details>
      </div>
    </div>
  );
}
