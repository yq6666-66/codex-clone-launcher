import { CircleAlert, ShieldCheck } from 'lucide-react';
import type { CloneReadinessSummary } from '../../shared/types';

export function CloneReadinessPanel(props: { readiness: CloneReadinessSummary }) {
  const visibleChecks = props.readiness.checks
    .filter((check) => check.status !== 'ok' || props.readiness.tone === 'ok')
    .slice(0, 5);
  const Icon = props.readiness.tone === 'blocked' || props.readiness.tone === 'warning' ? CircleAlert : ShieldCheck;
  return (
    <div className={`clone-readiness ${props.readiness.tone}`} title={props.readiness.detail}>
      <div className="clone-readiness-title">
        <Icon size={14} />
        <strong>{props.readiness.label}</strong>
        <span>{props.readiness.detail}</span>
      </div>
      <div className="clone-readiness-checks">
        {visibleChecks.map((check) => (
          <small className={check.status} key={check.id} title={check.detail}>
            {check.label}: {check.detail}
          </small>
        ))}
      </div>
    </div>
  );
}
