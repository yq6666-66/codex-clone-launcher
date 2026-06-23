import type { ReactNode } from 'react';
import { Activity, Import, KeyRound, Loader2, Search } from 'lucide-react';
import { accountLabel } from './accountUtils';
import type { CloneFormValues, CodexAccount } from '../../shared/types';

export type AccountFlowLabels = {
  thirdPartyApi: string;
  collapseOfficial: string;
  officialEntry: string;
  cloneSnapshotImport: string;
  cloneName: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  providerModelsHint: string;
  providerTestHint: string;
  providerModelsFetch: string;
  providerTest: string;
  officialTitle: string;
  officialLead: string;
  openOfficialLogin: string;
  completeLogin: string;
  chooseOfficial: string;
  useOfficial: string;
};

type AccountFlowPanelProps = {
  form: CloneFormValues;
  busy: string;
  showOfficialPanel: boolean;
  canCompleteOfficialLogin: boolean;
  officialAccountId: string;
  officialAccountOptions: CodexAccount[];
  labels: AccountFlowLabels;
  providerModelsPanel?: ReactNode;
  providerConfigAuditPanel?: ReactNode;
  providerTestPanel?: ReactNode;
  children?: ReactNode;
  onToggleOfficialPanel: () => void;
  onOpenCloneSnapshotImport: () => void;
  onFormChange: (patch: Partial<CloneFormValues>) => void;
  onFetchProviderModels: () => void;
  onTestProviderConnection: () => void;
  onStartOfficialLogin: () => void;
  onCompleteOfficialLogin: () => void;
  onOfficialAccountChange: (accountId: string) => void;
  onCreateOfficialClone: () => void;
};

export function AccountFlowPanel(props: AccountFlowPanelProps) {
  const labels = props.labels;

  return (
    <>
      <div className="api-strip">
        <div>
          <KeyRound size={16} />
          {labels.thirdPartyApi}
        </div>
        <button
          className={props.showOfficialPanel ? 'active' : ''}
          onClick={props.onToggleOfficialPanel}
          type="button"
        >
          {props.showOfficialPanel ? labels.collapseOfficial : labels.officialEntry}
        </button>
        <button onClick={props.onOpenCloneSnapshotImport} type="button">
          <Import size={16} />
          {labels.cloneSnapshotImport}
        </button>
      </div>

      <div className="form-grid">
        <label>
          <span>{labels.cloneName}</span>
          <input
            name="clone-name"
            value={props.form.name}
            onChange={(event) => props.onFormChange({ name: event.target.value })}
          />
        </label>
        <label>
          <span>{labels.model}</span>
          <input
            name="clone-model"
            value={props.form.model}
            onChange={(event) => props.onFormChange({ model: event.target.value })}
          />
        </label>
        <label className="wide">
          <span>{labels.baseUrl}</span>
          <input
            autoFocus
            name="clone-base-url"
            value={props.form.baseUrl}
            onChange={(event) => props.onFormChange({ baseUrl: event.target.value })}
            placeholder="https://api.example.com/v1"
          />
        </label>
        <label className="wide">
          <span>{labels.apiKey}</span>
          <input
            name="clone-api-key"
            value={props.form.apiKey}
            onChange={(event) => props.onFormChange({ apiKey: event.target.value })}
            placeholder="sk-..."
            type="password"
          />
        </label>
        <div className="provider-test-actions wide">
          <small>
            {labels.providerModelsHint}
            <br />
            {labels.providerTestHint}
          </small>
          <div className="provider-action-buttons">
            <button disabled={Boolean(props.busy)} onClick={props.onFetchProviderModels} type="button">
              {props.busy === 'provider-model-fetch' ? <Loader2 className="spin" size={16} /> : <Search size={16} />}
              {labels.providerModelsFetch}
            </button>
            <button disabled={Boolean(props.busy)} onClick={props.onTestProviderConnection} type="button">
              {props.busy === 'provider-connection-test' ? <Loader2 className="spin" size={16} /> : <Activity size={16} />}
              {labels.providerTest}
            </button>
          </div>
        </div>

        {props.providerModelsPanel}
        {props.providerConfigAuditPanel}
        {props.providerTestPanel}

        {props.showOfficialPanel ? (
          <div className="official-panel wide">
            <div>
              <strong>{labels.officialTitle}</strong>
              <p>{labels.officialLead}</p>
            </div>
            <div className="official-actions">
              <button onClick={props.onStartOfficialLogin} type="button" disabled={Boolean(props.busy)}>
                {labels.openOfficialLogin}
              </button>
              <button onClick={props.onCompleteOfficialLogin} type="button" disabled={Boolean(props.busy) || !props.canCompleteOfficialLogin}>
                {labels.completeLogin}
              </button>
            </div>
            <select
              name="official-account-id"
              value={props.officialAccountId}
              onChange={(event) => props.onOfficialAccountChange(event.target.value)}
            >
              <option value="">{labels.chooseOfficial}</option>
              {props.officialAccountOptions.map((account) => (
                <option key={account.id} value={account.id}>
                  {accountLabel(account)}
                </option>
              ))}
            </select>
            <button
              className="secondary-action"
              onClick={props.onCreateOfficialClone}
              type="button"
              disabled={Boolean(props.busy)}
            >
              {labels.useOfficial}
            </button>
          </div>
        ) : null}

        {props.children}
      </div>
    </>
  );
}
