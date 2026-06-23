import type { InstanceProfile } from '../../shared/types';

export type InstanceCapabilityBadgeLabels = {
  launchScriptConfigured: string;
  modelCatalog: string;
  goalPursuitConfigured: string;
  promptPackConfigured: string;
};

export function InstanceCapabilityBadges(props: {
  instance: InstanceProfile;
  labels: InstanceCapabilityBadgeLabels;
}) {
  const { instance, labels } = props;
  return (
    <>
      {instance.launchScript?.trim() ? <small className="launch-script-badge">{labels.launchScriptConfigured}</small> : null}
      {instance.modelCatalogEnabled ? (
        <small className="model-catalog-badge" title={instance.modelCatalogPath ?? undefined}>
          {labels.modelCatalog} · {instance.modelCatalogCount ?? 0}
        </small>
      ) : null}
      {instance.goalEnabled ? (
        <small className="goal-pursuit-badge" title={instance.goalPath ?? undefined}>
          {labels.goalPursuitConfigured}
        </small>
      ) : null}
      {instance.promptPackEnabled ? (
        <small className="prompt-pack-badge" title={instance.promptPackPath ?? undefined}>
          {labels.promptPackConfigured}
        </small>
      ) : null}
    </>
  );
}
