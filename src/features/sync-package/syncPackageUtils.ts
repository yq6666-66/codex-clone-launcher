import type { CodexSyncPackageStatus } from '../../shared/types';
import type { SyncPackageResourceItem } from './SyncPackageResources';

type FormatBytes = (bytes: number) => string;

export function legacySyncPackageResourceItems(status: CodexSyncPackageStatus | null): SyncPackageResourceItem[] {
  const copied = status?.exists
    ? `${(status.fileCount ?? 0).toLocaleString()} 文件 / ${(status.directoryCount ?? 0).toLocaleString()} 目录`
    : '尚未提取';
  const skippedCount = status?.skipped?.length ?? 0;
  return [
    { label: '聊天历史', value: copied, detail: 'sessions、archived_sessions、session_index、history.jsonl' },
    { label: '技能规则', value: status?.exists ? '已纳入' : '待提取', detail: 'skills、rules、AGENTS.md' },
    { label: 'MCP 与记忆', value: status?.exists ? '已纳入' : '待提取', detail: 'mcp-servers、memories、sqlite、vendor_imports' },
    {
      label: '排除项',
      value: skippedCount ? `${skippedCount} 项` : '固定排除',
      detail: 'auth、credentials、plugins、cache、log、tmp、额度配置',
    },
  ];
}

export function syncPackageResourceStatusLabel(status?: string): string {
  switch (status) {
    case 'ready':
      return '已纳入';
    case 'partial':
      return '部分纳入';
    case 'error':
      return '有错误';
    case 'missing':
      return '未纳入';
    default:
      return '待提取';
  }
}

export function syncPackageResourceItems(
  status: CodexSyncPackageStatus | null,
  formatBytes: FormatBytes,
): SyncPackageResourceItem[] {
  if (!status?.resources?.length) return legacySyncPackageResourceItems(status);
  return status.resources.map((resource) => {
    const fileCount = (resource.fileCount ?? 0).toLocaleString();
    const directoryCount = (resource.directoryCount ?? 0).toLocaleString();
    const issueParts = [
      ...(resource.errors ?? []).slice(0, 2).map((item) => `错误：${item}`),
      resource.missing?.length ? `缺少：${resource.missing.slice(0, 4).join('、')}` : '',
    ].filter(Boolean);
    return {
      id: resource.id,
      label: resource.label,
      value:
        resource.status === 'missing'
          ? syncPackageResourceStatusLabel(resource.status)
          : `${syncPackageResourceStatusLabel(resource.status)} · ${fileCount} 文件 / ${directoryCount} 目录 · ${formatBytes(resource.bytes ?? 0)}`,
      detail: [resource.detail, ...issueParts].filter(Boolean).join('；'),
      status: resource.status,
      applyMode: resource.applyMode,
      inventory: resource.items ?? [],
    };
  });
}

export function syncPackageIncludedSummary(status: CodexSyncPackageStatus | null, formatBytes: FormatBytes): string {
  if (!status?.exists) return '待提取';
  const entryCount = status.entries?.length ?? 0;
  return `${entryCount.toLocaleString()} 条 manifest / ${formatBytes(status.copiedBytes ?? 0)}`;
}

export function syncPackageExcludedSummary(status: CodexSyncPackageStatus | null): string {
  const skippedCount = status?.skipped?.length ?? 0;
  return skippedCount ? `${skippedCount.toLocaleString()} 条 skipped` : 'auth、credentials、plugins、cache、log 固定排除';
}

export function syncPackageEntryLabel(
  entry: CodexSyncPackageStatus['entries'][number],
  formatBytes: FormatBytes,
): string {
  const size = entry.bytes ? formatBytes(entry.bytes) : entry.kind;
  const state = entry.status ? `${entry.status}` : 'copied';
  const files = entry.fileCount ?? (entry.kind === 'file' && entry.status === 'copied' ? 1 : 0);
  const directories = entry.directoryCount ?? (entry.kind === 'directory' && entry.status === 'copied' ? 1 : 0);
  const counts =
    entry.kind === 'directory'
      ? `${files.toLocaleString()} 文件 / ${directories.toLocaleString()} 目录`
      : files
        ? `${files.toLocaleString()} 文件`
        : entry.kind;
  return `${state} / ${size} / ${counts}`;
}

export function syncPackageEntryPreview(status: CodexSyncPackageStatus | null) {
  if (!status?.entries?.length) return [];
  const preferred = [
    'sessions',
    'archived_sessions',
    'session_index.jsonl',
    'history.jsonl',
    'skills',
    'mcp-servers',
    'memories',
    'AGENTS.md',
  ];
  const entries = [...status.entries];
  entries.sort((left, right) => {
    const leftRank = preferred.findIndex((item) => left.path === item || left.path.startsWith(`${item}/`));
    const rightRank = preferred.findIndex((item) => right.path === item || right.path.startsWith(`${item}/`));
    const normalizedLeft = leftRank === -1 ? preferred.length : leftRank;
    const normalizedRight = rightRank === -1 ? preferred.length : rightRank;
    if (normalizedLeft !== normalizedRight) return normalizedLeft - normalizedRight;
    return left.path.localeCompare(right.path);
  });
  return entries.slice(0, 8);
}
