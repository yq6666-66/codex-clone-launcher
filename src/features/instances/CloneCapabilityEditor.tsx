import { CheckCircle2, Loader2, Target } from 'lucide-react';
import type { CloneCapabilityEditDraft, InstanceProfile } from '../../shared/types';

export type CloneCapabilityEditorLabels = {
  cancel: string;
  lead: string;
  placeholder: string;
  save: string;
  title: string;
  goalPursuit: string;
};

export function CloneCapabilityEditor(props: {
  busy: string;
  draft: CloneCapabilityEditDraft;
  formatShortPath: (value?: string | null) => string;
  instance: InstanceProfile;
  labels: CloneCapabilityEditorLabels;
  onCancel?: (id: string) => void;
  onDraftChange?: (id: string, patch: Partial<CloneCapabilityEditDraft>) => void;
  onSave?: (id: string) => Promise<void>;
}) {
  const isSaving = props.busy === `codex-clone-capabilities-${props.instance.id}`;
  return (
    <div className={`clone-capability-editor ${props.draft.goalEnabled ? 'enabled' : ''}`}>
      <div className="clone-capability-title">
        <strong>{props.labels.title}</strong>
        <span>{props.formatShortPath(props.instance.goalPath)}</span>
      </div>
      <label className="goal-pursuit-toggle">
        <span>
          <Target size={15} />
          {props.labels.goalPursuit}
        </span>
        <input
          checked={props.draft.goalEnabled}
          name={`clone-goal-enabled-${props.instance.id}`}
          onChange={(event) =>
            props.onDraftChange?.(props.instance.id, {
              goalEnabled: event.currentTarget.checked,
            })
          }
          type="checkbox"
        />
      </label>
      <small>{props.labels.lead}</small>
      {props.draft.goalEnabled ? (
        <textarea
          name={`clone-goal-text-${props.instance.id}`}
          onChange={(event) =>
            props.onDraftChange?.(props.instance.id, {
              goalText: event.currentTarget.value,
            })
          }
          placeholder={props.labels.placeholder}
          value={props.draft.goalText}
        />
      ) : null}
      <div className="clone-capability-actions">
        <button disabled={Boolean(props.busy)} onClick={() => void props.onSave?.(props.instance.id)} type="button">
          {isSaving ? <Loader2 className="spin" size={14} /> : <CheckCircle2 size={14} />}
          {props.labels.save}
        </button>
        <button disabled={Boolean(props.busy)} onClick={() => props.onCancel?.(props.instance.id)} type="button">
          {props.labels.cancel}
        </button>
      </div>
    </div>
  );
}
