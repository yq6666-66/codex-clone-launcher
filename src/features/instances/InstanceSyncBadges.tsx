export type InstanceSyncBadgeTone = 'ok' | 'warning' | 'muted';

export type InstanceSyncBadgeState = {
  label: string;
  tone: InstanceSyncBadgeTone;
  title: string;
};

export function InstanceSyncBadges(props: {
  appliedFreshness: InstanceSyncBadgeState;
  appliedMarkerPath: string;
  appliedSummary: string;
  lastBackupPath?: string | null;
  resourceDiffHint: InstanceSyncBadgeState;
  warning?: string | null;
  formatShortPath: (value?: string | null) => string;
}) {
  return (
    <>
      <small>backup {props.formatShortPath(props.lastBackupPath)}</small>
      <small className={`package-freshness ${props.appliedFreshness.tone}`} title={props.appliedFreshness.title}>
        {props.appliedFreshness.label}
      </small>
      <small className={`package-freshness resource-diff ${props.resourceDiffHint.tone}`} title={props.resourceDiffHint.title}>
        {props.resourceDiffHint.label}
      </small>
      <small title={props.appliedMarkerPath || undefined}>{props.appliedSummary}</small>
      {props.warning ? <small className="warning">{props.warning}</small> : null}
    </>
  );
}
