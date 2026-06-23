import { Copy } from 'lucide-react';
import type { CodexSessionSummary, CodexSessionUsageSummary } from '../../shared/types';
import { sessionUsageCostSummary } from './sessionUsage';

export type SessionPanelLabels = {
  recentTitle: string;
  countUnit: string;
  messageUnit: string;
  noTimestamp: string;
  unknownProjectDir: string;
  noMatches: string;
  morePrefix: string;
  moreSuffix: string;
  usageTitle: string;
  usageTokensUnit: string;
  usageEventsUnit: string;
  usageInput: string;
  usageCache: string;
  usageOutputLabel: string;
  usageFiles: string;
  usageRangeUnknown: string;
  usageRangeSeparator: string;
  usageModelInput: string;
  usageModelCache: string;
  usageModelOutput: string;
  usageEmpty: string;
  costTitle: string;
  costUnpriced: string;
  costBillableInput: string;
  costCacheRate: string;
  costOutput: string;
  costEstimate: string;
  costDisclaimer: string;
};

export function SessionSummaryList(props: {
  query: string;
  sessions: CodexSessionSummary[];
  labels: SessionPanelLabels;
  formatShortPath: (value?: string | null) => string;
  onCopyProjectDir?: (projectDir: string) => Promise<void> | void;
}) {
  const query = props.query.trim().toLowerCase();
  const matched = query
    ? props.sessions.filter((session) =>
        [
          session.title,
          session.sessionId,
          session.summary ?? '',
          session.projectDir ?? '',
          session.searchPreview ?? '',
          session.rolloutPath,
        ].some((value) => value.toLowerCase().includes(query)),
      )
    : props.sessions;
  const visible = matched.slice(0, 5);
  return (
    <div className="session-summary-list">
      <div className="session-summary-title">
        <strong>{props.labels.recentTitle}</strong>
        <span>
          {query ? `${matched.length}/${props.sessions.length}` : `${props.sessions.length} ${props.labels.countUnit}`}
        </span>
      </div>
      {visible.map((session) => {
        const projectDir = session.projectDir?.trim() ?? '';
        return (
          <div className={session.rolloutExists ? 'session-summary-item' : 'session-summary-item missing'} key={session.sessionId}>
            <div className="session-summary-main">
              <strong title={session.title}>{session.title}</strong>
              <span>
                {session.messageCount} {props.labels.messageUnit}
              </span>
              <small>{session.lastMessageAt ?? props.labels.noTimestamp}</small>
            </div>
            {session.summary ? <p title={session.summary}>{session.summary}</p> : null}
            <div className="session-summary-meta">
              <code title={session.rolloutPath}>{props.formatShortPath(session.rolloutPath)}</code>
              {projectDir ? (
                <button onClick={() => void props.onCopyProjectDir?.(projectDir)} title={projectDir} type="button">
                  <Copy size={12} />
                  {props.formatShortPath(projectDir)}
                </button>
              ) : (
                <small>{props.labels.unknownProjectDir}</small>
              )}
            </div>
          </div>
        );
      })}
      {!visible.length ? <small className="session-summary-more">{props.labels.noMatches}</small> : null}
      {matched.length > visible.length ? (
        <small className="session-summary-more">
          {props.labels.morePrefix}
          {matched.length - visible.length}
          {props.labels.moreSuffix}
        </small>
      ) : null}
    </div>
  );
}

export function SessionUsageSummaryPanel(props: {
  usage: CodexSessionUsageSummary;
  labels: SessionPanelLabels;
  formatTokenCount: (value?: number | null) => string;
  formatUsd: (value?: number | null) => string;
}) {
  const models = props.usage.byModel.slice(0, 5);
  const cost = sessionUsageCostSummary(props.usage, { unpriced: props.labels.costUnpriced });
  const modelCostByName = new Map(cost.byModel.map((item) => [item.model, item]));
  return (
    <div className="session-usage-panel">
      <div className="session-usage-title">
        <strong>{props.labels.usageTitle}</strong>
        <span>
          {props.formatTokenCount(props.usage.totalTokens)} {props.labels.usageTokensUnit} / {props.usage.eventCount}{' '}
          {props.labels.usageEventsUnit}
        </span>
      </div>
      <div className="session-usage-stats">
        <span>
          {props.labels.usageInput} {props.formatTokenCount(props.usage.inputTokens)}
        </span>
        <span>
          {props.labels.usageCache} {props.formatTokenCount(props.usage.cachedInputTokens)}
        </span>
        <span>
          {props.labels.usageOutputLabel} {props.formatTokenCount(props.usage.outputTokens)}
        </span>
        <span>
          {props.labels.usageFiles} {props.usage.parsedFiles}/{props.usage.scannedFiles}
        </span>
      </div>
      <div className="session-cost-lens">
        <div className="session-cost-title">
          <strong>{props.labels.costTitle}</strong>
          <span>{cost.pricedModels ? props.formatUsd(cost.totalCostUsd) : props.labels.costUnpriced}</span>
        </div>
        <div className="session-cost-stats">
          <span>
            {props.labels.costBillableInput} {props.formatTokenCount(cost.billableInputTokens)}
          </span>
          <span>
            {props.labels.costCacheRate} {Math.round(cost.cacheHitRate * 100)}%
          </span>
          <span>
            {props.labels.costOutput} {props.formatTokenCount(cost.outputTokens)}
          </span>
          <span>
            {props.labels.costEstimate} {cost.pricedModels}/{cost.pricedModels + cost.unpricedModels}
          </span>
        </div>
        <small>{props.labels.costDisclaimer}</small>
      </div>
      {props.usage.firstEventAt || props.usage.lastEventAt ? (
        <small className="session-usage-range">
          {props.usage.firstEventAt ?? props.labels.usageRangeUnknown} {props.labels.usageRangeSeparator}{' '}
          {props.usage.lastEventAt ?? props.labels.usageRangeUnknown}
        </small>
      ) : null}
      {models.length ? (
        <div className="session-usage-models">
          {models.map((model) => (
            <div className="session-usage-model" key={model.model}>
              <strong>{model.model}</strong>
              <span>{props.formatTokenCount(model.totalTokens)}</span>
              <em>
                {modelCostByName.get(model.model)?.priced
                  ? props.formatUsd(modelCostByName.get(model.model)?.totalCostUsd)
                  : props.labels.costUnpriced}
              </em>
              <small>
                {props.labels.usageModelInput} {props.formatTokenCount(model.inputTokens)} / {props.labels.usageModelCache}{' '}
                {props.formatTokenCount(model.cachedInputTokens)} / {props.labels.usageModelOutput}{' '}
                {props.formatTokenCount(model.outputTokens)}
              </small>
            </div>
          ))}
        </div>
      ) : (
        <small className="session-summary-more">{props.labels.usageEmpty}</small>
      )}
      {props.usage.warnings.length ? <small className="session-usage-warning">{props.usage.warnings[0]}</small> : null}
    </div>
  );
}
