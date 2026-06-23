import {
  BookOpen,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Gauge,
  Import,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Target,
} from 'lucide-react';
import type { InstanceProfile } from '../../shared/types';

export type InstanceMoreActionLabels = {
  cloneCapabilityEdit: string;
  cloneCapabilityLead: string;
  cloneSnapshotExport: string;
  cloneSnapshotExportTitle: string;
  cloneSnapshotUse: string;
  cloneSnapshotUseTitle: string;
  historyCheck: string;
  historyExportMarkdown: string;
  historyExportMarkdownTitle: string;
  historyRefresh: string;
  openZed: string;
  refreshing: string;
  resourceDiff: string;
  sessionListRefresh: string;
  sessionUsageRefresh: string;
  syncPackageAppliedCopy: string;
  syncPackageAppliedOpen: string;
  verifying: string;
};

export function InstanceMoreActionItems(props: {
  appliedMarkerPath: string;
  busy: string;
  exportDir: string;
  instance: InstanceProfile;
  labels: InstanceMoreActionLabels;
  resourceDiffTitle: string;
  formatShortPath: (value?: string | null) => string;
  hasSyncPackageApplied: boolean;
  onCloneCapabilityEdit?: (instance: InstanceProfile) => void;
  onCloneSnapshotExport?: (id: string) => Promise<void>;
  onCloneSnapshotUse?: (id: string) => Promise<void>;
  onCopySyncPackageAppliedMarker?: (id: string) => Promise<void>;
  onCopySyncPackageResourceDiff?: (id: string) => Promise<void>;
  onHistoryExportMarkdown?: (id: string) => Promise<void>;
  onHistoryRefresh?: (id: string) => Promise<void>;
  onHistoryVerify?: (id: string) => Promise<void>;
  onOpenHistoryExportDir?: (id: string) => Promise<void>;
  onOpenSyncPackageAppliedMarker?: (id: string) => Promise<void>;
  onOpenZed?: (id: string) => Promise<void>;
  onSessionListRefresh?: (id: string) => Promise<void>;
  onSessionUsageRefresh?: (id: string) => Promise<void>;
}) {
  const isRefreshing = props.busy === `codex-history-refresh-${props.instance.id}`;
  const isVerifying = props.busy === `codex-history-verify-${props.instance.id}`;
  const isExporting = props.busy === `codex-history-export-${props.instance.id}`;
  const isExportingSnapshot = props.busy === `codex-clone-snapshot-export-${props.instance.id}`;
  const isUsingSnapshot = props.busy === `codex-clone-snapshot-use-${props.instance.id}`;
  const isListingSessions = props.busy === `codex-session-list-${props.instance.id}`;
  const isScanningUsage = props.busy === `codex-session-usage-${props.instance.id}`;
  const isOpeningZed = props.busy === `codex-open-zed-${props.instance.id}`;

  return (
    <>
      {props.onHistoryRefresh ? (
        <button disabled={Boolean(props.busy)} onClick={() => void props.onHistoryRefresh?.(props.instance.id)} type="button">
          {isRefreshing ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
          {isRefreshing ? props.labels.refreshing : props.labels.historyRefresh}
        </button>
      ) : null}
      {props.onHistoryVerify ? (
        <button disabled={Boolean(props.busy)} onClick={() => void props.onHistoryVerify?.(props.instance.id)} type="button">
          {isVerifying ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} />}
          {isVerifying ? props.labels.verifying : props.labels.historyCheck}
        </button>
      ) : null}
      {props.onHistoryExportMarkdown ? (
        <button
          disabled={Boolean(props.busy)}
          onClick={() => void props.onHistoryExportMarkdown?.(props.instance.id)}
          title={props.labels.historyExportMarkdownTitle}
          type="button"
        >
          {isExporting ? <Loader2 className="spin" size={15} /> : <Download size={15} />}
          {props.labels.historyExportMarkdown}
        </button>
      ) : null}
      {props.onCloneSnapshotExport ? (
        <button
          disabled={Boolean(props.busy)}
          onClick={() => void props.onCloneSnapshotExport?.(props.instance.id)}
          title={props.labels.cloneSnapshotExportTitle}
          type="button"
        >
          {isExportingSnapshot ? <Loader2 className="spin" size={15} /> : <FileText size={15} />}
          {props.labels.cloneSnapshotExport}
        </button>
      ) : null}
      {props.onCloneSnapshotUse ? (
        <button
          disabled={Boolean(props.busy)}
          onClick={() => void props.onCloneSnapshotUse?.(props.instance.id)}
          title={props.labels.cloneSnapshotUseTitle}
          type="button"
        >
          {isUsingSnapshot ? <Loader2 className="spin" size={15} /> : <Import size={15} />}
          {props.labels.cloneSnapshotUse}
        </button>
      ) : null}
      {props.onCloneCapabilityEdit ? (
        <button
          disabled={Boolean(props.busy)}
          onClick={() => props.onCloneCapabilityEdit?.(props.instance)}
          title={props.labels.cloneCapabilityLead}
          type="button"
        >
          <Target size={15} />
          {props.labels.cloneCapabilityEdit}
        </button>
      ) : null}
      {props.onOpenZed ? (
        <button
          disabled={Boolean(props.busy)}
          onClick={() => void props.onOpenZed?.(props.instance.id)}
          title={props.instance.workingDir || props.instance.userDataDir}
          type="button"
        >
          {isOpeningZed ? <Loader2 className="spin" size={15} /> : <ExternalLink size={15} />}
          {props.labels.openZed}
        </button>
      ) : null}
      {props.onOpenHistoryExportDir && props.exportDir ? (
        <button
          disabled={Boolean(props.busy)}
          onClick={() => void props.onOpenHistoryExportDir?.(props.instance.id)}
          title={props.exportDir}
          type="button"
        >
          <FolderOpen size={15} />
          {props.formatShortPath(props.exportDir)}
        </button>
      ) : null}
      {props.hasSyncPackageApplied && props.onOpenSyncPackageAppliedMarker ? (
        <button
          disabled={Boolean(props.busy)}
          onClick={() => void props.onOpenSyncPackageAppliedMarker?.(props.instance.id)}
          title={props.appliedMarkerPath}
          type="button"
        >
          <FileText size={15} />
          {props.labels.syncPackageAppliedOpen}
        </button>
      ) : null}
      {props.hasSyncPackageApplied && props.onCopySyncPackageAppliedMarker ? (
        <button
          disabled={Boolean(props.busy)}
          onClick={() => void props.onCopySyncPackageAppliedMarker?.(props.instance.id)}
          title={props.appliedMarkerPath}
          type="button"
        >
          <Copy size={15} />
          {props.labels.syncPackageAppliedCopy}
        </button>
      ) : null}
      {props.hasSyncPackageApplied && props.onCopySyncPackageResourceDiff ? (
        <button
          disabled={Boolean(props.busy)}
          onClick={() => void props.onCopySyncPackageResourceDiff?.(props.instance.id)}
          title={props.resourceDiffTitle}
          type="button"
        >
          <Copy size={15} />
          {props.labels.resourceDiff}
        </button>
      ) : null}
      {props.onSessionListRefresh ? (
        <button disabled={Boolean(props.busy)} onClick={() => void props.onSessionListRefresh?.(props.instance.id)} type="button">
          {isListingSessions ? <Loader2 className="spin" size={15} /> : <BookOpen size={15} />}
          {isListingSessions ? props.labels.refreshing : props.labels.sessionListRefresh}
        </button>
      ) : null}
      {props.onSessionUsageRefresh ? (
        <button disabled={Boolean(props.busy)} onClick={() => void props.onSessionUsageRefresh?.(props.instance.id)} type="button">
          {isScanningUsage ? <Loader2 className="spin" size={15} /> : <Gauge size={15} />}
          {isScanningUsage ? props.labels.refreshing : props.labels.sessionUsageRefresh}
        </button>
      ) : null}
    </>
  );
}
