import { Copy, FolderOpen, GitBranch, Loader2, RefreshCw, Rocket, Settings } from 'lucide-react';
import { DiagnosticsPanel, type DiagnosticsPanelLabels } from '../diagnostics/DiagnosticsPanel';
import { UpdatePanel, type UpdatePanelLabels, type UpdatePanelStatus } from '../updater/UpdatePanel';
import type {
  CodexSyncPackagePreflightReport,
  CodexSyncPackageStatus,
  DiagnosticsSnapshot,
  GitWorktreeCreateResult,
  GitWorktreeDefaults,
  GitWorktreeFormValues,
} from '../../shared/types';
import type { LocalErrorEvent } from '../../telemetry';

type SettingsPageLabels = {
  settings: string;
  settingsLead: string;
  save: string;
  codexPath: string;
  pick: string;
  autoDetect: string;
  pathPlaceholder: string;
  refreshing: string;
  worktreeTitle: string;
  worktreeLead: string;
  worktreeRepoDir: string;
  worktreeBaseRemote: string;
  worktreeBaseBranch: string;
  worktreeNewBranch: string;
  worktreeDir: string;
  worktreeFetch: string;
  worktreeDetect: string;
  worktreeCreate: string;
  worktreeUseInCreate: string;
  worktreeCopyDiagnostics: string;
  update: UpdatePanelLabels;
  diagnostics: DiagnosticsPanelLabels;
};

type SettingsPageProps = {
  busy: string;
  appVersion: string;
  codexAppPath: string;
  gitWorktreeForm: GitWorktreeFormValues;
  gitWorktreeDefaults: GitWorktreeDefaults | null;
  gitWorktreeResult: GitWorktreeCreateResult | null;
  updateStatus: UpdatePanelStatus;
  hasAvailableUpdate: boolean;
  latestUpdateVersion?: string;
  autoCheckUpdates: boolean;
  skippedUpdateVersion: string;
  updaterOwnerRepo: string;
  updaterEndpoint: string;
  syncPackage: CodexSyncPackageStatus | null;
  syncPackagePreflight: CodexSyncPackagePreflightReport | null;
  diagnostics: DiagnosticsSnapshot | null;
  diagnosticsReport: string;
  localErrors: LocalErrorEvent[];
  packageState: string;
  diagnosticsSummary: string;
  labels: SettingsPageLabels;
  onSaveSettings: () => void;
  onCodexPathChange: (value: string) => void;
  onPickCodexPath: () => void;
  onDetectCodexPath: () => void;
  onGitWorktreeChange: (patch: Partial<GitWorktreeFormValues>) => void;
  onPickGitWorktreeRepo: () => void;
  onPickGitWorktreeTarget: () => void;
  onDetectGitWorktree: () => void;
  onCreateGitWorktree: () => void;
  onUseGitWorktreeResult: () => void;
  onCopyGitWorktreeDiagnostics: () => void;
  onAutoCheckUpdatesChange: (enabled: boolean) => void;
  onCheckUpdate: () => void;
  onInstallUpdate: () => void;
  onSkipUpdate: () => void;
  onClearSkippedUpdate: () => void;
  onOpenReleases: () => void;
  onRefreshDiagnostics: () => unknown;
  onCopyDiagnosticsReport: () => unknown;
  onOpenLogDir: () => unknown;
  onOpenSyncPackage: () => unknown;
};

export function SettingsPage(props: SettingsPageProps) {
  const labels = props.labels;

  return (
    <section className="settings-page">
      <div className="section-header">
        <div>
          <h2>{labels.settings}</h2>
          <p>{labels.settingsLead}</p>
        </div>
        <button onClick={props.onSaveSettings} type="button" disabled={Boolean(props.busy)}>
          <Settings size={16} />
          {labels.save}
        </button>
      </div>
      <PathRow
        title={labels.codexPath}
        value={props.codexAppPath}
        labels={{
          pick: labels.pick,
          autoDetect: labels.autoDetect,
          pathPlaceholder: labels.pathPlaceholder,
        }}
        onChange={props.onCodexPathChange}
        onPick={props.onPickCodexPath}
        onDetect={props.onDetectCodexPath}
      />
      <GitWorktreePanel
        form={props.gitWorktreeForm}
        defaults={props.gitWorktreeDefaults}
        result={props.gitWorktreeResult}
        busy={props.busy}
        labels={labels}
        onChange={props.onGitWorktreeChange}
        onPickRepo={props.onPickGitWorktreeRepo}
        onPickTarget={props.onPickGitWorktreeTarget}
        onDetect={props.onDetectGitWorktree}
        onCreate={props.onCreateGitWorktree}
        onUseResult={props.onUseGitWorktreeResult}
        onCopyDiagnostics={props.onCopyGitWorktreeDiagnostics}
      />
      <UpdatePanel
        appVersion={props.appVersion}
        busy={props.busy}
        status={props.updateStatus}
        hasUpdate={props.hasAvailableUpdate}
        autoCheck={props.autoCheckUpdates}
        skippedVersion={props.skippedUpdateVersion}
        ownerRepo={props.updaterOwnerRepo}
        endpoint={props.updaterEndpoint}
        labels={labels.update}
        onAutoCheckChange={props.onAutoCheckUpdatesChange}
        onCheck={props.onCheckUpdate}
        onInstall={props.onInstallUpdate}
        onSkip={props.onSkipUpdate}
        onClearSkip={props.onClearSkippedUpdate}
        onOpenReleases={props.onOpenReleases}
      />
      <DiagnosticsPanel
        syncPackage={props.syncPackage}
        syncPackagePreflight={props.syncPackagePreflight}
        updater={{
          message: props.updateStatus.message,
          version: props.updateStatus.version ?? props.latestUpdateVersion,
          checkedAt: props.updateStatus.checkedAt,
          diagnostic: props.updateStatus.diagnostic,
          hasUpdate: props.hasAvailableUpdate,
          ownerRepo: props.updaterOwnerRepo,
          endpoint: props.updaterEndpoint,
        }}
        localErrors={props.localErrors}
        diagnostics={props.diagnostics}
        codexAppPath={props.codexAppPath}
        appVersion={props.appVersion}
        diagnosticsReport={props.diagnosticsReport}
        busy={props.busy}
        packageState={props.packageState}
        summary={props.diagnosticsSummary}
        labels={labels.diagnostics}
        onRefreshDiagnostics={props.onRefreshDiagnostics}
        onCopyDiagnosticsReport={props.onCopyDiagnosticsReport}
        onOpenLogDir={props.onOpenLogDir}
        onOpenSyncPackage={props.onOpenSyncPackage}
      />
    </section>
  );
}

function GitWorktreePanel(props: {
  form: GitWorktreeFormValues;
  defaults: GitWorktreeDefaults | null;
  result: GitWorktreeCreateResult | null;
  busy: string;
  labels: SettingsPageLabels;
  onChange: (patch: Partial<GitWorktreeFormValues>) => void;
  onPickRepo: () => void;
  onPickTarget: () => void;
  onDetect: () => void;
  onCreate: () => void;
  onUseResult: () => void;
  onCopyDiagnostics: () => void;
}) {
  const labels = props.labels;
  const detecting = props.busy === 'git-worktree-detect';
  const creating = props.busy === 'git-worktree-create';
  const warnings = [
    ...(props.defaults?.warnings ?? []),
    ...(props.result?.warnings ?? []),
  ];

  return (
    <section className="worktree-panel">
      <div className="worktree-title-row">
        <div>
          <span>{labels.worktreeTitle}</span>
          <p>{labels.worktreeLead}</p>
        </div>
        <div className="worktree-title-actions">
          <button disabled={Boolean(props.busy)} onClick={props.onCopyDiagnostics} type="button">
            <Copy size={16} />
            {labels.worktreeCopyDiagnostics}
          </button>
          <GitBranch size={22} />
        </div>
      </div>

      <div className="worktree-form-grid">
        <label className="wide">
          <span>{labels.worktreeRepoDir}</span>
          <input
            value={props.form.repoDir}
            onChange={(event) => props.onChange({ repoDir: event.currentTarget.value })}
            placeholder="C:\\path\\to\\repo"
          />
        </label>
        <button disabled={Boolean(props.busy)} onClick={props.onPickRepo} type="button">
          <FolderOpen size={16} />
          {labels.pick}
        </button>
        <button disabled={Boolean(props.busy)} onClick={props.onDetect} type="button">
          {detecting ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
          {detecting ? labels.refreshing : labels.worktreeDetect}
        </button>

        <label>
          <span>{labels.worktreeBaseRemote}</span>
          <input
            value={props.form.baseRemote}
            onChange={(event) => props.onChange({ baseRemote: event.currentTarget.value })}
            placeholder="upstream"
          />
        </label>
        <label>
          <span>{labels.worktreeBaseBranch}</span>
          <input
            value={props.form.baseBranch}
            onChange={(event) => props.onChange({ baseBranch: event.currentTarget.value })}
            placeholder="main"
          />
        </label>
        <label className="wide">
          <span>{labels.worktreeNewBranch}</span>
          <input
            value={props.form.newBranch}
            onChange={(event) => props.onChange({ newBranch: event.currentTarget.value })}
            placeholder="feature/codex-clone-work"
          />
        </label>

        <label className="wide">
          <span>{labels.worktreeDir}</span>
          <input
            value={props.form.worktreeDir}
            onChange={(event) => props.onChange({ worktreeDir: event.currentTarget.value })}
            placeholder="C:\\path\\to\\repo-feature"
          />
        </label>
        <button disabled={Boolean(props.busy)} onClick={props.onPickTarget} type="button">
          <FolderOpen size={16} />
          {labels.pick}
        </button>
        <button disabled={Boolean(props.busy)} onClick={props.onCreate} type="button">
          {creating ? <Loader2 className="spin" size={16} /> : <GitBranch size={16} />}
          {labels.worktreeCreate}
        </button>
      </div>

      <label className="worktree-toggle">
        <input
          checked={props.form.fetchBeforeCreate}
          onChange={(event) => props.onChange({ fetchBeforeCreate: event.currentTarget.checked })}
          type="checkbox"
        />
        <span>{labels.worktreeFetch}</span>
      </label>

      {props.defaults ? (
        <div className="worktree-status">
          <div>
            <span>当前分支</span>
            <strong>{props.defaults.currentBranch || 'DETACHED'}</strong>
          </div>
          <div>
            <span>远端基线</span>
            <strong>{props.defaults.baseRef}</strong>
          </div>
          <div>
            <span>可用远端</span>
            <strong>{(props.defaults.remotes ?? []).length ? (props.defaults.remotes ?? []).join(', ') : 'none'}</strong>
          </div>
          <div>
            <span>本地改动</span>
            <strong>{props.defaults.dirty ? '有未提交改动' : '干净'}</strong>
          </div>
        </div>
      ) : null}

      {props.result ? (
        <div className="worktree-result">
          <div>
            <strong>{props.result.newBranch}</strong>
            <span>{props.result.baseRef}</span>
            <code>{props.result.worktreeDir}</code>
          </div>
          <button disabled={Boolean(props.busy)} onClick={props.onUseResult} type="button">
            <Rocket size={16} />
            {labels.worktreeUseInCreate}
          </button>
        </div>
      ) : null}

      {warnings.length ? (
        <div className="worktree-warnings">
          {warnings.slice(0, 3).map((warning) => (
            <small key={warning}>{warning}</small>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PathRow(props: {
  title: string;
  value: string;
  labels: {
    pick: string;
    autoDetect: string;
    pathPlaceholder: string;
  };
  onChange: (value: string) => void;
  onPick: () => void;
  onDetect: () => void;
}) {
  return (
    <div className="path-row">
      <label>
        <span>{props.title}</span>
        <input
          name="codex-launch-path"
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          placeholder={props.labels.pathPlaceholder}
        />
      </label>
      <button onClick={props.onPick} type="button">
        <FolderOpen size={16} />
        {props.labels.pick}
      </button>
      <button onClick={props.onDetect} type="button">
        <RefreshCw size={16} />
        {props.labels.autoDetect}
      </button>
    </div>
  );
}
