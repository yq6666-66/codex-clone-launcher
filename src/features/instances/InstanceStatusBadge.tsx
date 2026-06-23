import type { InstanceProfile } from '../../shared/types';

export function InstanceStatusBadge(props: {
  instance: InstanceProfile;
  labels: { running: string; stopped: string };
}) {
  return (
    <span className={props.instance.running ? 'status running' : 'status'}>
      {props.instance.running ? props.labels.running : props.labels.stopped}
    </span>
  );
}
