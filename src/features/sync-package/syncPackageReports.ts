import type {
  CodexHistoryStatus,
  CodexSyncPackageBackupSummary,
  CodexSyncPackagePreflightReport,
  CodexSyncPackageResourceSummary,
  CodexSyncPackageStatus,
  InstanceProfile,
} from '../../shared/types';
import { resourceLensItems, resourceLensStats } from './SyncPackageResources';
import { syncPackageResourceItems } from './syncPackageUtils';

export type SyncPackageReportDeps = {
  formatBytes: (bytes: number) => string;
  formatTime: (timestamp?: number | null) => string;
  syncPackageStateLabel: (status: CodexSyncPackageStatus | null) => string;
};

export type SyncPackageResourceDiffReportDeps = {
  formatTime: (timestamp?: number | null) => string;
};

export function syncPackageResourceFingerprint(resource: CodexSyncPackageResourceSummary): string {
  const inventory = [...(resource.items ?? [])].sort().join(',');
  return [
    resource.status,
    resource.fileCount ?? 0,
    resource.directoryCount ?? 0,
    resource.bytes ?? 0,
    inventory,
  ].join('|');
}

export function buildSyncPackageResourceReport(
  status: CodexSyncPackageStatus | null,
  deps: SyncPackageReportDeps,
): string {
  const resources = syncPackageResourceItems(status, deps.formatBytes);
  return [
    '# Codex Sync Package Resources',
    `generatedAt: ${new Date().toISOString()}`,
    `exists: ${status?.exists ? 'yes' : 'no'}`,
    `state: ${deps.syncPackageStateLabel(status)}`,
    `stale: ${status?.stale ? 'yes' : 'no'}`,
    `packagePath: ${status?.packagePath ?? 'unknown'}`,
    `manifestPath: ${status?.manifestPath ?? 'unknown'}`,
    `source: ${status?.source ?? 'unknown'}`,
    `createdAt: ${deps.formatTime(status?.createdAt)}`,
    `sourceModifiedAt: ${deps.formatTime(status?.sourceModifiedAt)}`,
    `files: ${status?.fileCount ?? 0}`,
    `directories: ${status?.directoryCount ?? 0}`,
    `bytes: ${status?.copiedBytes ?? 0} (${deps.formatBytes(status?.copiedBytes ?? 0)})`,
    '',
    '## Resources',
    ...resources.flatMap((resource) => [
      `- ${resource.label}: ${resource.status ?? 'unknown'} | ${resource.value}`,
      `  applyMode: ${resource.applyMode || 'unknown'}`,
      `  detail: ${resource.detail || 'none'}`,
      `  inventory: ${resource.inventory?.length ? resource.inventory.join(', ') : 'none'}`,
    ]),
    '',
    '## Warnings',
    ...((status?.warnings ?? []).length ? (status?.warnings ?? []).map((item) => `- ${item}`) : ['- none']),
    '',
    '## Skipped',
    ...((status?.skipped ?? []).length ? (status?.skipped ?? []).map((item) => `- ${item}`) : ['- none']),
  ].join('\n');
}

export function buildResourceLensReport(
  status: CodexSyncPackageStatus | null,
  deps: SyncPackageReportDeps,
): string {
  const resources = resourceLensItems(syncPackageResourceItems(status, deps.formatBytes));
  const stats = resourceLensStats(resources);
  return [
    '# Codex MCP Skills Resource Lens',
    `generatedAt: ${new Date().toISOString()}`,
    `exists: ${status?.exists ? 'yes' : 'no'}`,
    `state: ${deps.syncPackageStateLabel(status)}`,
    `packagePath: ${status?.packagePath ?? 'unknown'}`,
    `manifestPath: ${status?.manifestPath ?? 'unknown'}`,
    `summary: ready=${stats.ready}/${stats.total} | issues=${stats.issues} | inventory=${stats.inventory}`,
    '',
    '## Focus Resources',
    ...(resources.length
      ? resources.flatMap((resource) => [
          `- ${resource.label}: ${resource.status ?? 'unknown'} | ${resource.value}`,
          `  id: ${resource.id || 'legacy'}`,
          `  applyMode: ${resource.applyMode || 'unknown'}`,
          `  detail: ${resource.detail || 'none'}`,
          `  inventory: ${resource.inventory?.length ? resource.inventory.join(', ') : 'none'}`,
        ])
      : ['- none']),
    '',
    '## Boundary',
    '- readOnly: yes',
    '- writesSourceProfile: no',
    '- writesCloneProfile: no',
    '- excluded: auth.json, .credentials.json, account tokens, quota state, plugins, cache, logs, tmp',
  ].join('\n');
}

export function buildSyncPackageBackupReport(
  backups: CodexSyncPackageBackupSummary[],
  deps: SyncPackageReportDeps,
): string {
  return [
    '# Codex Sync Package Backup Timeline',
    `generatedAt: ${new Date().toISOString()}`,
    `count: ${backups.length}`,
    '',
    ...(
      backups.length
        ? backups.flatMap((backup, index) => [
            `## ${index + 1}. ${backup.id}`,
            `status: ${backup.status}`,
            `backupCreatedAt: ${deps.formatTime(backup.backupCreatedAt)}`,
            `packageCreatedAt: ${deps.formatTime(backup.packageCreatedAt)}`,
            `backupPath: ${backup.backupPath}`,
            `packagePath: ${backup.packagePath}`,
            `manifestPath: ${backup.manifestPath}`,
            `source: ${backup.source ?? 'unknown'}`,
            `files: ${backup.fileCount}`,
            `directories: ${backup.directoryCount}`,
            `bytes: ${backup.copiedBytes} (${deps.formatBytes(backup.copiedBytes)})`,
            `resources: ${backup.readyResourceCount}/${backup.resourceCount}`,
            `warnings: ${backup.warnings.length ? backup.warnings.join(' / ') : 'none'}`,
            `error: ${backup.error || 'none'}`,
            '',
          ])
        : ['- no sync package backups']
    ),
  ].join('\n');
}

export function buildSyncPackagePreflightReport(
  preflight: CodexSyncPackagePreflightReport | null,
  deps: SyncPackageReportDeps,
): string {
  return [
    '# Codex Sync Package Preflight',
    `generatedAt: ${new Date().toISOString()}`,
    `status: ${preflight?.status ?? 'not checked'}`,
    `readyToApply: ${preflight?.readyToApply ? 'yes' : 'no'}`,
    `checkedAt: ${deps.formatTime(preflight?.checkedAt)}`,
    `packageCreatedAt: ${deps.formatTime(preflight?.packageCreatedAt)}`,
    `stale: ${preflight?.stale ? 'yes' : 'no'}`,
    `packagePath: ${preflight?.packagePath ?? 'unknown'}`,
    `manifestPath: ${preflight?.manifestPath ?? 'unknown'}`,
    `source: ${preflight?.source ?? 'unknown'}`,
    `entriesChecked: ${preflight?.entriesChecked ?? 0}`,
    `resourcesChecked: ${preflight?.resourcesChecked ?? 0}`,
    `errors: ${preflight?.errorCount ?? 0}`,
    `warnings: ${preflight?.warningCount ?? 0}`,
    '',
    '## Boundary',
    '- Source module: extracts or refreshes the sync package only.',
    '- Clone module: applies an existing package only after manual Sync/Repair.',
    '- Preflight is read-only; it does not restore backups or copy live source profile data.',
    '',
    '## Checks',
    ...((preflight?.checks ?? []).length
      ? (preflight?.checks ?? []).map((check) =>
          `- [${check.status}] ${check.label}: ${check.detail}${check.action ? ` | action: ${check.action}` : ''}`,
        )
      : ['- no preflight checks have been run']),
    '',
    '## Unsafe Paths',
    ...((preflight?.unsafePaths ?? []).length ? (preflight?.unsafePaths ?? []).map((item) => `- ${item}`) : ['- none']),
  ].join('\n');
}

function syncPackageResourceSummaryLine(resource: CodexSyncPackageResourceSummary): string {
  return [
    `${resource.label} [${resource.id}]`,
    `status=${resource.status || 'unknown'}`,
    `files=${resource.fileCount ?? 0}`,
    `dirs=${resource.directoryCount ?? 0}`,
    `bytes=${resource.bytes ?? 0}`,
    `applyMode=${resource.applyMode || 'unknown'}`,
    `paths=${resource.paths?.join(', ') || 'none'}`,
    `missing=${resource.missing?.join(', ') || 'none'}`,
    `errors=${resource.errors?.join(', ') || 'none'}`,
    `items=${resource.items?.join(', ') || 'none'}`,
  ].join(' | ');
}

export function buildSyncPackageResourceDiffReport(
  input: {
    instance: InstanceProfile;
    history?: CodexHistoryStatus | null;
    currentPackage: CodexSyncPackageStatus | null;
  },
  deps: SyncPackageResourceDiffReportDeps,
): string {
  const marker = input.history?.syncPackageApplied ?? null;
  const currentResources = input.currentPackage?.resources ?? [];
  const appliedResources = marker?.resources ?? [];
  const appliedById = new Map(appliedResources.map((resource) => [resource.id, resource]));
  const currentById = new Map(currentResources.map((resource) => [resource.id, resource]));
  const changed: Array<{
    current: CodexSyncPackageResourceSummary;
    applied: CodexSyncPackageResourceSummary;
  }> = [];
  const newResources: CodexSyncPackageResourceSummary[] = [];
  const removedResources: CodexSyncPackageResourceSummary[] = [];

  for (const current of currentResources) {
    const applied = appliedById.get(current.id);
    if (!applied) {
      newResources.push(current);
      continue;
    }
    if (syncPackageResourceFingerprint(current) !== syncPackageResourceFingerprint(applied)) {
      changed.push({ current, applied });
    }
  }

  for (const applied of appliedResources) {
    if (!currentById.has(applied.id)) removedResources.push(applied);
  }

  const unchangedCount = currentResources.filter((resource) => {
    const applied = appliedById.get(resource.id);
    return applied && syncPackageResourceFingerprint(resource) === syncPackageResourceFingerprint(applied);
  }).length;

  const changedLines = changed.length
    ? changed.flatMap((item) => [
        `- ${item.current.label}`,
        `  current: ${syncPackageResourceSummaryLine(item.current)}`,
        `  applied: ${syncPackageResourceSummaryLine(item.applied)}`,
      ])
    : ['- none'];
  const newLines = newResources.length
    ? newResources.map((resource) => `- ${syncPackageResourceSummaryLine(resource)}`)
    : ['- none'];
  const removedLines = removedResources.length
    ? removedResources.map((resource) => `- ${syncPackageResourceSummaryLine(resource)}`)
    : ['- none'];

  return [
    '# Codex Clone Sync Package Resource Diff',
    `generatedAt: ${new Date().toISOString()}`,
    `instanceId: ${input.instance.id}`,
    `instanceName: ${input.instance.name || input.instance.id}`,
    `codexHome: ${input.history?.codexHome || input.instance.userDataDir}`,
    '',
    '## Boundary',
    '- Source module state: current extracted sync package only.',
    '- Clone module state: clone-owned clone-sync-package-applied.json marker only.',
    '- This report does not copy from the running source profile and does not apply data to the clone.',
    '',
    '## Package',
    `currentPackageExists: ${input.currentPackage?.exists ? 'yes' : 'no'}`,
    `currentPackagePath: ${input.currentPackage?.packagePath ?? 'unknown'}`,
    `currentPackageCreatedAt: ${deps.formatTime(input.currentPackage?.createdAt)}`,
    `markerApplied: ${marker ? 'yes' : 'no'}`,
    `markerAppliedAt: ${deps.formatTime(marker?.appliedAt)}`,
    `markerPackagePath: ${marker?.packagePath ?? 'none'}`,
    `markerPackageCreatedAt: ${deps.formatTime(marker?.packageCreatedAt)}`,
    `markerStaleWhenApplied: ${marker?.staleWhenApplied ? 'yes' : 'no'}`,
    '',
    '## Summary',
    `currentResourceCount: ${currentResources.length}`,
    `appliedResourceCount: ${appliedResources.length}`,
    `unchanged: ${unchangedCount}`,
    `changed: ${changed.length}`,
    `new: ${newResources.length}`,
    `removed: ${removedResources.length}`,
    '',
    '## Changed',
    ...changedLines,
    '',
    '## New In Current Package',
    ...newLines,
    '',
    '## Removed Since Applied',
    ...removedLines,
  ].join('\n');
}
