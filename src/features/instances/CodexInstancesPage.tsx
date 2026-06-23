import type {
  CloneCapabilityEditDraft,
  CodexHistoryStatus,
  CodexSessionSummary,
  CodexSessionUsageSummary,
  CodexSyncPackageBackupSummary,
  CodexSyncPackagePreflightReport,
  CodexSyncPackageStatus,
  InstanceProfile,
} from '../../shared/types';
import type { ResourceLensLabels, SyncPackageMaintenanceLabels } from '../sync-package/SyncPackageResources';
import { SyncPackagePanel, type SyncPackagePanelLabels } from '../sync-package/SyncPackagePanel';
import { InstanceList, type InstanceListHelpers, type InstanceListLabels } from './InstanceList';

export type CodexInstancesPageLabels = {
  syncPackage: SyncPackagePanelLabels;
  codexList: string;
  codexSubtitle: string;
  noCodex: string;
  syncPackageApplyStale: string;
};

type CodexInstancesPageProps = {
  labels: CodexInstancesPageLabels;
  resourceLensLabels: ResourceLensLabels;
  maintenanceLabels: SyncPackageMaintenanceLabels;
  instanceListLabels: InstanceListLabels;
  instanceListHelpers: InstanceListHelpers;
  syncPackage: CodexSyncPackageStatus | null;
  syncPackageBackups: CodexSyncPackageBackupSummary[];
  syncPackagePreflight: CodexSyncPackagePreflightReport | null;
  instances: InstanceProfile[];
  busy: string;
  historyByInstance: Record<string, CodexHistoryStatus>;
  cloneCapabilityDrafts: Record<string, CloneCapabilityEditDraft>;
  sessionsByInstance: Record<string, CodexSessionSummary[]>;
  usageByInstance: Record<string, CodexSessionUsageSummary>;
  sessionSearchQuery: string;
  exportDirByInstance: Record<string, string>;
  syncBlockedReason: string | null;
  formatBytes: (bytes: number) => string;
  formatTime: (timestamp?: number | null) => string;
  onExtractSyncPackage: () => Promise<void>;
  onRefreshSyncPackage: () => Promise<void>;
  onPreflightSyncPackage: () => Promise<void>;
  onCopyResourceReport: () => Promise<void>;
  onCopyResourceLensReport: () => Promise<void>;
  onCopyBackupReport: () => Promise<void>;
  onCopyPreflightReport: () => Promise<void>;
  onOpenBackup: (path: string) => Promise<void>;
  onRestoreBackup: (backupId: string) => Promise<void>;
  onRefreshInstances: () => Promise<void>;
  onStartInstance: (id: string) => Promise<void>;
  onStopInstance: (id: string) => Promise<void>;
  onDeleteInstance: (id: string) => Promise<void>;
  onHistoryRefresh: (id: string) => Promise<void>;
  onHistoryVerify: (id: string) => Promise<void>;
  onHistoryRepair: (id: string) => Promise<void>;
  onHistoryExportMarkdown: (id: string) => Promise<void>;
  onCloneSnapshotExport: (id: string) => Promise<void>;
  onCloneSnapshotUse: (id: string) => Promise<void>;
  onCloneCapabilityEdit: (instance: InstanceProfile) => void;
  onCloneCapabilityDraftChange: (id: string, patch: Partial<CloneCapabilityEditDraft>) => void;
  onCloneCapabilitySave: (id: string) => Promise<void>;
  onCloneCapabilityCancel: (id: string) => void;
  onSessionListRefresh: (id: string) => Promise<void>;
  onSessionUsageRefresh: (id: string) => Promise<void>;
  onSessionSearchQueryChange: (value: string) => void;
  onCopySessionProjectDir: (projectDir: string) => Promise<void> | void;
  onOpenHistoryExportDir: (id: string) => Promise<void>;
  onOpenZed: (id: string) => Promise<void>;
  onOpenSyncPackageAppliedMarker: (id: string) => Promise<void>;
  onCopySyncPackageAppliedMarker: (id: string) => Promise<void>;
  onCopySyncPackageResourceDiff: (id: string) => Promise<void>;
};

export function CodexInstancesPage(props: CodexInstancesPageProps) {
  return (
    <section className="list-page">
      <SyncPackagePanel
        status={props.syncPackage}
        backups={props.syncPackageBackups}
        preflight={props.syncPackagePreflight}
        busy={props.busy}
        labels={props.labels.syncPackage}
        resourceLensLabels={props.resourceLensLabels}
        maintenanceLabels={props.maintenanceLabels}
        formatBytes={props.formatBytes}
        formatTime={props.formatTime}
        onExtract={props.onExtractSyncPackage}
        onRefresh={props.onRefreshSyncPackage}
        onPreflight={props.onPreflightSyncPackage}
        onCopyResourceReport={props.onCopyResourceReport}
        onCopyResourceLensReport={props.onCopyResourceLensReport}
        onCopyBackupReport={props.onCopyBackupReport}
        onCopyPreflightReport={props.onCopyPreflightReport}
        onOpenBackup={props.onOpenBackup}
        onRestoreBackup={props.onRestoreBackup}
      />
      <InstanceList
        title={props.labels.codexList}
        subtitle={props.labels.codexSubtitle}
        emptyText={props.labels.noCodex}
        instances={props.instances}
        syncPackage={props.syncPackage}
        labels={props.instanceListLabels}
        helpers={props.instanceListHelpers}
        onRefresh={props.onRefreshInstances}
        onStart={props.onStartInstance}
        onStop={props.onStopInstance}
        onDelete={props.onDeleteInstance}
        busy={props.busy}
        syncBlockedReason={props.syncBlockedReason}
        syncNotice={props.syncPackage?.stale ? props.labels.syncPackageApplyStale : null}
        historyByInstance={props.historyByInstance}
        onHistoryRefresh={props.onHistoryRefresh}
        onHistoryVerify={props.onHistoryVerify}
        onHistoryRepair={props.onHistoryRepair}
        onHistoryExportMarkdown={props.onHistoryExportMarkdown}
        onCloneSnapshotExport={props.onCloneSnapshotExport}
        onCloneSnapshotUse={props.onCloneSnapshotUse}
        cloneCapabilityDrafts={props.cloneCapabilityDrafts}
        onCloneCapabilityEdit={props.onCloneCapabilityEdit}
        onCloneCapabilityDraftChange={props.onCloneCapabilityDraftChange}
        onCloneCapabilitySave={props.onCloneCapabilitySave}
        onCloneCapabilityCancel={props.onCloneCapabilityCancel}
        sessionsByInstance={props.sessionsByInstance}
        usageByInstance={props.usageByInstance}
        onSessionListRefresh={props.onSessionListRefresh}
        onSessionUsageRefresh={props.onSessionUsageRefresh}
        sessionSearchQuery={props.sessionSearchQuery}
        onSessionSearchQueryChange={props.onSessionSearchQueryChange}
        onCopySessionProjectDir={props.onCopySessionProjectDir}
        exportDirByInstance={props.exportDirByInstance}
        onOpenHistoryExportDir={props.onOpenHistoryExportDir}
        onOpenZed={props.onOpenZed}
        onOpenSyncPackageAppliedMarker={props.onOpenSyncPackageAppliedMarker}
        onCopySyncPackageAppliedMarker={props.onCopySyncPackageAppliedMarker}
        onCopySyncPackageResourceDiff={props.onCopySyncPackageResourceDiff}
      />
    </section>
  );
}
