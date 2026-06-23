import type {
  CloneReadinessSummary,
  CodexHistoryStatus,
  CodexProviderConnectionTestResult,
  CodexProviderModelsFetchResult,
  CodexSessionUsageSummary,
  CodexSyncPackageBackupSummary,
  CodexSyncPackagePreflightReport,
  CodexSyncPackageStatus,
  DiagnosticsSnapshot,
  GitWorktreeCreateResult,
  GitWorktreeDefaults,
  GitWorktreeFormValues,
  InstanceProfile,
} from '../../shared/types';
import type { ProviderPreset } from '../../providerCatalog';
import { redactSensitiveText, type LocalErrorEvent } from '../../telemetry';
import type { ProviderConfigAudit } from '../accounts/ProviderFeedbackPanels';
import type { AvailableUpdate } from '../updater/useAppUpdater';
import type { UpdatePanelStatus } from '../updater/UpdatePanel';
import { cloneHealthStats } from '../instances/instanceUtils';
import { sessionUsageCostSummary } from '../instances/sessionUsage';
import { resourceLensItems, resourceLensStats } from '../sync-package/SyncPackageResources';
import { syncPackageResourceItems } from '../sync-package/syncPackageUtils';
import {
  syncPackageAppliedFreshness,
  syncPackageAppliedMarkerPath,
  syncPackageAppliedResourceRatio,
  type SyncPackageStatusLabels,
} from '../sync-package/syncPackageStatus';

export function gitWorktreeDiagnosticsLines(input: {
  form?: GitWorktreeFormValues | null;
  defaults?: GitWorktreeDefaults | null;
  result?: GitWorktreeCreateResult | null;
}): string[] {
  const form = input.form ?? null;
  const defaults = input.defaults ?? null;
  const result = input.result ?? null;
  const warnings = [...(defaults?.warnings ?? []), ...(result?.warnings ?? [])];
  return [
    '## Upstream Worktree',
    `formRepoDir: ${form?.repoDir || 'empty'}`,
    `formBase: ${(form?.baseRemote || 'upstream')}/${form?.baseBranch || 'main'}`,
    `formNewBranch: ${form?.newBranch || 'empty'}`,
    `formWorktreeDir: ${form?.worktreeDir || 'empty'}`,
    `fetchBeforeCreate: ${form?.fetchBeforeCreate === false ? 'no' : 'yes'}`,
    `detectedRepoDir: ${defaults?.repoDir ?? 'not detected'}`,
    `detectedCurrentBranch: ${defaults?.currentBranch || 'unknown'}`,
    `detectedRemotes: ${(defaults?.remotes ?? []).join(', ') || 'none'}`,
    `detectedBaseRef: ${defaults?.baseRef ?? 'not detected'}`,
    `detectedDirty: ${defaults ? (defaults.dirty ? 'yes' : 'no') : 'unknown'}`,
    `createdWorktree: ${result?.worktreeDir ?? 'none'}`,
    `createdBranch: ${result?.newBranch ?? 'none'}`,
    `createdBaseRef: ${result?.baseRef ?? 'none'}`,
    `createdFetched: ${result ? (result.fetched ? 'yes' : 'no') : 'unknown'}`,
    `warnings: ${warnings.length ? warnings.join(' / ') : 'none'}`,
  ];
}

export function buildGitWorktreeDiagnosticsReport(input: {
  form: GitWorktreeFormValues;
  defaults: GitWorktreeDefaults | null;
  result: GitWorktreeCreateResult | null;
  appVersion: string;
}): string {
  return [
    '# Codex Clone Launcher Upstream Worktree Diagnostics',
    `generatedAt: ${new Date().toISOString()}`,
    `appVersion: ${input.appVersion || 'unknown'}`,
    '',
    ...gitWorktreeDiagnosticsLines(input),
  ].join('\n');
}

type ProviderHealthRecordForReport = {
  providerName: string;
  normalizedBaseUrl: string;
  model: string;
  ok: boolean;
  status: string;
  httpStatus?: number | null;
  latencyMs: number;
  testedAt: number;
};

export function buildDiagnosticsReport(input: {
  diagnostics: DiagnosticsSnapshot | null;
  syncPackage: CodexSyncPackageStatus | null;
  syncPackageBackups?: CodexSyncPackageBackupSummary[];
  syncPackagePreflight?: CodexSyncPackagePreflightReport | null;
  updateStatus: UpdatePanelStatus;
  availableUpdate?: AvailableUpdate | null;
  updaterOwnerRepo: string;
  updaterEndpoint: string;
  localErrors: LocalErrorEvent[];
  gitWorktreeForm?: GitWorktreeFormValues | null;
  gitWorktreeDefaults?: GitWorktreeDefaults | null;
  gitWorktreeResult?: GitWorktreeCreateResult | null;
  providerTestResult?: CodexProviderConnectionTestResult | null;
  providerModelsResult?: CodexProviderModelsFetchResult | null;
  providerConfigAudit?: ProviderConfigAudit | null;
  modelCatalogEnabled?: boolean;
  modelCatalogModels?: string[];
  promptPackEnabled?: boolean;
  promptPackChars?: number;
  instances: InstanceProfile[];
  historyByInstance: Record<string, CodexHistoryStatus>;
  usageByInstance?: Record<string, CodexSessionUsageSummary>;
  providerPresetCatalog?: ProviderPreset[];
  providerHealthHistory?: ProviderHealthRecordForReport[];
  codexAppPath: string;
  appVersion: string;
  labels: {
    diagnosticsNoLogs: string;
    sessionCostUnpriced: string;
  };
  formatters: {
    formatTime: (timestamp?: number | null) => string;
    formatBytes: (bytes: number) => string;
    formatShortPath: (path?: string | null) => string;
    formatUsd: (value?: number | null) => string;
  };
  syncPackageLabels: SyncPackageStatusLabels;
  syncPackageStateLabel: (status: CodexSyncPackageStatus | null) => string;
  cloneReadinessSummary: (
    instance: InstanceProfile,
    history: CodexHistoryStatus | null | undefined,
    syncPackage: CodexSyncPackageStatus | null,
  ) => CloneReadinessSummary;
}): string {
  const health = cloneHealthStats(input.instances, input.historyByInstance);
  const sync = input.syncPackage;
  const backups = input.syncPackageBackups ?? [];
  const preflight = input.syncPackagePreflight ?? null;
  const update = input.availableUpdate ?? null;
  const diagnostics = input.diagnostics;
  const usageByInstance = input.usageByInstance ?? {};
  const providerPresetCatalog = input.providerPresetCatalog ?? [];
  const providerConfigAudit = input.providerConfigAudit ?? null;
  const providerHealthHistory = input.providerHealthHistory ?? [];
  const customProviderPresets = providerPresetCatalog.filter((preset) => preset.custom);
  const providerPresetTags = new Set(providerPresetCatalog.flatMap((preset) => preset.tags ?? []));
  const resourceLens = resourceLensItems(syncPackageResourceItems(sync, input.formatters.formatBytes));
  const resourceLensSummary = resourceLensStats(resourceLens);
  const packageIssues = [...(sync?.warnings ?? []), ...(sync?.skipped ?? []).map((item) => `skipped: ${item}`)];
  const latestLog = diagnostics?.latestLogTail
    ? redactSensitiveText(diagnostics.latestLogTail.split(/\r?\n/).filter(Boolean).slice(-20).join('\n'))
    : input.labels.diagnosticsNoLogs;
  const startupLog = diagnostics?.startupLogTail
    ? redactSensitiveText(diagnostics.startupLogTail.split(/\r?\n/).filter(Boolean).slice(-20).join('\n'))
    : input.labels.diagnosticsNoLogs;
  const instanceLines = input.instances.length
    ? input.instances.map((instance) => {
        const history = input.historyByInstance[instance.id] ?? instance.historyStatus;
        const usage = usageByInstance[instance.id];
        const markerPath = history?.syncPackageApplied ? syncPackageAppliedMarkerPath(instance, history) : 'none';
        const packageFreshness = syncPackageAppliedFreshness(
          history,
          sync,
          input.syncPackageLabels,
          input.formatters,
        );
        const readiness = input.cloneReadinessSummary(instance, history, sync);
        const usageCost = usage
          ? sessionUsageCostSummary(usage, { unpriced: input.labels.sessionCostUnpriced })
          : null;
        return [
          `- ${instance.name || instance.id}`,
          `readiness=${readiness.label} (${readiness.detail})`,
          `running=${instance.running ? 'yes' : 'no'}`,
          `threads=${history?.threadCount ?? 0}`,
          `mismatch=${history?.mismatchCount ?? 0}`,
          `auth=${history?.authOk ? 'ok' : 'warning'}`,
          `provider=${history?.currentProvider ?? 'unknown'}`,
          `modelCatalog=${instance.modelCatalogEnabled ? `${instance.modelCatalogCount ?? 0} models` : 'none'}`,
          `launchScript=${instance.launchScript?.trim() ? 'configured' : 'none'}`,
          `goalPursuit=${instance.goalEnabled ? 'configured' : 'none'}`,
          `promptPack=${instance.promptPackEnabled ? 'configured' : 'none'}`,
          `backup=${input.formatters.formatShortPath(history?.lastBackupPath)}`,
          `package=${input.formatters.formatTime(history?.syncPackageApplied?.appliedAt)}`,
          `packageMarker=${markerPath}`,
          `packageResources=${syncPackageAppliedResourceRatio(history?.syncPackageApplied)}`,
          `packageFreshness=${packageFreshness.label}`,
          `usage=${usage ? `${usage.eventCount} events / ${usage.totalTokens} tokens / ${usage.scannedFiles} files` : 'not scanned'}`,
          `usageCost=${usageCost ? `${input.formatters.formatUsd(usageCost.totalCostUsd)} estimated / priced=${usageCost.pricedModels} / unpriced=${usageCost.unpricedModels}` : 'not estimated'}`,
        ].join(' | ');
      })
    : ['- no managed Codex clones'];

  return [
    '# Codex Clone Launcher Diagnostics',
    `generatedAt: ${new Date().toISOString()}`,
    `appVersion: ${input.appVersion || 'unknown'}`,
    `launcherPid: ${diagnostics?.launcherPid ?? 'unknown'}`,
    `codexAppPath: ${redactSensitiveText(input.codexAppPath || diagnostics?.codexAppPath || 'unknown')}`,
    `codexAppPathExists: ${diagnostics?.codexAppPathExists ? 'yes' : 'no/unknown'}`,
    `codexLaunchPath: ${redactSensitiveText(diagnostics?.codexLaunchPath ?? 'unknown')}`,
    `codexLaunchPathSource: ${diagnostics?.codexLaunchPathSource ?? 'unknown'}`,
    `logDir: ${redactSensitiveText(diagnostics?.logDir ?? 'unknown')}`,
    `latestLogFile: ${redactSensitiveText(diagnostics?.latestLogFile ?? 'none')}`,
    `startupLogFile: ${redactSensitiveText(diagnostics?.startupLogFile ?? 'none')}`,
    `startupMutexName: ${diagnostics?.startupMutexName ?? 'Global\\CodexCloneLauncherStartup'}`,
    '',
    '## Updater',
    `status: ${input.updateStatus.message || 'unknown'}`,
    `version: ${input.updateStatus.version ?? update?.version ?? 'none'}`,
    `hasUpdate: ${update ? 'yes' : 'no'}`,
    `checkedAt: ${input.formatters.formatTime(input.updateStatus.checkedAt)}`,
    `ownerRepo: ${input.updaterOwnerRepo || 'unknown'}`,
    `endpoint: ${input.updaterEndpoint || 'unknown'}`,
    `diagnostic: ${redactSensitiveText(input.updateStatus.diagnostic ?? 'none')}`,
    '',
    '## Sync Package',
    `exists: ${sync?.exists ? 'yes' : 'no'}`,
    `state: ${input.syncPackageStateLabel(sync)}`,
    `stale: ${sync?.stale ? 'yes' : 'no'}`,
    `packagePath: ${sync?.packagePath ?? 'unknown'}`,
    `manifestPath: ${sync?.manifestPath ?? 'unknown'}`,
    `source: ${sync?.source ?? 'unknown'}`,
    `createdAt: ${input.formatters.formatTime(sync?.createdAt)}`,
    `sourceModifiedAt: ${input.formatters.formatTime(sync?.sourceModifiedAt)}`,
    `files: ${sync?.fileCount ?? 0}`,
    `directories: ${sync?.directoryCount ?? 0}`,
    `bytes: ${sync?.copiedBytes ?? 0} (${input.formatters.formatBytes(sync?.copiedBytes ?? 0)})`,
    `entries: ${sync?.entries?.length ?? 0}`,
    `preflight: ${preflight?.status ?? 'not checked'} | ready=${preflight?.readyToApply ? 'yes' : 'no'} | errors=${preflight?.errorCount ?? 0} | warnings=${preflight?.warningCount ?? 0}`,
    `issues: ${packageIssues.length ? packageIssues.join(' / ') : 'none'}`,
    '',
    '## Sync Package Resources',
    ...(sync?.resources?.length
      ? sync.resources.map(
          (resource) =>
            `- ${resource.label}: ${resource.status} | files=${resource.fileCount} | dirs=${resource.directoryCount} | bytes=${resource.bytes} | missing=${resource.missing.length} | errors=${resource.errors.length} | items=${(resource.items ?? []).join(', ') || 'none'}`,
        )
      : ['- none']),
    '',
    '## Sync Package Backups',
    `count: ${backups.length}`,
    ...(backups.length
      ? backups
          .slice(0, 8)
          .map(
            (backup) =>
              `- ${backup.id} | status=${backup.status} | backup=${input.formatters.formatTime(backup.backupCreatedAt)} | package=${input.formatters.formatTime(backup.packageCreatedAt)} | resources=${backup.readyResourceCount}/${backup.resourceCount} | bytes=${backup.copiedBytes} | path=${backup.backupPath}`,
          )
      : ['- no sync package backups']),
    '',
    '## Sync Package Preflight',
    `status: ${preflight?.status ?? 'not checked'}`,
    `readyToApply: ${preflight?.readyToApply ? 'yes' : 'no'}`,
    `checkedAt: ${input.formatters.formatTime(preflight?.checkedAt)}`,
    `unsafePaths: ${(preflight?.unsafePaths ?? []).join(', ') || 'none'}`,
    ...((preflight?.checks ?? []).length
      ? (preflight?.checks ?? []).map((check) => `- ${check.status}: ${check.label} | ${check.detail}`)
      : ['- no preflight checks have been run']),
    '',
    '## Local Error Buffer',
    `count: ${input.localErrors.length}`,
    ...(input.localErrors.length
      ? input.localErrors
          .slice(0, 12)
          .map(
            (event) =>
              `- ${new Date(event.occurredAt).toISOString()} | ${redactSensitiveText(event.area)}/${redactSensitiveText(event.action)} | ${redactSensitiveText(event.message)}${event.detail ? ` | detail=${redactSensitiveText(event.detail)}` : ''}`,
          )
      : ['- no local errors captured']),
    '',
    '## MCP Skills Resource Lens',
    `resources: ${resourceLensSummary.total}`,
    `ready: ${resourceLensSummary.ready}`,
    `issues: ${resourceLensSummary.issues}`,
    `inventoryItems: ${resourceLensSummary.inventory}`,
    ...(resourceLens.length
      ? resourceLens.map(
          (resource) =>
            `- ${resource.label} | id=${resource.id || 'legacy'} | status=${resource.status ?? 'unknown'} | apply=${resource.applyMode || 'unknown'} | inventory=${resource.inventory?.length ? resource.inventory.join(', ') : 'none'}`,
        )
      : ['- no MCP/Skills focused resources']),
    '',
    '## Clone Health',
    `total: ${input.instances.length}`,
    `running: ${health.running}`,
    `checked: ${health.checked}`,
    `mismatch: ${health.mismatch}`,
    `warnings: ${health.warnings}`,
    ...instanceLines,
    '',
    '## Session Usage Cost Lens',
    ...(Object.entries(usageByInstance).length
      ? Object.entries(usageByInstance).flatMap(([instanceId, usage]) => {
          const cost = sessionUsageCostSummary(usage, { unpriced: input.labels.sessionCostUnpriced });
          return [
            `- ${instanceId} | estimated=${input.formatters.formatUsd(cost.totalCostUsd)} | pricedModels=${cost.pricedModels} | unpricedModels=${cost.unpricedModels} | billableInput=${cost.billableInputTokens} | cachedInput=${cost.cachedInputTokens} | output=${cost.outputTokens} | cacheHitRate=${Math.round(cost.cacheHitRate * 100)}%`,
            ...cost.byModel.slice(0, 8).map(
              (model) =>
                `  model=${model.model} | cost=${model.priced ? input.formatters.formatUsd(model.totalCostUsd) : 'unpriced'} | pricing=${model.pricingLabel} | input=${model.billableInputTokens} | cache=${model.cachedInputTokens} | output=${model.outputTokens}`,
            ),
          ];
        })
      : ['- no scanned session usage']),
    '',
    ...gitWorktreeDiagnosticsLines({
      form: input.gitWorktreeForm,
      defaults: input.gitWorktreeDefaults,
      result: input.gitWorktreeResult,
    }),
    '',
    '## Provider Presets',
    `presets: ${providerPresetCatalog.length}`,
    `builtin: ${providerPresetCatalog.length - customProviderPresets.length}`,
    `custom: ${customProviderPresets.length}`,
    `tags: ${providerPresetTags.size ? Array.from(providerPresetTags).sort().join(', ') : 'none'}`,
    '',
    '## Provider Config Audit',
    `normalizedBaseUrl: ${providerConfigAudit?.normalizedBaseUrl || 'empty'}`,
    `blocking: ${providerConfigAudit?.blockingCount ?? 0}`,
    `warnings: ${providerConfigAudit?.warningCount ?? 0}`,
    `duplicatePresetCount: ${providerConfigAudit?.duplicatePresetCount ?? 0}`,
    `similarPresetCount: ${providerConfigAudit?.similarPresetCount ?? 0}`,
    ...(providerConfigAudit?.checks?.length
      ? providerConfigAudit.checks.map((check) => `- [${check.status}] ${check.label}: ${check.detail}`)
      : ['- no audit checks']),
    '',
    '## Provider Models',
    `status: ${input.providerModelsResult?.status ?? 'not fetched'}`,
    `endpoint: ${input.providerModelsResult?.endpoint ?? 'unknown'}`,
    `httpStatus: ${input.providerModelsResult?.httpStatus ?? 'unknown'}`,
    `latencyMs: ${input.providerModelsResult?.latencyMs ?? 'unknown'}`,
    `modelCount: ${input.providerModelsResult?.modelCount ?? 0}`,
    `cloneModelCatalog: ${input.modelCatalogEnabled ? 'enabled' : 'disabled'}`,
    `cloneModelCatalogCount: ${input.modelCatalogModels?.length ?? 0}`,
    `clonePromptPack: ${input.promptPackEnabled ? 'enabled' : 'disabled'}`,
    `clonePromptPackChars: ${input.promptPackChars ?? 0}`,
    `message: ${input.providerModelsResult?.message ?? 'none'}`,
    ...(input.providerModelsResult?.models?.length
      ? input.providerModelsResult.models.slice(0, 40).map((model) => `- ${model}`)
      : ['- no fetched models']),
    '',
    '## Provider Health History',
    ...(providerHealthHistory.length
      ? providerHealthHistory
          .slice(0, 12)
          .map(
            (record) =>
              `- ${new Date(record.testedAt).toISOString()} | ${record.providerName} | ${record.normalizedBaseUrl} | ${record.model} | ok=${record.ok ? 'yes' : 'no'} | status=${record.status} | http=${record.httpStatus ?? 'unknown'} | latency=${record.latencyMs}ms`,
          )
      : ['- no provider health history']),
    '',
    '## Latest Log Tail',
    latestLog,
    '',
    '## Startup Log Tail',
    startupLog,
  ].join('\n');
}
