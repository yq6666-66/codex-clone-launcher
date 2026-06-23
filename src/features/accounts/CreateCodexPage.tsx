import { BookOpen, Database, Loader2, Play, Rocket, Target } from 'lucide-react';
import type {
  CloneFormValues,
  CodexAccount,
  CodexProviderConnectionTestResult,
  CodexProviderModelsFetchResult,
} from '../../shared/types';
import { AccountFlowPanel, type AccountFlowLabels } from './AccountFlowPanel';
import {
  ProviderConfigAuditPanel,
  ProviderModelsPanel,
  ProviderTestPanel,
  type ProviderConfigAudit,
  type ProviderFeedbackLabels,
} from './ProviderFeedbackPanels';

export type CreateCodexPageLabels = AccountFlowLabels & {
  codexHeroTitle: string;
  codexHeroLead: string;
  advancedOptions: string;
  workdir: string;
  launchScript: string;
  launchScriptHint: string;
  modelCatalog: string;
  modelCatalogHint: string;
  providerModelsCountUnit: string;
  modelCatalogStandby: string;
  modelCatalogEmpty: string;
  goalPursuit: string;
  goalPursuitHint: string;
  goalPursuitPlaceholder: string;
  promptPack: string;
  promptPackHint: string;
  promptPackPlaceholder: string;
  launchAfterCreate: string;
  inheritCodex: string;
  createAndLaunchCodex: string;
  createOnlyCodex: string;
  inheritTitle: string;
  inheritChat: string;
  inheritSkills: string;
  inheritMcp: string;
  inheritGoals: string;
  inheritPlugins: string;
  inheritNote: string;
};

type CreateCodexPageProps = {
  labels: CreateCodexPageLabels;
  form: CloneFormValues;
  busy: string;
  showOfficialPanel: boolean;
  canCompleteOfficialLogin: boolean;
  officialAccountId: string;
  officialAccountOptions: CodexAccount[];
  providerModelsResult: CodexProviderModelsFetchResult | null;
  providerConfigAudit: ProviderConfigAudit;
  providerTestResult: CodexProviderConnectionTestResult | null;
  providerFeedbackLabels: ProviderFeedbackLabels;
  modelCatalogModels: string[];
  advancedOptionsDefaultOpen: boolean;
  onToggleOfficialPanel: () => void;
  onOpenCloneSnapshotImport: () => void;
  onFormChange: (patch: Partial<CloneFormValues>) => void;
  onFetchProviderModels: () => void;
  onTestProviderConnection: () => void;
  onStartOfficialLogin: () => void;
  onCompleteOfficialLogin: () => void;
  onOfficialAccountChange: (accountId: string) => void;
  onCreateOfficialClone: () => void;
  onCreateApiKeyClone: () => void;
};

export function CreateCodexPage(props: CreateCodexPageProps) {
  const { form, labels } = props;

  return (
    <main className="create-grid">
      <section className="hero-card">
        <div className="hero-badge">
          <Rocket size={16} />
          CODEX CLONE
        </div>
        <h2>{labels.codexHeroTitle}</h2>
        <p>{labels.codexHeroLead}</p>

        <AccountFlowPanel
          form={form}
          busy={props.busy}
          showOfficialPanel={props.showOfficialPanel}
          canCompleteOfficialLogin={props.canCompleteOfficialLogin}
          officialAccountId={props.officialAccountId}
          officialAccountOptions={props.officialAccountOptions}
          labels={labels}
          providerModelsPanel={
            props.providerModelsResult ? (
              <ProviderModelsPanel
                currentModel={form.model}
                labels={props.providerFeedbackLabels}
                result={props.providerModelsResult}
                onSelect={(model) => props.onFormChange({ model })}
              />
            ) : null
          }
          providerConfigAuditPanel={
            <ProviderConfigAuditPanel audit={props.providerConfigAudit} labels={props.providerFeedbackLabels} />
          }
          providerTestPanel={
            props.providerTestResult ? (
              <ProviderTestPanel labels={props.providerFeedbackLabels} result={props.providerTestResult} />
            ) : null
          }
          onToggleOfficialPanel={props.onToggleOfficialPanel}
          onOpenCloneSnapshotImport={props.onOpenCloneSnapshotImport}
          onFormChange={props.onFormChange}
          onFetchProviderModels={props.onFetchProviderModels}
          onTestProviderConnection={props.onTestProviderConnection}
          onStartOfficialLogin={props.onStartOfficialLogin}
          onCompleteOfficialLogin={props.onCompleteOfficialLogin}
          onOfficialAccountChange={props.onOfficialAccountChange}
          onCreateOfficialClone={props.onCreateOfficialClone}
        >
          <details className="advanced-options wide" open={props.advancedOptionsDefaultOpen ? true : undefined}>
            <summary>{labels.advancedOptions}</summary>
            <div className="advanced-options-grid">
              <label>
                <span>{labels.workdir}</span>
                <input
                  name="clone-working-dir"
                  value={form.workingDir}
                  onChange={(event) => props.onFormChange({ workingDir: event.target.value })}
                  placeholder="C:\\path\\to\\workspace"
                />
              </label>
              <label>
                <span>{labels.launchScript}</span>
                <textarea
                  name="clone-launch-script"
                  value={form.launchScript}
                  onChange={(event) => props.onFormChange({ launchScript: event.target.value })}
                  placeholder={'// Optional clone-owned startup script\nwindow.__CODEX_CLONE_PROFILE__ = true;'}
                  rows={5}
                />
                <small>{labels.launchScriptHint}</small>
              </label>
              <div className={`model-catalog-option ${form.modelCatalogEnabled ? 'enabled' : ''}`}>
                <label className="model-catalog-toggle">
                  <input
                    name="clone-model-catalog-enabled"
                    type="checkbox"
                    checked={form.modelCatalogEnabled}
                    onChange={(event) => props.onFormChange({ modelCatalogEnabled: event.target.checked })}
                  />
                  <span>
                    <Database size={16} />
                    {labels.modelCatalog}
                  </span>
                </label>
                <small>{labels.modelCatalogHint}</small>
                <code>
                  {props.modelCatalogModels.length
                    ? `${props.modelCatalogModels.length} ${labels.providerModelsCountUnit} -> ${
                        form.modelCatalogEnabled ? 'model-catalog.json' : labels.modelCatalogStandby
                      }`
                    : labels.modelCatalogEmpty}
                </code>
              </div>
              <div className={`goal-pursuit-panel ${form.goalEnabled ? 'enabled' : ''}`}>
                <label className="goal-pursuit-toggle">
                  <input
                    name="clone-goal-enabled"
                    type="checkbox"
                    checked={form.goalEnabled}
                    onChange={(event) => props.onFormChange({ goalEnabled: event.target.checked })}
                  />
                  <span>
                    <Target size={16} />
                    {labels.goalPursuit}
                  </span>
                </label>
                <small>{labels.goalPursuitHint}</small>
                {form.goalEnabled ? (
                  <textarea
                    name="clone-goal-text"
                    value={form.goalText}
                    onChange={(event) => props.onFormChange({ goalText: event.target.value })}
                    placeholder={labels.goalPursuitPlaceholder}
                    rows={4}
                  />
                ) : null}
              </div>
              <div className={`prompt-pack-panel ${form.promptPackEnabled ? 'enabled' : ''}`}>
                <label className="prompt-pack-toggle">
                  <input
                    name="clone-prompt-pack-enabled"
                    type="checkbox"
                    checked={form.promptPackEnabled}
                    onChange={(event) => props.onFormChange({ promptPackEnabled: event.target.checked })}
                  />
                  <span>
                    <BookOpen size={16} />
                    {labels.promptPack}
                  </span>
                </label>
                <small>{labels.promptPackHint}</small>
                {form.promptPackEnabled ? (
                  <textarea
                    name="clone-prompt-pack-text"
                    value={form.promptPackText}
                    onChange={(event) => props.onFormChange({ promptPackText: event.target.value })}
                    placeholder={labels.promptPackPlaceholder}
                    rows={7}
                  />
                ) : null}
              </div>
              <div className="checks advanced-checks">
                <label>
                  <input
                    name="clone-launch-after-create"
                    type="checkbox"
                    checked={form.launchAfterCreate}
                    onChange={(event) => props.onFormChange({ launchAfterCreate: event.target.checked })}
                  />
                  {labels.launchAfterCreate}
                </label>
              </div>
            </div>
          </details>
        </AccountFlowPanel>

        <div className="checks">
          <label>
            <input
              name="clone-inherit-local-data"
              type="checkbox"
              checked={form.inheritLocalData}
              onChange={(event) => props.onFormChange({ inheritLocalData: event.target.checked })}
            />
            {labels.inheritCodex}
          </label>
        </div>

        <button className="primary-action" onClick={props.onCreateApiKeyClone} type="button" disabled={Boolean(props.busy)}>
          {props.busy === 'create-codex' ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
          {form.launchAfterCreate ? labels.createAndLaunchCodex : labels.createOnlyCodex}
        </button>
      </section>

      <aside className="info-card">
        <h3>{labels.inheritTitle}</h3>
        <ul>
          <li>{labels.inheritChat}</li>
          <li>{labels.inheritSkills}</li>
          <li>{labels.inheritMcp}</li>
          <li>{labels.inheritGoals}</li>
          <li>{labels.inheritPlugins}</li>
        </ul>
        <p>{labels.inheritNote}</p>
      </aside>
    </main>
  );
}
