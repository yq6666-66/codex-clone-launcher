import { BookOpen } from 'lucide-react';
import type { CodexSyncPackageStatus } from '../../shared/types';

export type OperationGuideLabels = {
  guide: string;
  guideLead: string;
  syncPackageTitle: string;
  syncPackageStale: string;
  syncPackageReady: string;
  guidePackageMissing: string;
  guidePackageNotGenerated: string;
  cloneTotalCount: string;
  guideManagedCloneOnly: string;
  guidePackageSize: string;
  guideFilesUnit: string;
  guideDirsUnit: string;
  guideQuickStart: string;
  guideSafety: string;
  guideTroubleshooting: string;
  quickStartSteps: string[];
  safetyRules: string[];
  troubleshootingItems: string[];
};

type OperationGuideProps = {
  labels: OperationGuideLabels;
  syncPackage: CodexSyncPackageStatus | null;
  cloneCount: number;
  formatBytes: (bytes: number) => string;
};

export function OperationGuide(props: OperationGuideProps) {
  const packageReady = Boolean(props.syncPackage?.exists);
  const labels = props.labels;
  const packageState = packageReady
    ? props.syncPackage?.stale
      ? labels.syncPackageStale
      : labels.syncPackageReady
    : labels.guidePackageMissing;

  return (
    <section className="guide-page">
      <div className="section-header">
        <div>
          <h2>{labels.guide}</h2>
          <p>{labels.guideLead}</p>
        </div>
        <BookOpen size={28} />
      </div>

      <div className="guide-status">
        <div>
          <span>{labels.syncPackageTitle}</span>
          <strong>{packageState}</strong>
          <code>{props.syncPackage?.packagePath || labels.guidePackageNotGenerated}</code>
        </div>
        <div>
          <span>{labels.cloneTotalCount}</span>
          <strong>{props.cloneCount}</strong>
          <small>{labels.guideManagedCloneOnly}</small>
        </div>
        <div>
          <span>{labels.guidePackageSize}</span>
          <strong>{props.formatBytes(props.syncPackage?.copiedBytes ?? 0)}</strong>
          <small>
            {(props.syncPackage?.fileCount ?? 0).toLocaleString()} {labels.guideFilesUnit} /{' '}
            {(props.syncPackage?.directoryCount ?? 0).toLocaleString()} {labels.guideDirsUnit}
          </small>
        </div>
      </div>

      <div className="guide-grid">
        <GuidePanel title={labels.guideQuickStart} items={labels.quickStartSteps} ordered />
        <GuidePanel title={labels.guideSafety} items={labels.safetyRules} />
        <GuidePanel title={labels.guideTroubleshooting} items={labels.troubleshootingItems} />
      </div>
    </section>
  );
}

function GuidePanel(props: {
  title: string;
  items: string[];
  ordered?: boolean;
}) {
  const ListTag = props.ordered ? 'ol' : 'ul';
  return (
    <section className="guide-panel">
      <h3>{props.title}</h3>
      <ListTag>
        {props.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ListTag>
    </section>
  );
}
