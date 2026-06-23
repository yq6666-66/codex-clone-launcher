import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

export type InstanceListSectionLabels = {
  searchPlaceholder: string;
  refresh: string;
};

export function InstanceListSection(props: {
  title: string;
  subtitle: string;
  sessionSearchQuery?: string;
  labels: InstanceListSectionLabels;
  children: ReactNode;
  onRefresh: () => Promise<void>;
  onSessionSearchQueryChange?: (value: string) => void;
}) {
  return (
    <div className="instance-list-section">
      <div className="section-header">
        <div>
          <h2>{props.title}</h2>
          <p>{props.subtitle}</p>
        </div>
        <div className="instance-list-tools">
          {props.onSessionSearchQueryChange ? (
            <input
              name="codex-session-search"
              onChange={(event) => props.onSessionSearchQueryChange?.(event.currentTarget.value)}
              placeholder={props.labels.searchPlaceholder}
              type="search"
              value={props.sessionSearchQuery ?? ''}
            />
          ) : null}
          <button onClick={() => void props.onRefresh()} type="button">
            <RefreshCw size={16} />
            {props.labels.refresh}
          </button>
        </div>
      </div>
      {props.children}
    </div>
  );
}
