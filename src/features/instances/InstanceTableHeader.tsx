export type InstanceTableHeaderLabels = {
  instance: string;
  profileDir: string;
  status: string;
  history: string;
  lastLaunch: string;
  actions: string;
};

export function InstanceTableHeader(props: {
  labels: InstanceTableHeaderLabels;
  showHistory: boolean;
}) {
  return (
    <div className="table-head">
      <span>{props.labels.instance}</span>
      <span>{props.labels.profileDir}</span>
      <span>{props.labels.status}</span>
      {props.showHistory ? <span>{props.labels.history}</span> : null}
      <span>{props.labels.lastLaunch}</span>
      <span>{props.labels.actions}</span>
    </div>
  );
}
