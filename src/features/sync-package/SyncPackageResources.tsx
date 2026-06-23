import { useState } from 'react';
import { BookOpen, Copy, FolderOpen, Loader2, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { reportError } from '../../telemetry';
import type { CodexSyncPackageBackupSummary, CodexSyncPackagePreflightReport } from '../../shared/types';

export type SyncPackageResourceItem = {
  id?: string;
  label: string;
  value: string;
  detail: string;
  status?: string;
  applyMode?: string;
  inventory?: string[];
};

type ResourceStatusFilter = 'all' | 'ready' | 'partial' | 'issues' | 'missing';

export type ResourceLensLabels = {
  title: string;
  lead: string;
  ready: string;
  issues: string;
  inventory: string;
  empty: string;
  copy: string;
};

export type SyncPackageMaintenanceLabels = {
  copy: string;
  open: string;
  preflightCheck: string;
  restoreBackup: string;
};

type ResourceLensStats = {
  total: number;
  ready: number;
  issues: number;
  inventory: number;
};

const resourceStatusFilters: ResourceStatusFilter[] = ['all', 'ready', 'partial', 'issues', 'missing'];
const resourceLensResourceIds = new Set(['skills', 'mcp', 'memory', 'config', 'goals']);
const resourceLensKeywords = [
  'skill',
  'skills',
  'mcp',
  'memory',
  'memories',
  'rules',
  'agents',
  'agents.md',
  'config',
  'goals',
  'prompts',
  '技能',
  '记忆',
  '规则',
  '配置',
  '目标',
];

function syncPackageBackupStatusLabel(status: string): string {
  switch (status) {
    case 'ready':
      return 'Ready';
    case 'missingManifest':
      return 'Missing manifest';
    case 'error':
      return 'Error';
    default:
      return status || 'Unknown';
  }
}

function syncPackagePreflightStatusLabel(report: CodexSyncPackagePreflightReport | null): string {
  if (!report) return 'preflight not checked';
  if (report.status === 'ok') return 'preflight OK';
  if (report.status === 'warning') return 'preflight warnings';
  if (report.status === 'error') return 'preflight blocked';
  if (report.status === 'missing') return 'package missing';
  return `preflight ${report.status}`;
}

function syncPackagePreflightClass(report: CodexSyncPackagePreflightReport | null): string {
  if (!report) return 'not-checked';
  return report.status || 'unknown';
}

function resourceStatusFilterLabel(filter: ResourceStatusFilter): string {
  switch (filter) {
    case 'ready':
      return 'Ready';
    case 'partial':
      return 'Partial';
    case 'issues':
      return 'Issues';
    case 'missing':
      return 'Missing';
    default:
      return 'All';
  }
}

function resourceMatchesStatusFilter(item: SyncPackageResourceItem, filter: ResourceStatusFilter): boolean {
  switch (filter) {
    case 'ready':
      return item.status === 'ready';
    case 'partial':
      return item.status === 'partial';
    case 'issues':
      return item.status === 'partial' || item.status === 'error';
    case 'missing':
      return item.status === 'missing';
    default:
      return true;
  }
}

function resourceMatchesQuery(item: SyncPackageResourceItem, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    item.label,
    item.value,
    item.detail,
    item.status ?? '',
    item.applyMode ?? '',
    ...(item.inventory ?? []),
  ]
    .join(' ')
    .toLowerCase()
    .includes(normalized);
}

function filteredSyncPackageResources(
  resources: SyncPackageResourceItem[],
  query: string,
  statusFilter: ResourceStatusFilter,
): SyncPackageResourceItem[] {
  return resources.filter(
    (item) => resourceMatchesStatusFilter(item, statusFilter) && resourceMatchesQuery(item, query),
  );
}

function syncPackageResourceClass(status?: string): string {
  return status ? `sync-resource ${status}` : 'sync-resource';
}

function resourceLensSearchText(item: SyncPackageResourceItem): string {
  return [
    item.id ?? '',
    item.label,
    item.value,
    item.detail,
    item.status ?? '',
    item.applyMode ?? '',
    ...(item.inventory ?? []),
  ]
    .join(' ')
    .toLowerCase();
}

function isResourceLensItem(item: SyncPackageResourceItem): boolean {
  const id = item.id?.toLowerCase();
  if (id && resourceLensResourceIds.has(id)) return true;
  const searchable = resourceLensSearchText(item);
  return resourceLensKeywords.some((keyword) => searchable.includes(keyword));
}

export function resourceLensItems(resources: SyncPackageResourceItem[]): SyncPackageResourceItem[] {
  return resources.filter(isResourceLensItem);
}

export function resourceLensStats(items: SyncPackageResourceItem[]): ResourceLensStats {
  return items.reduce<ResourceLensStats>(
    (stats, item) => {
      const inventoryCount = item.inventory?.length ?? 0;
      return {
        total: stats.total + 1,
        ready: stats.ready + (item.status === 'ready' ? 1 : 0),
        issues: stats.issues + (item.status === 'ready' ? 0 : 1),
        inventory: stats.inventory + inventoryCount,
      };
    },
    { total: 0, ready: 0, issues: 0, inventory: 0 },
  );
}

function ResourceInventoryChips(props: { items?: string[]; label?: string }) {
  const items = props.items ?? [];
  if (!items.length) return null;
  const visible = items.slice(0, 6);
  const hidden = items.slice(visible.length);
  async function copyInventory() {
    try {
      await navigator.clipboard.writeText([props.label, ...items].filter(Boolean).join('\n'));
    } catch (error) {
      reportError(error, { area: 'sync-package', action: 'copy-resource-inventory', detail: props.label });
    }
  }
  return (
    <div className="resource-inventory">
      <button className="resource-inventory-copy" onClick={() => void copyInventory()} title="Copy resource inventory" type="button">
        <Copy size={12} />
      </button>
      {visible.map((item) => (
        <code key={item}>{item}</code>
      ))}
      {hidden.length ? (
        <details className="resource-inventory-more">
          <summary>
            <code>+{hidden.length}</code>
          </summary>
          <div>
            {hidden.map((item) => (
              <code key={item}>{item}</code>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export function SyncPackageResourceList(props: {
  resources: SyncPackageResourceItem[];
  className: 'resource-list' | 'sync-package-resources';
}) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ResourceStatusFilter>('all');
  const visibleResources = filteredSyncPackageResources(props.resources, query, statusFilter);

  return (
    <div className="sync-resource-explorer">
      <div className="resource-filter-toolbar">
        <label className="resource-filter-search">
          <Search size={14} />
          <input
            aria-label="Search sync package resources"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search resources"
            type="search"
            value={query}
          />
        </label>
        <div className="resource-filter-row">
          {resourceStatusFilters.map((filter) => (
            <button
              className={filter === statusFilter ? 'active' : undefined}
              key={filter}
              onClick={() => setStatusFilter(filter)}
              type="button"
            >
              {resourceStatusFilterLabel(filter)}
            </button>
          ))}
        </div>
        <span className="resource-filter-count">
          {visibleResources.length}/{props.resources.length}
        </span>
      </div>
      <div className={props.className}>
        {visibleResources.map((item) => (
          <div className={syncPackageResourceClass(item.status)} key={item.label}>
            <strong>{item.label}</strong>
            <span>{item.value}</span>
            <small>{item.detail}</small>
            <ResourceInventoryChips items={item.inventory} label={item.label} />
            {item.applyMode ? <small className="resource-apply-mode">{item.applyMode}</small> : null}
          </div>
        ))}
        {!visibleResources.length ? (
          <div className="sync-resource resource-empty">
            <strong>No matching resources</strong>
            <span>0/{props.resources.length}</span>
            <small>Clear the search or switch resource status filter.</small>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ResourceLensPanel(props: {
  resources: SyncPackageResourceItem[];
  labels: ResourceLensLabels;
  busy?: string;
  compact?: boolean;
  onCopy?: () => unknown;
}) {
  const items = resourceLensItems(props.resources);
  const stats = resourceLensStats(items);

  return (
    <div className={props.compact ? 'resource-lens-panel compact' : 'resource-lens-panel'}>
      <div className="resource-lens-header">
        <div>
          <strong>
            <BookOpen size={15} />
            {props.labels.title}
          </strong>
          <span>{props.labels.lead}</span>
        </div>
        {props.onCopy ? (
          <button disabled={Boolean(props.busy)} onClick={() => void props.onCopy?.()} type="button">
            <Copy size={14} />
            {props.labels.copy}
          </button>
        ) : null}
      </div>
      <div className="resource-lens-stats">
        <span>
          <strong>{`${stats.ready}/${stats.total}`}</strong>
          <small>{props.labels.ready}</small>
        </span>
        <span>
          <strong>{stats.issues}</strong>
          <small>{props.labels.issues}</small>
        </span>
        <span>
          <strong>{stats.inventory}</strong>
          <small>{props.labels.inventory}</small>
        </span>
      </div>
      {items.length ? (
        <div className="resource-lens-grid">
          {items.map((item) => (
            <div className={`resource-lens-item ${item.status ?? 'unknown'}`} key={item.id ?? item.label}>
              <div>
                <strong>{item.label}</strong>
                <span>{item.value}</span>
              </div>
              <small>{item.detail}</small>
              <ResourceInventoryChips items={item.inventory} label={item.label} />
            </div>
          ))}
        </div>
      ) : (
        <div className="resource-lens-empty">{props.labels.empty}</div>
      )}
    </div>
  );
}

export function SyncPackagePreflightSummary(props: {
  preflight: CodexSyncPackagePreflightReport | null;
  busy: string;
  labels: SyncPackageMaintenanceLabels;
  formatTime: (value?: number | null) => string;
  compact?: boolean;
  showActions?: boolean;
  onPreflight: () => Promise<void> | unknown;
  onCopyPreflightReport: () => Promise<void> | unknown;
}) {
  const preflight = props.preflight;
  const issueChecks = preflight?.checks.filter((check) => check.status !== 'ok') ?? [];
  const visibleChecks = (issueChecks.length ? issueChecks : preflight?.checks ?? []).slice(0, props.compact ? 3 : 6);
  return (
    <div className={`sync-package-preflight ${syncPackagePreflightClass(preflight)}${props.compact ? ' compact' : ''}`}>
      <div className="sync-package-preflight-title">
        <div>
          <strong>Preflight</strong>
          <span>{syncPackagePreflightStatusLabel(preflight)}</span>
        </div>
        {props.showActions === false ? null : (
          <div>
            <button disabled={Boolean(props.busy)} onClick={() => void props.onPreflight()} type="button">
              {props.busy === 'codex-sync-package-preflight' ? <Loader2 className="spin" size={14} /> : <ShieldCheck size={14} />}
              {props.labels.preflightCheck}
            </button>
            <button disabled={Boolean(props.busy) || !preflight} onClick={() => void props.onCopyPreflightReport()} type="button">
              <Copy size={14} />
              {props.labels.copy}
            </button>
          </div>
        )}
      </div>
      <div className="sync-package-preflight-stats">
        <span>{preflight?.readyToApply ? 'ready to apply' : 'not ready'}</span>
        <span>errors {preflight?.errorCount ?? 0}</span>
        <span>warnings {preflight?.warningCount ?? 0}</span>
        <span>entries {preflight?.entriesChecked ?? 0}</span>
        <span>resources {preflight?.resourcesChecked ?? 0}</span>
        {preflight?.checkedAt ? <span>{props.formatTime(preflight.checkedAt)}</span> : null}
      </div>
      {visibleChecks.length ? (
        <div className="sync-package-preflight-checks">
          {visibleChecks.map((check) => (
            <div className={`sync-package-preflight-check ${check.status}`} key={check.id}>
              <strong>{check.label}</strong>
              <span>{check.status}</span>
              <small>{check.detail}</small>
              {check.action ? <small className="warning">{check.action}</small> : null}
            </div>
          ))}
        </div>
      ) : (
        <small className="manifest-empty">Run Preflight before Sync/Repair when package update behavior looks wrong.</small>
      )}
    </div>
  );
}

export function SyncPackageBackupTimeline(props: {
  backups: CodexSyncPackageBackupSummary[];
  busy: string;
  labels: SyncPackageMaintenanceLabels;
  formatBytes: (value: number) => string;
  formatTime: (value?: number | null) => string;
  showCopyAction?: boolean;
  onOpenBackup: (path: string) => Promise<void>;
  onRestoreBackup: (backupId: string) => Promise<void>;
  onCopyBackupReport: () => Promise<void>;
}) {
  const visible = props.backups.slice(0, 6);
  return (
    <div className="sync-package-backups">
      <div className="sync-package-backups-title">
        <div>
          <strong>Backup timeline</strong>
          <span>{props.backups.length ? `${props.backups.length} snapshots` : 'no backups yet'}</span>
        </div>
        {props.showCopyAction === false ? null : (
          <button disabled={Boolean(props.busy) || !props.backups.length} onClick={() => void props.onCopyBackupReport()} type="button">
            <Copy size={14} />
            {props.labels.copy}
          </button>
        )}
      </div>
      {visible.length ? (
        <div className="sync-package-backup-list">
          {visible.map((backup) => (
            <div className={`sync-package-backup ${backup.status}`} key={backup.id}>
              <div>
                <strong>{backup.id}</strong>
                <span>{syncPackageBackupStatusLabel(backup.status)}</span>
              </div>
              <small>backup {props.formatTime(backup.backupCreatedAt)}</small>
              <small>package {props.formatTime(backup.packageCreatedAt)}</small>
              <small>
                resources {backup.readyResourceCount}/{backup.resourceCount} - {props.formatBytes(backup.copiedBytes)}
              </small>
              {backup.error ? <small className="warning">{backup.error}</small> : null}
              {backup.warnings?.length ? <small className="warning">{backup.warnings[0]}</small> : null}
              <div className="sync-package-backup-actions">
                <button disabled={Boolean(props.busy)} onClick={() => void props.onOpenBackup(backup.backupPath)} title={backup.backupPath} type="button">
                  <FolderOpen size={13} />
                  {props.labels.open}
                </button>
                <button
                  disabled={Boolean(props.busy) || backup.status !== 'ready'}
                  onClick={() => void props.onRestoreBackup(backup.id)}
                  title="Restore this snapshot as the current source sync package; clones still update only after Sync/Repair."
                  type="button"
                >
                  {props.busy === `codex-sync-package-restore-${backup.id}` ? <Loader2 className="spin" size={13} /> : <RefreshCw size={13} />}
                  {props.labels.restoreBackup}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <small className="manifest-empty">No previous extracted package has been backed up yet.</small>
      )}
    </div>
  );
}
