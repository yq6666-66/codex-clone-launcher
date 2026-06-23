import type { CodexHistoryStatus, InstanceProfile } from '../../shared/types';

export function cloneHealthStats(
  instances: InstanceProfile[],
  historyByInstance: Record<string, CodexHistoryStatus>,
) {
  const running = instances.filter((instance) => instance.running).length;
  const checked = instances.filter((instance) => historyByInstance[instance.id] ?? instance.historyStatus).length;
  const mismatch = instances.reduce((total, instance) => {
    const history = historyByInstance[instance.id] ?? instance.historyStatus;
    return total + (history?.mismatchCount ?? 0);
  }, 0);
  const warnings = instances.reduce((total, instance) => {
    const history = historyByInstance[instance.id] ?? instance.historyStatus;
    return total + (history?.warnings?.length ?? 0) + (history && !history.authOk ? 1 : 0);
  }, 0);
  return { running, checked, mismatch, warnings };
}

export function visibleInstances(instances: InstanceProfile[]): InstanceProfile[] {
  return instances.filter((instance) => !instance.isDefault);
}
