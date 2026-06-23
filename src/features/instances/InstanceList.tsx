import { CardMenu } from '../../components/CardMenu';
import type {
  CloneCapabilityEditDraft,
  CloneReadinessSummary,
  CodexHistoryStatus,
  CodexSessionSummary,
  CodexSessionUsageSummary,
  CodexSyncPackageStatus,
  InstanceProfile,
} from '../../shared/types';
import { CloneCapabilityEditor, type CloneCapabilityEditorLabels } from './CloneCapabilityEditor';
import type { InstanceCapabilityBadgeLabels } from './InstanceCapabilityBadges';
import { InstanceHistoryCell, type InstanceHistoryCellLabels } from './InstanceHistoryCell';
import { InstanceListSection, type InstanceListSectionLabels } from './InstanceListSection';
import { InstanceMoreActionItems, type InstanceMoreActionLabels } from './InstanceMoreActionItems';
import { InstancePrimaryActions, type InstancePrimaryActionLabels } from './InstancePrimaryActions';
import { InstanceStatusBadge } from './InstanceStatusBadge';
import { InstanceSyncBadgeState } from './InstanceSyncBadges';
import { InstanceTableHeader, type InstanceTableHeaderLabels } from './InstanceTableHeader';
import { SessionSummaryList, SessionUsageSummaryPanel, type SessionPanelLabels } from './SessionPanels';

export type InstanceListLabels = {
  section: InstanceListSectionLabels;
  tableHeader: InstanceTableHeaderLabels;
  status: { running: string; stopped: string };
  primaryAction: InstancePrimaryActionLabels;
  moreAction: InstanceMoreActionLabels;
  capabilityEditor: CloneCapabilityEditorLabels;
  capabilityBadge: InstanceCapabilityBadgeLabels;
  historyCell: InstanceHistoryCellLabels;
  sessionPanel: SessionPanelLabels;
  moreActions: string;
  syncPackageApplyReady: string;
  sessionDetails: string;
  sessionUsageTitle: string;
};

export type InstanceListHelpers = {
  formatTime: (timestamp?: number | null) => string;
  formatShortPath: (path?: string | null) => string;
  formatTokenCount: (tokens?: number | null) => string;
  formatUsd: (value?: number | null) => string;
  historySummary: (status?: CodexHistoryStatus | null) => string;
  syncPackageAppliedMarkerPath: (
    instance: InstanceProfile,
    history?: CodexHistoryStatus | null,
  ) => string;
  syncPackageAppliedSummary: (status?: CodexHistoryStatus | null) => string;
  syncPackageAppliedFreshness: (
    status: CodexHistoryStatus | null | undefined,
    currentPackage: CodexSyncPackageStatus | null,
  ) => InstanceSyncBadgeState;
  syncPackageResourceDiffHint: (
    status: CodexHistoryStatus | null | undefined,
    currentPackage: CodexSyncPackageStatus | null,
  ) => InstanceSyncBadgeState;
  cloneReadinessSummary: (
    instance: InstanceProfile,
    history: CodexHistoryStatus | null | undefined,
    syncPackage: CodexSyncPackageStatus | null,
  ) => CloneReadinessSummary;
};

export function InstanceList(props: {
  title: string;
  subtitle: string;
  emptyText: string;
  instances: InstanceProfile[];
  syncPackage: CodexSyncPackageStatus | null;
  busy: string;
  labels: InstanceListLabels;
  helpers: InstanceListHelpers;
  onRefresh: () => Promise<void>;
  onStart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  historyByInstance: Record<string, CodexHistoryStatus>;
  syncBlockedReason?: string | null;
  syncNotice?: string | null;
  onHistoryRefresh?: (id: string) => Promise<void>;
  onHistoryVerify?: (id: string) => Promise<void>;
  onHistoryRepair?: (id: string) => Promise<void>;
  onHistoryExportMarkdown?: (id: string) => Promise<void>;
  onCloneSnapshotExport?: (id: string) => Promise<void>;
  onCloneSnapshotUse?: (id: string) => Promise<void>;
  cloneCapabilityDrafts?: Record<string, CloneCapabilityEditDraft>;
  onCloneCapabilityEdit?: (instance: InstanceProfile) => void;
  onCloneCapabilityDraftChange?: (id: string, patch: Partial<CloneCapabilityEditDraft>) => void;
  onCloneCapabilitySave?: (id: string) => Promise<void>;
  onCloneCapabilityCancel?: (id: string) => void;
  sessionsByInstance?: Record<string, CodexSessionSummary[]>;
  usageByInstance?: Record<string, CodexSessionUsageSummary>;
  onSessionListRefresh?: (id: string) => Promise<void>;
  onSessionUsageRefresh?: (id: string) => Promise<void>;
  sessionSearchQuery?: string;
  onSessionSearchQueryChange?: (value: string) => void;
  onCopySessionProjectDir?: (projectDir: string) => Promise<void> | void;
  exportDirByInstance?: Record<string, string>;
  onOpenHistoryExportDir?: (id: string) => Promise<void>;
  onOpenZed?: (id: string) => Promise<void>;
  onOpenSyncPackageAppliedMarker?: (id: string) => Promise<void>;
  onCopySyncPackageAppliedMarker?: (id: string) => Promise<void>;
  onCopySyncPackageResourceDiff?: (id: string) => Promise<void>;
}) {
  return (
    <InstanceListSection
      labels={props.labels.section}
      onRefresh={props.onRefresh}
      onSessionSearchQueryChange={props.onSessionSearchQueryChange}
      sessionSearchQuery={props.sessionSearchQuery}
      subtitle={props.subtitle}
      title={props.title}
    >
      <InstanceTable {...props} />
    </InstanceListSection>
  );
}

function InstanceTable(props: Parameters<typeof InstanceList>[0]) {
  const { helpers, labels } = props;
  if (props.instances.length === 0) {
    return <div className="empty-state">{props.emptyText}</div>;
  }
  const showHistory = Boolean(props.onHistoryRefresh || props.onHistoryVerify || props.onHistoryRepair);

  return (
    <div className={showHistory ? 'instance-table with-history' : 'instance-table'}>
      <InstanceTableHeader labels={labels.tableHeader} showHistory={showHistory} />
      {props.instances.map((instance) => {
        const history = props.historyByInstance[instance.id] ?? instance.historyStatus;
        const capabilityDraft = props.cloneCapabilityDrafts?.[instance.id] ?? null;
        const syncHint = props.syncBlockedReason ?? props.syncNotice ?? labels.syncPackageApplyReady;
        const exportDir = props.exportDirByInstance?.[instance.id] ?? '';
        const sessions = props.sessionsByInstance?.[instance.id] ?? [];
        const usage = props.usageByInstance?.[instance.id] ?? null;
        const appliedMarkerPath = helpers.syncPackageAppliedMarkerPath(instance, history);
        const appliedFreshness = helpers.syncPackageAppliedFreshness(history, props.syncPackage);
        const resourceDiffHint = helpers.syncPackageResourceDiffHint(history, props.syncPackage);
        const readiness = helpers.cloneReadinessSummary(instance, history, props.syncPackage);
        return (
          <div className="table-row" key={instance.id}>
            <strong>{instance.name || instance.id}</strong>
            <code>{instance.userDataDir}</code>
            <InstanceStatusBadge instance={instance} labels={labels.status} />
            {showHistory ? (
              <InstanceHistoryCell
                appliedFreshness={appliedFreshness}
                appliedMarkerPath={history?.syncPackageApplied ? appliedMarkerPath : ''}
                appliedSummary={helpers.syncPackageAppliedSummary(history)}
                capabilityLabels={labels.capabilityBadge}
                formatShortPath={helpers.formatShortPath}
                history={history}
                instance={instance}
                labels={labels.historyCell}
                readiness={readiness}
                resourceDiffHint={resourceDiffHint}
                summary={helpers.historySummary(history)}
              />
            ) : null}
            <span>{helpers.formatTime(instance.lastLaunchedAt)}</span>
            <div className="row-actions">
              <div className="row-action-buttons">
                <InstancePrimaryActions
                  busy={props.busy}
                  instance={instance}
                  labels={labels.primaryAction}
                  onDelete={props.onDelete}
                  onHistoryRepair={props.onHistoryRepair}
                  onStart={props.onStart}
                  onStop={props.onStop}
                  syncBlockedReason={props.syncBlockedReason}
                />
                <CardMenu disabled={Boolean(props.busy)} label={labels.moreActions}>
                  <InstanceMoreActionItems
                    appliedMarkerPath={appliedMarkerPath}
                    busy={props.busy}
                    exportDir={exportDir}
                    formatShortPath={helpers.formatShortPath}
                    hasSyncPackageApplied={Boolean(history?.syncPackageApplied)}
                    instance={instance}
                    labels={labels.moreAction}
                    onCloneCapabilityEdit={props.onCloneCapabilityEdit}
                    onCloneSnapshotExport={props.onCloneSnapshotExport}
                    onCloneSnapshotUse={props.onCloneSnapshotUse}
                    onCopySyncPackageAppliedMarker={props.onCopySyncPackageAppliedMarker}
                    onCopySyncPackageResourceDiff={props.onCopySyncPackageResourceDiff}
                    onHistoryExportMarkdown={props.onHistoryExportMarkdown}
                    onHistoryRefresh={props.onHistoryRefresh}
                    onHistoryVerify={props.onHistoryVerify}
                    onOpenHistoryExportDir={props.onOpenHistoryExportDir}
                    onOpenSyncPackageAppliedMarker={props.onOpenSyncPackageAppliedMarker}
                    onOpenZed={props.onOpenZed}
                    onSessionListRefresh={props.onSessionListRefresh}
                    onSessionUsageRefresh={props.onSessionUsageRefresh}
                    resourceDiffTitle={resourceDiffHint.title}
                  />
                </CardMenu>
              </div>
              {props.onHistoryRepair ? (
                <small className={props.syncBlockedReason || props.syncNotice ? 'sync-action-hint warning' : 'sync-action-hint'}>
                  {syncHint}
                </small>
              ) : null}
              {capabilityDraft ? (
                <CloneCapabilityEditor
                  busy={props.busy}
                  draft={capabilityDraft}
                  formatShortPath={helpers.formatShortPath}
                  instance={instance}
                  labels={labels.capabilityEditor}
                  onCancel={props.onCloneCapabilityCancel}
                  onDraftChange={props.onCloneCapabilityDraftChange}
                  onSave={props.onCloneCapabilitySave}
                />
              ) : null}
              {sessions.length ? (
                <details className="instance-details">
                  <summary>{labels.sessionDetails}</summary>
                  <SessionSummaryList
                    formatShortPath={helpers.formatShortPath}
                    labels={labels.sessionPanel}
                    onCopyProjectDir={props.onCopySessionProjectDir}
                    query={props.sessionSearchQuery ?? ''}
                    sessions={sessions}
                  />
                </details>
              ) : null}
              {usage ? (
                <details className="instance-details">
                  <summary>{labels.sessionUsageTitle}</summary>
                  <SessionUsageSummaryPanel
                    formatTokenCount={helpers.formatTokenCount}
                    formatUsd={helpers.formatUsd}
                    labels={labels.sessionPanel}
                    usage={usage}
                  />
                </details>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
