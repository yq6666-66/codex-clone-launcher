import type { ReactNode } from 'react';
import {
  Activity,
  CircleAlert,
  Database,
  Gauge,
  Layers,
  Loader2,
  RefreshCw,
  Rocket,
  Settings,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { cloneHealthStats } from '../instances/instanceUtils';
import type {
  CodexHistoryStatus,
  CodexSyncPackageStatus,
  InstanceProfile,
} from '../../shared/types';

export type DashboardPageLabels = {
  dashboard: string;
  dashboardLead: string;
  openCreate: string;
  openList: string;
  openSettings: string;
  cloneRunningCount: string;
  cloneTotalCount: string;
  packageFreshness: string;
  launcherVersion: string;
  healthTitle: string;
  healthLead: string;
  healthChecked: string;
  healthMismatchWarning: string;
  healthBulkRefresh: string;
  healthBulkVerify: string;
  healthBulkRepair: string;
  syncPackageTitle: string;
  syncManifestLead: string;
  syncPackageManage: string;
};

type DashboardPageProps = {
  labels: DashboardPageLabels;
  syncPackage: CodexSyncPackageStatus | null;
  instances: InstanceProfile[];
  historyByInstance: { [id: string]: CodexHistoryStatus };
  appVersion: string;
  busy: string;
  packageState: string;
  packageBytesLabel: string;
  syncBlocker: string | null;
  onOpenCreate: () => void;
  onOpenList: () => void;
  onOpenSettings: () => void;
  onBulkRefresh: () => unknown;
  onBulkVerify: () => unknown;
  onBulkRepair: () => unknown;
};

export function DashboardPage(props: DashboardPageProps) {
  const health = cloneHealthStats(props.instances, props.historyByInstance);
  const packageReady = Boolean(props.syncPackage?.exists);
  const labels = props.labels;

  return (
    <section className="dashboard-page">
      <div className="section-header dashboard-header">
        <div>
          <h2>{labels.dashboard}</h2>
          <p>{labels.dashboardLead}</p>
        </div>
      </div>

      <div className="dashboard-grid dashboard-overview-grid">
        <section className="dashboard-card dashboard-command-panel">
          <div className="card-title-row">
            <span>{labels.dashboard}</span>
            <Activity size={18} />
          </div>
          <div className="summary-grid dashboard-metrics dashboard-status-ledger">
            <SummaryTile icon={<Gauge size={18} />} label={labels.cloneRunningCount} value={String(health.running)} />
            <SummaryTile icon={<Layers size={18} />} label={labels.cloneTotalCount} value={String(props.instances.length)} />
            <SummaryTile icon={<ShieldCheck size={18} />} label={labels.packageFreshness} value={props.packageState} />
            <SummaryTile icon={<Activity size={18} />} label={labels.launcherVersion} value={props.appVersion || 'unknown'} />
          </div>
          <div className="dashboard-actions dashboard-primary-actions">
            <button disabled={Boolean(props.busy)} onClick={props.onOpenCreate} type="button">
              <Rocket size={16} />
              {labels.openCreate}
            </button>
            <button disabled={Boolean(props.busy)} onClick={props.onOpenList} type="button">
              <Database size={16} />
              {labels.openList}
            </button>
            <button disabled={Boolean(props.busy)} onClick={props.onOpenSettings} type="button">
              <Settings size={16} />
              {labels.openSettings}
            </button>
          </div>
        </section>

        <section className="dashboard-card health-card">
          <div className="card-title-row">
            <span>{labels.healthTitle}</span>
            <Activity size={18} />
          </div>
          <p>{labels.healthLead}</p>
          <div className="summary-grid health-summary-grid">
            <SummaryTile icon={<ShieldCheck size={16} />} label={labels.healthChecked} value={String(health.checked)} />
            <SummaryTile icon={<CircleAlert size={16} />} label={labels.healthMismatchWarning} value={`${health.mismatch} / ${health.warnings}`} />
          </div>
          <div className="dashboard-actions compact health-actions">
            <button disabled={Boolean(props.busy) || !props.instances.length} onClick={() => void props.onBulkRefresh()} type="button">
              {props.busy === 'codex-history-bulk-refresh' ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
              {labels.healthBulkRefresh}
            </button>
            <button disabled={Boolean(props.busy) || !props.instances.length} onClick={() => void props.onBulkVerify()} type="button">
              {props.busy === 'codex-history-bulk-verify' ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}
              {labels.healthBulkVerify}
            </button>
            <button
              disabled={Boolean(props.busy) || !props.instances.length || Boolean(props.syncBlocker)}
              onClick={() => void props.onBulkRepair()}
              title={props.syncBlocker ?? undefined}
              type="button"
            >
              {props.busy === 'codex-history-bulk-repair' ? <Loader2 className="spin" size={16} /> : <Wrench size={16} />}
              {labels.healthBulkRepair}
            </button>
          </div>
        </section>

        <section className={packageReady ? 'dashboard-card sync-card ready' : 'dashboard-card sync-card'}>
          <div className="card-title-row">
            <span>{labels.syncPackageTitle}</span>
            <Database size={18} />
          </div>
          <p>{labels.syncManifestLead}</p>
          <div className="package-state-row">
            <strong>{props.packageState}</strong>
            <span>{props.packageBytesLabel}</span>
          </div>
          <div className="dashboard-actions compact">
            <button disabled={Boolean(props.busy)} onClick={props.onOpenList} type="button">
              <Database size={16} />
              {labels.syncPackageManage}
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}

function SummaryTile(props: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="summary-tile">
      {props.icon}
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}
