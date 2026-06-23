import type {
  CodexHistoryStatus,
  CodexSyncPackageAppliedMarker,
  CodexSyncPackagePreflightReport,
  CodexSyncPackageStatus,
  InstanceProfile,
} from '../../shared/types';
import { syncPackageResourceFingerprint } from './syncPackageReports';

const APPLIED_SYNC_PACKAGE_MARKER_FILE = 'clone-sync-package-applied.json';

export type SyncPackageFreshness = {
  label: string;
  tone: 'ok' | 'warning' | 'muted';
  title: string;
};

export type SyncPackageResourceDiffHint = {
  label: string;
  tone: 'ok' | 'warning' | 'muted';
  title: string;
};

export type SyncPackageStatusLabels = {
  missing: string;
  stale: string;
  ready: string;
  currentUnknown: string;
  applyUnknown: string;
  applyMissing: string;
  currentMissing: string;
  appliedMissing: string;
  currentApplied: string;
};

export type SyncPackageFormatters = {
  formatTime: (timestamp?: number | null) => string;
  formatBytes: (bytes: number) => string;
};

function joinLocalPath(base: string, leaf: string): string {
  const trimmed = base.trim().replace(/[\\/]+$/, '');
  if (!trimmed) return leaf;
  const separator = trimmed.includes('\\') ? '\\' : '/';
  return `${trimmed}${separator}${leaf}`;
}

export function syncPackageAppliedMarkerPath(
  instance: InstanceProfile,
  status?: CodexHistoryStatus | null,
): string {
  const codexHome = status?.codexHome || instance.userDataDir;
  return codexHome ? joinLocalPath(codexHome, APPLIED_SYNC_PACKAGE_MARKER_FILE) : '';
}

export function syncPackageAppliedResourceRatio(
  marker?: CodexSyncPackageAppliedMarker | null,
): string {
  if (!marker) return '0/0 类';
  const readyResources = marker.resources?.filter((resource) => resource.status === 'ready').length ?? 0;
  const resourceCount = marker.resources?.length ?? 0;
  return `${readyResources}/${resourceCount} 类`;
}

export function syncPackageAppliedSummary(
  status: CodexHistoryStatus | null | undefined,
  formatters: SyncPackageFormatters,
): string {
  const marker = status?.syncPackageApplied;
  if (!marker) return '同步包应用：未记录';
  const stale = marker.staleWhenApplied ? ' / 应用时本体已有更新' : '';
  return `同步包应用：${formatters.formatTime(marker.appliedAt)} / ${formatters.formatBytes(
    marker.copiedBytes ?? 0,
  )} / ${syncPackageAppliedResourceRatio(marker)}${stale}`;
}

export function syncPackageAppliedFreshness(
  status: CodexHistoryStatus | null | undefined,
  currentPackage: CodexSyncPackageStatus | null,
  labels: SyncPackageStatusLabels,
  formatters: SyncPackageFormatters,
): SyncPackageFreshness {
  if (!currentPackage) {
    return {
      label: labels.currentUnknown,
      tone: 'muted',
      title: labels.applyUnknown,
    };
  }
  if (!currentPackage.exists) {
    return {
      label: labels.currentUnknown,
      tone: 'muted',
      title: labels.applyMissing,
    };
  }
  const marker = status?.syncPackageApplied;
  if (!marker) {
    return {
      label: labels.currentMissing,
      tone: 'warning',
      title: labels.appliedMissing,
    };
  }
  const markerCreatedAt = marker.packageCreatedAt ?? 0;
  const currentCreatedAt = currentPackage.createdAt ?? 0;
  if (markerCreatedAt && currentCreatedAt && markerCreatedAt + 1_000 < currentCreatedAt) {
    return {
      label: labels.currentMissing,
      tone: 'warning',
      title: `分身应用的是 ${formatters.formatTime(markerCreatedAt)} 的同步包；当前同步包是 ${formatters.formatTime(
        currentCreatedAt,
      )}。`,
    };
  }
  const stale = marker.staleWhenApplied ? '；应用时本体已有更新' : '';
  return {
    label: labels.currentApplied,
    tone: marker.staleWhenApplied ? 'warning' : 'ok',
    title: `${syncPackageAppliedSummary(status, formatters)}${stale}`,
  };
}

export function syncPackageResourceDiffHint(
  status: CodexHistoryStatus | null | undefined,
  currentPackage: CodexSyncPackageStatus | null,
): SyncPackageResourceDiffHint {
  const marker = status?.syncPackageApplied;
  if (!currentPackage?.exists || !currentPackage.resources?.length) {
    return {
      label: '资源差异待刷新',
      tone: 'muted',
      title: '当前同步包资源清单不可用；先刷新/提取本体同步包。',
    };
  }
  if (!marker?.resources?.length) {
    return {
      label: '资源差异待同步',
      tone: 'warning',
      title: '这个分身还没有应用记录；执行同步/修复后会写入 clone-sync-package-applied.json。',
    };
  }

  const appliedById = new Map(marker.resources.map((resource) => [resource.id, resource]));
  const changed: string[] = [];
  const missing: string[] = [];
  const newResources: string[] = [];

  for (const resource of currentPackage.resources) {
    const applied = appliedById.get(resource.id);
    if (!applied) {
      newResources.push(resource.label);
      continue;
    }
    if (syncPackageResourceFingerprint(applied) !== syncPackageResourceFingerprint(resource)) {
      changed.push(resource.label);
    }
  }

  const currentIds = new Set(currentPackage.resources.map((resource) => resource.id));
  for (const resource of marker.resources) {
    if (!currentIds.has(resource.id)) missing.push(resource.label);
  }

  const totalDiffs = changed.length + missing.length + newResources.length;
  if (!totalDiffs) {
    return {
      label: '资源清单一致',
      tone: 'ok',
      title: '当前同步包资源清单与这个分身上次应用记录一致。',
    };
  }

  const detail = [
    changed.length ? `变化：${changed.join('、')}` : '',
    newResources.length ? `新增：${newResources.join('、')}` : '',
    missing.length ? `旧项：${missing.join('、')}` : '',
  ]
    .filter(Boolean)
    .join('；');

  return {
    label: `资源差异 ${totalDiffs} 类`,
    tone: 'warning',
    title: `${detail}。如需把这些差异应用到分身，请手动执行同步/修复。`,
  };
}

export function syncPackageStateLabel(
  status: CodexSyncPackageStatus | null,
  labels: Pick<SyncPackageStatusLabels, 'missing' | 'stale' | 'ready'>,
): string {
  if (!status?.exists) return labels.missing;
  return status.stale ? labels.stale : labels.ready;
}

export function syncPackageApplyBlocker(
  status: CodexSyncPackageStatus | null,
  labels: Pick<SyncPackageStatusLabels, 'applyUnknown' | 'applyMissing'>,
): string | null {
  if (!status) return labels.applyUnknown;
  if (!status.exists) return labels.applyMissing;
  return null;
}

export function syncPackagePreflightBlocker(
  preflight: CodexSyncPackagePreflightReport | null,
): string | null {
  if (!preflight) return null;
  if (preflight.readyToApply && preflight.status !== 'error' && preflight.status !== 'missing') {
    return null;
  }
  return `Preflight blocked Sync/Repair: ${preflight.errorCount} errors, ${preflight.warningCount} warnings. Copy the preflight report or refresh the source package.`;
}

export function syncPackageRepairBlocker(
  status: CodexSyncPackageStatus | null,
  preflight: CodexSyncPackagePreflightReport | null,
  labels: Pick<SyncPackageStatusLabels, 'applyUnknown' | 'applyMissing'>,
): string | null {
  return syncPackageApplyBlocker(status, labels) ?? syncPackagePreflightBlocker(preflight);
}
