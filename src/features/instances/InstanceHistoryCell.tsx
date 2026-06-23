import type { CloneReadinessSummary, CodexHistoryStatus, InstanceProfile } from '../../shared/types';
import { CloneReadinessPanel } from './CloneReadinessPanel';
import { InstanceCapabilityBadges, type InstanceCapabilityBadgeLabels } from './InstanceCapabilityBadges';
import { InstanceSyncBadges, type InstanceSyncBadgeState } from './InstanceSyncBadges';

export type InstanceHistoryCellLabels = {
  sessionIndexLabel: string;
  sessionFilesLabel: string;
};

export function InstanceHistoryCell(props: {
  appliedFreshness: InstanceSyncBadgeState;
  appliedMarkerPath: string;
  appliedSummary: string;
  capabilityLabels: InstanceCapabilityBadgeLabels;
  formatShortPath: (value?: string | null) => string;
  history?: CodexHistoryStatus | null;
  instance: InstanceProfile;
  labels: InstanceHistoryCellLabels;
  readiness: CloneReadinessSummary;
  resourceDiffHint: InstanceSyncBadgeState;
  summary: string;
}) {
  const history = props.history;
  return (
    <div className={history?.ok ? 'history-cell ok' : 'history-cell'}>
      <strong>{props.summary}</strong>
      <CloneReadinessPanel readiness={props.readiness} />
      <small>
        {props.labels.sessionIndexLabel} {history?.sessionIndexCount ?? 0} / {props.labels.sessionFilesLabel}{' '}
        {history?.sessionFileCount ?? 0}
      </small>
      <small>
        {history?.authMode ?? 'auth ?'} / {history?.providerBaseUrlHost ?? 'host ?'}
      </small>
      <small>sync {history?.syncMode ?? 'shared'}</small>
      <InstanceCapabilityBadges instance={props.instance} labels={props.capabilityLabels} />
      <InstanceSyncBadges
        appliedFreshness={props.appliedFreshness}
        appliedMarkerPath={props.appliedMarkerPath}
        appliedSummary={props.appliedSummary}
        formatShortPath={props.formatShortPath}
        lastBackupPath={history?.lastBackupPath}
        resourceDiffHint={props.resourceDiffHint}
        warning={history?.warnings?.[0]}
      />
    </div>
  );
}
