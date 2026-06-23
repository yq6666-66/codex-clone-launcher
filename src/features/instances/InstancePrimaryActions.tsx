import { Loader2 } from 'lucide-react';
import type { InstanceProfile } from '../../shared/types';

export type InstancePrimaryActionLabels = {
  start: string;
  starting: string;
  stop: string;
  stopping: string;
  historyRepair: string;
  repairing: string;
  delete: string;
  deleting: string;
};

export function InstancePrimaryActions(props: {
  busy: string;
  instance: InstanceProfile;
  labels: InstancePrimaryActionLabels;
  syncBlockedReason?: string | null;
  onStart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onHistoryRepair?: (id: string) => Promise<void>;
}) {
  const isStarting = props.busy === `codex-start-${props.instance.id}`;
  const isStopping = props.busy === `codex-stop-${props.instance.id}`;
  const isRepairing = props.busy === `codex-history-repair-${props.instance.id}`;
  const isDeleting = props.busy === `codex-delete-${props.instance.id}`;

  return (
    <>
      {props.instance.running ? (
        <button disabled={Boolean(props.busy)} onClick={() => void props.onStop(props.instance.id)} type="button">
          {isStopping ? <Loader2 className="spin" size={15} /> : null}
          {isStopping ? props.labels.stopping : props.labels.stop}
        </button>
      ) : (
        <button disabled={Boolean(props.busy)} onClick={() => void props.onStart(props.instance.id)} type="button">
          {isStarting ? <Loader2 className="spin" size={15} /> : null}
          {isStarting ? props.labels.starting : props.labels.start}
        </button>
      )}
      {props.onHistoryRepair ? (
        <button
          disabled={Boolean(props.busy) || Boolean(props.syncBlockedReason)}
          onClick={() => void props.onHistoryRepair?.(props.instance.id)}
          title={props.syncBlockedReason ?? undefined}
          type="button"
        >
          {isRepairing ? <Loader2 className="spin" size={15} /> : null}
          {isRepairing ? props.labels.repairing : props.labels.historyRepair}
        </button>
      ) : null}
      <button className="danger" disabled={Boolean(props.busy)} onClick={() => void props.onDelete(props.instance.id)} type="button">
        {isDeleting ? <Loader2 className="spin" size={15} /> : null}
        {isDeleting ? props.labels.deleting : props.labels.delete}
      </button>
    </>
  );
}
