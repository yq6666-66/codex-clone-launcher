import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { openPath, openUrl } from '@tauri-apps/plugin-opener';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';
import {
  Activity,
  BookOpen,
  CheckCircle2,
  CircleAlert,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Gauge,
  GitBranch,
  Moon,
  Import,
  KeyRound,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  Rocket,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Target,
  Monitor,
  Wrench,
} from 'lucide-react';
import './App.css';
import { reportError } from './telemetry';
import { updaterConfig } from './generated/updater';
import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER_ID,
  DEFAULT_PROVIDER_NAME,
  providerPresets,
  type ProviderPreset,
} from './providerCatalog';

type Page = 'dashboard' | 'codexCreate' | 'codexList' | 'settings' | 'guide';
type AuthType = 'apiKey' | 'officialAccount';
type ThemeMode = 'system' | 'dark' | 'light';

type CodexAccount = {
  id: string;
  email: string;
  auth_mode?: string | null;
  openai_api_key?: string | null;
  account_name?: string | null;
};

type OAuthStartResponse = {
  loginId?: string;
  authUrl?: string;
  login_id?: string;
  auth_url?: string;
};

type InstanceProfile = {
  id: string;
  name: string;
  userDataDir: string;
  workingDir?: string | null;
  launchScript?: string | null;
  modelCatalogEnabled?: boolean;
  modelCatalogPath?: string | null;
  modelCatalogCount?: number;
  goalEnabled?: boolean;
  goal?: string | null;
  goalPath?: string | null;
  promptPackEnabled?: boolean;
  promptPack?: string | null;
  promptPackPath?: string | null;
  running: boolean;
  isDefault?: boolean;
  lastPid?: number | null;
  lastLaunchedAt?: number | null;
  historyStatus?: CodexHistoryStatus | null;
};

type CodexHistoryStatus = {
  codexHome?: string;
  ok: boolean;
  currentProvider: string;
  currentModel?: string | null;
  threadCount: number;
  sessionFileCount: number;
  sessionIndexCount: number;
  mismatchCount: number;
  missingSessionFiles: number;
  authOk: boolean;
  boundAccountId?: string | null;
  authMode?: string | null;
  providerBaseUrlHost?: string | null;
  syncMode?: string | null;
  lastSyncAt?: number | null;
  lastBackupPath?: string | null;
  syncPackageApplied?: CodexSyncPackageAppliedMarker | null;
  warnings: string[];
};

type CodexHistorySyncResult = {
  ok: boolean;
  dryRun: boolean;
  threadCount: number;
  mismatchCountBefore: number;
  mismatchCountAfter: number;
  updatedThreads: number;
  updatedRolloutPaths: number;
  updatedSessionFiles: number;
  rewrittenIndexEntries: number;
  syncedThreads: number;
  backupRetentionDeleted: number;
  lockWaitMs: number;
  stderrWarnings: string[];
  authMode?: string | null;
  providerBaseUrlHost?: string | null;
  syncMode?: string | null;
  backupPath?: string | null;
  warnings: string[];
};

type CodexSessionExportResult = {
  sessionId: string;
  title: string;
  exportedPath: string;
  messageCount: number;
};

type ZedOpenResult = {
  target: string;
  mode: string;
  zedPath: string;
};

type CodexProviderConnectionTestResult = {
  ok: boolean;
  codexReady: boolean;
  status: string;
  protocol: string;
  endpoint: string;
  httpStatus?: number | null;
  latencyMs: number;
  ttfbMs?: number | null;
  message: string;
  responsePreview?: string | null;
};

type CodexProviderModelsFetchResult = {
  ok: boolean;
  status: string;
  endpoint: string;
  httpStatus?: number | null;
  latencyMs: number;
  modelCount: number;
  models: string[];
  message: string;
  responsePreview?: string | null;
};

type GitWorktreeDefaults = {
  repoDir: string;
  currentBranch: string;
  remotes: string[];
  baseRemote: string;
  baseBranch: string;
  baseRef: string;
  suggestedBranch: string;
  suggestedWorktreeDir: string;
  dirty: boolean;
  warnings: string[];
};

type GitWorktreeCreateResult = {
  repoDir: string;
  baseRef: string;
  newBranch: string;
  worktreeDir: string;
  fetched: boolean;
  output: string;
  warnings: string[];
};

type CodexSessionSummary = {
  sessionId: string;
  title: string;
  rolloutPath: string;
  projectDir?: string | null;
  summary?: string | null;
  searchPreview?: string | null;
  messageCount: number;
  lastMessageAt?: string | null;
  rolloutExists: boolean;
};

type CodexSessionUsageModelSummary = {
  model: string;
  eventCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type CodexSessionUsageSummary = {
  codexHome: string;
  scannedFiles: number;
  parsedFiles: number;
  eventCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  firstEventAt?: string | null;
  lastEventAt?: string | null;
  byModel: CodexSessionUsageModelSummary[];
  warnings: string[];
};

type SessionUsagePricingRule = {
  pattern: RegExp;
  label: string;
  source: string;
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

type SessionUsageCostEstimate = {
  model: string;
  priced: boolean;
  pricingLabel: string;
  pricingSource: string;
  billableInputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputCostUsd: number;
  cachedInputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
};

type SessionUsageCostSummary = {
  totalCostUsd: number;
  pricedModels: number;
  unpricedModels: number;
  billableInputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  cacheHitRate: number;
  byModel: SessionUsageCostEstimate[];
};

type CodexSyncPackageResourceSummary = {
  id: string;
  label: string;
  status: string;
  applyMode: string;
  fileCount: number;
  directoryCount: number;
  bytes: number;
  paths: string[];
  missing: string[];
  errors: string[];
  items?: string[];
  detail: string;
};

type CodexSyncPackageAppliedMarker = {
  version: number;
  appliedAt: number;
  packagePath: string;
  manifestPath: string;
  packageCreatedAt?: number | null;
  source?: string | null;
  staleWhenApplied: boolean;
  fileCount: number;
  directoryCount: number;
  copiedBytes: number;
  resources: CodexSyncPackageResourceSummary[];
  warnings: string[];
};

type CodexSyncPackageStatus = {
  exists: boolean;
  packagePath: string;
  manifestPath: string;
  source?: string | null;
  createdAt?: number | null;
  sourceModifiedAt?: number | null;
  stale: boolean;
  fileCount: number;
  directoryCount: number;
  copiedBytes: number;
  entries: Array<{
    path: string;
    kind: string;
    status: string;
    bytes: number;
    fileCount?: number;
    directoryCount?: number;
    sha256?: string | null;
    error?: string | null;
  }>;
  resources?: CodexSyncPackageResourceSummary[];
  skipped: string[];
  warnings: string[];
};

type CodexSyncPackageBackupSummary = {
  id: string;
  backupPath: string;
  packagePath: string;
  manifestPath: string;
  backupCreatedAt?: number | null;
  packageCreatedAt?: number | null;
  source?: string | null;
  fileCount: number;
  directoryCount: number;
  copiedBytes: number;
  resourceCount: number;
  readyResourceCount: number;
  status: string;
  warnings: string[];
  error?: string | null;
};

type CodexSyncPackagePreflightCheck = {
  id: string;
  label: string;
  status: string;
  detail: string;
  action?: string | null;
};

type CodexSyncPackagePreflightReport = {
  checkedAt: number;
  status: string;
  readyToApply: boolean;
  packagePath: string;
  manifestPath: string;
  packageCreatedAt?: number | null;
  source?: string | null;
  stale: boolean;
  entriesChecked: number;
  resourcesChecked: number;
  errorCount: number;
  warningCount: number;
  unsafePaths: string[];
  checks: CodexSyncPackagePreflightCheck[];
};

type GeneralConfig = {
  codex_app_path: string;
};

type DiagnosticsSnapshot = {
  logDir: string;
  latestLogFile?: string | null;
  latestLogTail: string;
  logFiles: Array<{
    name: string;
    path: string;
    bytes: number;
    modifiedAt?: number | null;
  }>;
  codexAppPath: string;
  codexAppPathExists: boolean;
  launcherPid: number;
};

type Message = {
  tone: 'success' | 'error';
  text: string;
};

const APPLIED_SYNC_PACKAGE_MARKER_FILE = 'clone-sync-package-applied.json';

type AvailableUpdate = Awaited<ReturnType<typeof check>>;

type UpdateStatus = {
  message: string;
  version?: string;
  notes?: string;
  downloaded?: number;
  total?: number;
  checkedAt?: number;
  diagnostic?: string;
};

type CloneFormValues = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  modelCatalogEnabled: boolean;
  providerId: string;
  providerName: string;
  workingDir: string;
  launchScript: string;
  goalEnabled: boolean;
  goalText: string;
  promptPackEnabled: boolean;
  promptPackText: string;
  inheritLocalData: boolean;
  launchAfterCreate: boolean;
};

type CloneCapabilityEditDraft = {
  goalEnabled: boolean;
  goalText: string;
  promptPackEnabled: boolean;
  promptPackText: string;
};

type GitWorktreeFormValues = {
  repoDir: string;
  baseRemote: string;
  baseBranch: string;
  newBranch: string;
  worktreeDir: string;
  fetchBeforeCreate: boolean;
};

type CloneCapabilitySnapshot = {
  version: number;
  app: string;
  exportedAt: number;
  source: {
    instanceId: string;
    instanceName: string;
    codexHome: string;
    workingDir?: string | null;
  };
  provider: {
    authType: string;
    baseUrl?: string | null;
    providerId?: string | null;
    providerName?: string | null;
    model?: string | null;
  };
  capabilities: {
    modelCatalogEnabled: boolean;
    modelCatalogModels: string[];
    goalEnabled: boolean;
    goal?: string | null;
    promptPackEnabled: boolean;
    promptPack?: string | null;
    launchScriptPresent: boolean;
  };
  boundaries: string[];
  warnings: string[];
};

type CloneCapabilitySnapshotExportResult = {
  exportedPath: string;
  snapshot: CloneCapabilitySnapshot;
};

type CloneReadinessTone = 'ok' | 'warning' | 'blocked' | 'muted';

type CloneReadinessCheck = {
  id: string;
  status: CloneReadinessTone;
  label: string;
  detail: string;
};

type CloneReadinessSummary = {
  tone: CloneReadinessTone;
  label: string;
  detail: string;
  checks: CloneReadinessCheck[];
  blockingCount: number;
  warningCount: number;
};

type ProviderConfigAuditTone = 'ok' | 'warning' | 'blocked' | 'muted';

type ProviderConfigAuditCheck = {
  id: string;
  status: ProviderConfigAuditTone;
  label: string;
  detail: string;
};

type ProviderConfigAudit = {
  tone: ProviderConfigAuditTone;
  label: string;
  detail: string;
  normalizedBaseUrl: string;
  duplicatePresetCount: number;
  similarPresetCount: number;
  blockingCount: number;
  warningCount: number;
  checks: ProviderConfigAuditCheck[];
};

type ProviderHealthRecord = {
  id: string;
  providerId: string;
  providerName: string;
  baseUrl: string;
  normalizedBaseUrl: string;
  model: string;
  ok: boolean;
  codexReady: boolean;
  status: string;
  protocol: string;
  httpStatus?: number | null;
  latencyMs: number;
  ttfbMs?: number | null;
  message: string;
  testedAt: number;
};

const UPDATE_AUTO_CHECK_KEY = 'codex-clone-launcher:auto-update-check:v2';
const UPDATE_SKIPPED_VERSION_KEY = 'codex-clone-launcher:skipped-update-version';
const CUSTOM_PROVIDER_PRESETS_KEY = 'codex-clone-launcher:custom-provider-presets:v1';
const PROVIDER_HEALTH_HISTORY_KEY = 'codex-clone-launcher:provider-health-history:v1';
const THEME_MODE_KEY = 'codex-clone-launcher:theme-mode:v1';
const CLONE_MODEL_CATALOG_MAX_MODELS = 240;
const PROVIDER_HEALTH_HISTORY_LIMIT = 48;
const CLONE_CAPABILITY_SNAPSHOT_APP = 'codex-clone-launcher';
const sessionUsagePricingRules: SessionUsagePricingRule[] = [
  {
    pattern: /gpt-5\.5|gpt-5|codex/i,
    label: 'GPT/Codex family estimate',
    source: 'local reference',
    inputUsdPerMillion: 1.25,
    cachedInputUsdPerMillion: 0.125,
    outputUsdPerMillion: 10,
  },
  {
    pattern: /gpt-4\.1|gpt-4o/i,
    label: 'GPT-4 class estimate',
    source: 'local reference',
    inputUsdPerMillion: 2.5,
    cachedInputUsdPerMillion: 1.25,
    outputUsdPerMillion: 10,
  },
  {
    pattern: /\bo3\b|o3-|o1/i,
    label: 'reasoning model estimate',
    source: 'local reference',
    inputUsdPerMillion: 10,
    cachedInputUsdPerMillion: 2.5,
    outputUsdPerMillion: 40,
  },
  {
    pattern: /o4-mini|gpt-4\.1-mini|gpt-4o-mini/i,
    label: 'mini model estimate',
    source: 'local reference',
    inputUsdPerMillion: 0.6,
    cachedInputUsdPerMillion: 0.15,
    outputUsdPerMillion: 2.4,
  },
  {
    pattern: /deepseek|qwen|kimi|glm|moonshot|yi-|minimax|mimo/i,
    label: 'domestic gateway estimate',
    source: 'local reference',
    inputUsdPerMillion: 0.4,
    cachedInputUsdPerMillion: 0.1,
    outputUsdPerMillion: 1.6,
  },
  {
    pattern: /ollama|llama|local|localhost|127\.0\.0\.1/i,
    label: 'local model',
    source: 'local runtime',
    inputUsdPerMillion: 0,
    cachedInputUsdPerMillion: 0,
    outputUsdPerMillion: 0,
  },
];
const text = {
  appTitle: 'Codex 分身启动器',
  brand: 'AI Clone Launcher',
  dashboard: '控制台',
  dashboardLead: '只保留创建、列表、设置入口和分身健康总览；本体与分身仍然严格分离。',
  healthTitle: '分身健康',
  healthLead: '参考 Codex++ 诊断和 EchoBird 修复入口，先看状态，再执行同步/修复。',
  healthBulkRefresh: '批量刷新状态',
  healthBulkVerify: '批量校验分身',
  healthBulkRepair: '批量同步/修复',
  healthBulkDone: '批量健康操作完成',
  healthNoClones: '还没有可操作的 Codex 分身。',
  cloneReadinessReady: '可启动',
  cloneReadinessWarn: '需处理',
  cloneReadinessBlocked: '已阻止',
  cloneReadinessUnchecked: '未检查',
  cloneReadinessTitle: '启动前体检',
  healthChecked: '已检查',
  healthMismatchWarning: 'mismatch / warning',
  syncManifestTitle: '同步包清单',
  syncManifestLead: '参考 CC Switch 的统一资源视图，只展示稳定资源，运行态和账号配置保持排除。',
  resourceLensTitle: 'MCP / Skills 资源透视',
  resourceLensLead: '只读聚焦同步包里的 MCP、skills、rules、AGENTS、memories 和安全配置片段；不写本体、不写分身。',
  resourceLensReady: 'Ready',
  resourceLensIssues: 'Issues',
  resourceLensInventory: 'Inventory',
  resourceLensEmpty: '暂无可展示的 MCP/Skills 资源；先提取或刷新本体同步包。',
  resourceLensCopy: '复制资源透视',
  resourceLensCopied: '资源透视已复制',
  resourceLensCopyFailed: '资源透视复制失败',
  resourceDiff: 'Diff',
  syncManifestDetails: '同步包明细',
  syncManifestIncluded: '已纳入白名单',
  syncManifestExcluded: '固定排除项',
  syncManifestEntryPreview: 'Manifest 条目',
  syncManifestNoEntries: '尚无 manifest 条目；请先提取/刷新本体同步包。',
  syncManifestMoreEntries: '更多条目',
  quickActions: '快捷操作',
  moreActions: '更多操作',
  advancedOptions: '高级选项',
  syncPackageManage: '去列表处理',
  syncPackageDetails: '同步包详情',
  syncPackageBackups: '备份列表',
  copyResources: 'Copy resources',
  copyPreflight: 'Copy preflight',
  copyBackups: 'Copy backups',
  preflight: 'Preflight',
  preflightCheck: 'Check',
  copy: 'Copy',
  open: 'Open',
  diagnosticsTitle: '诊断中心',
  diagnosticsLead: '集中查看启动器日志、Codex 路径和进程信息；遇到未响应或同步卡顿时先看这里。',
  diagnosticsRefresh: '刷新诊断',
  diagnosticsLogs: '最近日志',
  diagnosticsNoLogs: '还没有可用日志',
  diagnosticsLogDir: '日志目录',
  diagnosticsPid: '启动器 PID',
  diagnosticsCodexPathOk: 'Codex 路径可用',
  diagnosticsCodexPathMissing: 'Codex 路径缺失或不可访问',
  diagnosticsOpenLogDir: '打开日志目录',
  diagnosticsOpenSyncPackage: '打开同步包目录',
  diagnosticsCopyReport: '复制诊断报告',
  diagnosticsReportCopied: '诊断报告已复制',
  diagnosticsReportCopyFailed: '诊断报告复制失败',
  diagnosticsReportPreview: '诊断报告预览',
  diagnosticsIssueSummary: '同步包提示',
  diagnosticsNoIssues: '暂无 warning/skipped',
  openPathFailed: '打开路径失败',
  providerHealthTitle: 'Provider 健康记录',
  providerHealthLead: '保存最近连接测试的非密摘要，用于给模型预设打健康徽章；不保存 API Key 或响应正文。',
  providerHealthEmpty: '暂无连接测试记录',
  providerHealthClear: '清空健康记录',
  providerHealthCleared: 'Provider 健康记录已清空',
  providerHealthCodexReady: 'Codex ready',
  providerHealthChatOnly: 'Chat only',
  providerHealthFailed: 'Failed',
  builtinPreset: '内置',
  customPreset: '自定义',
  openCreate: '去创建',
  openList: '去列表',
  openSettings: '去设置',
  cloneRunningCount: '运行中分身',
  cloneTotalCount: '分身总数',
  packageFreshness: '同步包状态',
  launcherVersion: '启动器版本',
  createCodex: '创建 Codex',
  codexList: 'Codex 列表',
  settings: '设置',
  guide: '操作说明',
  codexHeroTitle: '输入 Base URL 和 API Key，创建 Codex 分身',
  codexHeroLead:
    '分身保留独立 CODEX_HOME、auth 和额度配置；本体内容只通过“本体同步包”的提取和“同步/修复”手动应用。',
  thirdPartyApi: '第三方 API',
  baseUrl: 'Base URL',
  officialEntry: '官方账号入口',
  collapseOfficial: '收起官方账号入口',
  cloneName: '分身名称',
  model: '模型',
  modelCatalog: '写入分身 /model 模型目录',
  modelCatalogHint: '把当前模型和已拉取模型写入分身自己的 model-catalog.json，并在 config.toml 设置 model_catalog_json；不写本体。',
  modelCatalogEmpty: '暂无已拉取模型；开启后会至少写入当前模型。',
  apiKey: 'API Key',
  workdir: '工作目录（可留空）',
  launchScript: '启动脚本（可留空）',
  launchScriptHint: '只保存到分身 CODEX_HOME，并通过环境变量交给外部注入器；不会写入 Codex 安装目录。',
  launchScriptConfigured: '启动脚本已配置',
  goalPursuit: '追求目标',
  goalPursuitHint: '为这个分身写入专属目标文件，并在启动时通过分身 AGENTS.md 与环境变量携带；不写本体，不改本体 goals 数据库。',
  goalPursuitPlaceholder: '例如：持续完成 provider 融合、验证构建，并在遇到问题时优先自修复。',
  goalPursuitRequired: '已开启追求目标，请填写目标内容。',
  goalPursuitConfigured: '追求目标已配置',
  cloneCapabilityEdit: '编辑目标',
  cloneCapabilitySave: '保存目标',
  cloneCapabilityCancel: '取消',
  cloneCapabilitySaved: '分身目标已保存',
  cloneCapabilityTitle: '分身目标',
  cloneCapabilityLead: '更新已有分身的追求目标；关闭时只清理该分身 CODEX_HOME 内的 clone-goal.* 和 AGENTS 托管块。',
  promptPack: '分身提示词包',
  promptPackHint: '参考 CC Switch 的 prompts 管理，把常用工作模式写入分身 clone-prompts.md 和 AGENTS 托管块；只属于这个分身。',
  promptPackPlaceholder: '写入这个分身可复用的提示词、角色模式或检查清单。',
  promptPackRequired: '已开启分身提示词包，请填写提示词内容。',
  promptPackConfigured: '提示词包已配置',
  promptPackDefault:
    '## 代码审查\n\n- 先找行为回归、数据丢失、权限/凭据泄露和缺失测试。\n- 结论优先，文件和行号必须具体。\n\n## 排错\n\n- 先复现，再定位最小失败面，再修改验证。\n- 优先保留用户已有改动，不回滚无关文件。\n\n## 功能融合\n\n- 优先保留本体/分身边界；新能力必须可回退、可诊断。\n- 不复制 source auth、credentials、quota、plugins/cache/log 或运行临时态。',
  cloneSnapshotExport: '导出能力快照',
  cloneSnapshotExportTitle: '导出目标、提示词包、模型目录和 provider 非密字段；不导出 API Key、auth 或运行态',
  cloneSnapshotUse: '套用快照',
  cloneSnapshotUseTitle: '把分身能力快照套用到创建表单；API Key 仍需手动填写',
  cloneSnapshotImport: '导入能力快照',
  cloneSnapshotExported: '分身能力快照已导出',
  cloneSnapshotImported: '能力快照已套用到创建表单',
  cloneSnapshotImportFailed: '能力快照导入失败',
  inheritCodex: '创建时应用已提取的本体同步包（不刷新本体）',
  launchAfterCreate: '创建后立即启动',
  createAndLaunchCodex: '创建并启动 Codex 分身',
  createOnlyCodex: '创建 Codex 分身',
  officialTitle: '连接官方 OpenAI/Codex 账号',
  officialLead: '这是可选入口；Base URL + API Key 表单会一直保留。',
  openOfficialLogin: '打开官方登录',
  completeLogin: '完成登录',
  chooseOfficial: '选择官方账号',
  useOfficial: '使用所选官方账号创建分身',
  inheritTitle: '同步包内容',
  inheritChat: '聊天记录、sessions、session_index',
  inheritSkills: 'skills、rules、AGENTS.md',
  inheritMcp: 'MCP 配置和 mcp-servers',
  inheritGoals: 'goals_1.sqlite 可随同步包继承；新目标只写入分身 clone-goal.*',
  inheritPlugins: 'memories、sqlite、转录记录（不包含 plugins/cache/log 运行缓存）',
  inheritNote:
    '提取/刷新本体会先备份旧同步包再生成新包；启动分身不会刷新本体；同步/修复只应用已有同步包，不复制 auth.json、.credentials.json、plugins/cache/log 或覆盖额度配置。',
  noCodex: '还没有 Codex 分身，请先创建。',
  codexSubtitle: '只显示 Codex 分身，并提供记忆同步、校验和修复。',
  settingsLead: '只保留 Codex 启动路径。',
  worktreeTitle: '上游工作树',
  worktreeLead: '从 upstream/<base> 或可用远端基线创建新工作树，成功后自动填入分身工作目录。',
  worktreeRepoDir: 'Git 仓库目录',
  worktreeBaseRemote: '远端',
  worktreeBaseBranch: 'Base branch',
  worktreeNewBranch: '新分支',
  worktreeDir: '工作树目录',
  worktreeFetch: '创建前 fetch 远端基线',
  worktreeDetect: '检测仓库',
  worktreeCreate: '创建并填入工作目录',
  worktreeDetected: '已检测仓库',
  worktreeCreated: '工作树已创建',
  worktreeUseInCreate: '已填入创建表单',
  worktreeRequiredRepo: '请先选择或填写 Git 仓库目录',
  worktreeRequiredBranch: '请填写新分支和工作树目录',
  worktreeCopyDiagnostics: '复制工作树诊断',
  worktreeDiagnosticsCopied: '工作树诊断已复制',
  guideLead: '先创建分身；需要继承本体内容时，再提取同步包并对分身执行同步/修复。',
  guideQuickStart: '推荐流程',
  guideSafety: '边界规则',
  guideTroubleshooting: '常见处理',
  guidePackageMissing: '尚未提取',
  guidePackageNotGenerated: '还没有生成同步包',
  guideManagedCloneOnly: '只统计受管 Codex 分身',
  guidePackageSize: '包大小',
  guideFilesUnit: '文件',
  guideDirsUnit: '目录',
  themeLabel: '主题',
  themeSystem: '跟随系统',
  themeDark: '深色',
  themeLight: '浅色',
  themeUpdated: '主题已切换',
  updateTitle: '应用更新',
  updateLead: '通过 GitHub Releases 的 latest.json 检查新版本，发现更新后可下载、安装并重启。',
  currentVersion: '当前版本',
  updateRepository: '发布仓库',
  updateEndpoint: '更新源',
  updateUnknownVersion: '未知',
  updateLatestVersion: '最新版本',
  updateCheckedAt: '检查时间',
  autoCheckUpdates: '启动时自动检查更新',
  checkUpdate: '检查更新',
  checkAndInstallUpdate: '检查并安装',
  installUpdate: '下载并安装',
  skipThisVersion: '跳过此版本',
  resumeSkippedUpdate: '恢复提示',
  openReleases: '打开发布页',
  updateIdle: '未检查更新',
  updateChecking: '正在检查更新',
  updateNoUpdate: '当前已是最新版本',
  updateAvailable: '发现新版本',
  updateSkipped: '已跳过此版本',
  updateInstalling: '正在下载并安装更新',
  updateInstalled: '更新已安装，正在重启',
  updateInstalledRestartFailed: '更新已安装，请手动重启应用',
  updateCheckFailed: '检查更新失败',
  updateInstallFailed: '安装更新失败',
  updateLatestJsonMissing: 'GitHub Release 缺少 latest.json；请重新发布带 updater metadata 的版本。',
  updateSignatureHint: '更新签名或公钥校验失败；请确认 GitHub Secret 私钥和 tauri.conf.json 公钥匹配。',
  updateNetworkHint: '网络或代理访问 GitHub Releases 失败；可打开发布页手动下载。',
  updateDesktopOnlyHint: '当前页面不是 Tauri 桌面运行环境；请在桌面 APP 内检查更新。',
  save: '保存',
  codexPath: 'Codex 路径',
  pick: '选择',
  autoDetect: '自动识别',
  refresh: '刷新',
  instance: '分身',
  profileDir: 'Profile 目录',
  status: '状态',
  lastLaunch: '最近启动',
  actions: '操作',
  history: '记忆',
  historyCheck: '校验',
  historyRepair: '同步/修复',
  historyExportMarkdown: '导出 Markdown',
  historyExportMarkdownTitle: '只读导出最近 5 个分身会话',
  historyExportedMarkdown: 'Markdown 已导出',
  openZed: 'Zed',
  openZedDone: '已发送到 Zed',
  syncPackageTitle: '本体同步包',
  syncPackageMissing: '还未提取本体同步包，点击提取后会生成可手动同步到分身的安全白名单内容。',
  syncPackageRefresh: '提取/刷新本体',
  syncPackageReady: '同步包就绪',
  syncPackageStale: '本体已有更新',
  syncPackageStaleHint: '本体已有新变化；同步/修复仍会应用当前已提取的包，若要同步最新内容请先刷新本体。',
  syncPackageApplyUnknown: '同步包状态尚未加载，请先刷新状态或等待自动刷新完成。',
  syncPackageApplyMissing: '请先点击“提取/刷新本体”，生成本体同步包后再同步/修复。',
  syncPackageApplyStale: '将应用上一次已提取的本体同步包；如需最新内容，请先点击“提取/刷新本体”。',
  syncPackageApplyReady: '同步/修复只会把已提取的本体同步包应用到这个分身。',
  syncPackageExtracted: '本体同步包已刷新',
  syncPackageRestoreBackup: '恢复备份',
  syncPackageRestoredBackup: '同步包备份已恢复',
  syncPackageAppliedOpen: '打开记录',
  syncPackageAppliedCopy: '复制记录',
  syncPackageAppliedCopied: '同步包应用记录已复制',
  syncPackageAppliedMissing: '这个分身还没有同步包应用记录，请先执行“同步/修复”。',
  syncPackageCurrentApplied: '已应用当前同步包',
  syncPackageCurrentMissing: '未应用当前同步包',
  syncPackageCurrentUnknown: '当前同步包状态未知',
  historyRefresh: '刷新状态',
  running: '运行中',
  stopped: '未运行',
  sessionUsageRefresh: '统计用量',
  sessionListRefresh: '查看会话',
  sessionDetails: '会话列表',
  sessionUsageTitle: '会话用量',
  sessionUsageEmpty: '还没有可用 token 统计',
  sessionCostTitle: '成本透视',
  sessionCostEstimate: '估算成本',
  sessionCostUnpriced: '未匹配价格',
  sessionCostBillableInput: '计费输入',
  sessionCostCacheRate: '缓存命中',
  sessionCostOutput: '输出',
  sessionCostDisclaimer: '本地参考估算，不读取账单，不代表服务商最终收费。',
  sessionCopyProjectDir: '复制目录',
  sessionProjectDirCopied: '会话目录已复制',
  never: '未启动',
  start: '启动',
  stop: '停止',
  delete: '删除',
  requiredName: '请填写分身名称',
  requiredApi: '请填写 Base URL 和 API Key',
  requiredModel: '请填写模型',
  providerTest: '测试连接',
  providerTestHealthy: 'Provider 可用',
  providerTestDegraded: 'Provider 可用但较慢',
  providerTestChatOnly: '仅 Chat Completions 可用',
  providerTestFailed: 'Provider 测试失败',
  providerTestHint: '会发送一次低 token 请求；API Key 不会保存到模型预设或诊断报告。',
  providerModelsFetch: '拉取模型',
  providerModelsFetched: 'Provider 模型已拉取',
  providerModelsEmpty: '未识别到模型',
  providerModelsHint: '从 /models 只读拉取模型列表；API Key 只用于这次请求，不会保存。',
  providerAuditTitle: 'Provider 配置审计',
  providerAuditReady: '配置可用',
  providerAuditWarn: '建议确认',
  providerAuditBlocked: '缺少必填',
  providerAuditLead: '创建前本地检查 provider/base URL/API Key/模型/预设重复；不保存 API Key，不请求网络，不写本体。',
  requiredOfficial: '请先连接或选择官方账号',
  created: '已创建',
  createdLaunched: '已创建并启动',
  oauthOpened: '已打开官方登录页面，完成后回到 APP 点击“完成登录”。',
  noPendingLogin: '没有待完成的官方登录流程',
  officialConnected: '官方账号已连接',
  codexStarted: 'Codex 分身已启动',
  codexStopped: 'Codex 分身已停止',
  codexDeleted: 'Codex 分身已删除',
  pathDetected: '已识别路径',
  pathMissing: '未识别到路径',
  settingsSaved: '路径设置已保存',
  syncPackageStatusRefreshed: '同步包状态已刷新',
  busyWorking: '正在处理，请等待；Codex 系统弹窗出现时请选择应用，不要直接关闭。',
  busyExtracting: '正在提取本体同步包，旧包会先备份；数据较多时可能短暂卡顿。',
  busyRepairing: '正在应用同步包并修复分身历史；期间应用可能短暂卡顿。',
  busyBulkHealth: '正在批量处理分身健康；会顺序执行，避免多个写入任务互相覆盖。',
  busyStarting: '正在启动 Codex 分身；如果窗口显示未响应，请先等待。',
  busyOpeningZed: '正在调用 Zed 打开工作目录；如果 Zed 未响应，请检查 zed CLI 是否可用。',
  busyWorktree: '正在处理 Git 工作树；创建前会先检查目录、分支和远端基线。',
  starting: '启动中',
  stopping: '停止中',
  refreshing: '刷新中',
  verifying: '校验中',
  repairing: '同步中',
  deleting: '删除中',
  pathPlaceholder: '留空则自动探测',
  providerModelsCountUnit: '个模型',
  providerModelsHiddenPrefix: '还有 ',
  providerModelsHiddenSuffix: ' 个 provider 返回模型未显示',
  providerModelsFetching: '正在从 provider /models 拉取模型列表...',
  providerLatencyLabel: '延迟',
  providerTtfbLabel: 'TTFB',
  providerTesting: '正在测试 provider endpoint、模型和 API Key...',
  providerNeedsRelay: 'Needs relay/proxy',
  sessionRecentTitle: '最近会话',
  sessionReadSuccessPrefix: '已读取 ',
  sessionReadSuccessSuffix: ' 个分身会话',
  sessionSearchPlaceholder: '搜索已读取会话',
  sessionCountUnit: '条',
  sessionMessageUnit: '条消息',
  sessionNoTimestamp: '无时间戳',
  sessionUnknownProjectDir: '未知项目目录',
  sessionNoMatches: '没有匹配的已读取会话',
  sessionMorePrefix: '还有 ',
  sessionMoreSuffix: ' 条',
  sessionIndexLabel: 'index',
  sessionFilesLabel: 'files',
  sessionUsageTokensUnit: 'tokens',
  sessionUsageEventsUnit: 'events',
  sessionUsageInput: '输入',
  sessionUsageCache: '缓存',
  sessionUsageOutputLabel: '输出',
  sessionUsageFiles: '文件',
  sessionUsageRangeUnknown: '?',
  sessionUsageRangeSeparator: '->',
  sessionUsageModelInput: '输入',
  sessionUsageModelCache: '缓存',
  sessionUsageModelOutput: '输出',
  modelCatalogStandby: '待写入',
} as const;

const guideQuickStartSteps = [
  '到“设置”确认 Codex 路径；不确定时点“自动识别”。',
  '到“创建 Codex”填写 Base URL、API Key、分身名称和模型，然后创建。',
  '需要继承本体内容时，到“Codex 列表”先“提取/刷新本体”，再对分身点“同步/修复”。',
  '同步后点“校验”或“刷新状态”，确认无异常再启动分身。',
];

const guideSafetyRules = [
  '本体只负责生成同步包，分身只负责应用同步包。',
  '同步/修复不会覆盖账号、API Key、auth、cache、log 或 plugins 运行态。',
  '每个分身都有独立 CODEX_HOME；账号、额度和窗口状态互不混用。',
];

const guideTroubleshootingItems = [
  '提示“本体已有更新”：可以继续同步当前包；要最新内容时先点“提取/刷新本体”。',
  '分身内容缺失：按“提取/刷新本体 -> 同步/修复 -> 重启分身”处理。',
  '启动或同步异常：到“设置”底部的“诊断中心”刷新诊断，再查看最近日志。',
];

function defaultCloneValues(name: string): CloneFormValues {
  return {
    name,
    baseUrl: '',
    apiKey: '',
    model: DEFAULT_MODEL,
    modelCatalogEnabled: false,
    providerId: DEFAULT_PROVIDER_ID,
    providerName: DEFAULT_PROVIDER_NAME,
    workingDir: '',
    launchScript: '',
    goalEnabled: false,
    goalText: '',
    promptPackEnabled: false,
    promptPackText: text.promptPackDefault,
    inheritLocalData: false,
    launchAfterCreate: true,
  };
}

function defaultGitWorktreeValues(): GitWorktreeFormValues {
  return {
    repoDir: '',
    baseRemote: 'upstream',
    baseBranch: 'main',
    newBranch: '',
    worktreeDir: '',
    fetchBeforeCreate: true,
  };
}

function isApiKeyAccount(account: CodexAccount): boolean {
  return Boolean(account.openai_api_key) || account.auth_mode === 'api_key';
}

function accountLabel(account: CodexAccount): string {
  return account.account_name || account.email || account.id;
}

function formatTime(timestamp?: number | null): string {
  if (!timestamp) return text.never;
  return new Date(timestamp).toLocaleString();
}

function formatShortPath(path?: string | null): string {
  if (!path) return '无备份';
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.slice(-2).join('\\') || path;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function formatTokenCount(tokens?: number | null): string {
  const value = Number(tokens ?? 0);
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)}K`;
  return String(Math.round(value));
}

function formatUsd(value?: number | null): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return '$0.0000';
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  if (amount < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}

function sessionUsagePricingForModel(model: string): SessionUsagePricingRule | null {
  const normalized = model.trim();
  if (!normalized) return null;
  return sessionUsagePricingRules.find((rule) => rule.pattern.test(normalized)) ?? null;
}

function estimateSessionUsageModelCost(model: CodexSessionUsageModelSummary): SessionUsageCostEstimate {
  const pricing = sessionUsagePricingForModel(model.model);
  const inputTokens = Math.max(0, model.inputTokens ?? 0);
  const cachedInputTokens = Math.min(Math.max(0, model.cachedInputTokens ?? 0), inputTokens);
  const billableInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const outputTokens = Math.max(0, model.outputTokens ?? 0);
  if (!pricing) {
    return {
      model: model.model,
      priced: false,
      pricingLabel: text.sessionCostUnpriced,
      pricingSource: 'none',
      billableInputTokens,
      cachedInputTokens,
      outputTokens,
      totalTokens: Math.max(0, model.totalTokens ?? 0),
      inputCostUsd: 0,
      cachedInputCostUsd: 0,
      outputCostUsd: 0,
      totalCostUsd: 0,
    };
  }
  const inputCostUsd = (billableInputTokens / 1_000_000) * pricing.inputUsdPerMillion;
  const cachedInputCostUsd = (cachedInputTokens / 1_000_000) * pricing.cachedInputUsdPerMillion;
  const outputCostUsd = (outputTokens / 1_000_000) * pricing.outputUsdPerMillion;
  return {
    model: model.model,
    priced: true,
    pricingLabel: pricing.label,
    pricingSource: pricing.source,
    billableInputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens: Math.max(0, model.totalTokens ?? 0),
    inputCostUsd,
    cachedInputCostUsd,
    outputCostUsd,
    totalCostUsd: inputCostUsd + cachedInputCostUsd + outputCostUsd,
  };
}

function sessionUsageCostSummary(usage: CodexSessionUsageSummary): SessionUsageCostSummary {
  const byModel = usage.byModel.map((model) => estimateSessionUsageModelCost(model));
  const totalInputTokens = Math.max(0, usage.inputTokens ?? 0);
  const cachedInputTokens = Math.min(Math.max(0, usage.cachedInputTokens ?? 0), totalInputTokens);
  const billableInputTokens = Math.max(0, totalInputTokens - cachedInputTokens);
  return {
    totalCostUsd: byModel.reduce((sum, item) => sum + item.totalCostUsd, 0),
    pricedModels: byModel.filter((item) => item.priced).length,
    unpricedModels: byModel.filter((item) => !item.priced).length,
    billableInputTokens,
    cachedInputTokens,
    outputTokens: Math.max(0, usage.outputTokens ?? 0),
    cacheHitRate: totalInputTokens ? cachedInputTokens / totalInputTokens : 0,
    byModel,
  };
}

function cloneModelCatalogModels(
  currentModel: string,
  providerModelsResult?: CodexProviderModelsFetchResult | null,
): string[] {
  const seen = new Set<string>();
  const models: string[] = [];
  for (const value of [currentModel, ...(providerModelsResult?.models ?? [])]) {
    const model = value.trim();
    if (!model) continue;
    const key = model.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    models.push(model);
    if (models.length >= CLONE_MODEL_CATALOG_MAX_MODELS) break;
  }
  return models;
}

function providerTestStatusLabel(result: CodexProviderConnectionTestResult): string {
  if (result.status === 'healthy') return text.providerTestHealthy;
  if (result.status === 'degraded') return text.providerTestDegraded;
  if (result.status === 'chatOnly') return text.providerTestChatOnly;
  return text.providerTestFailed;
}

function normalizeProviderAuditBaseUrl(value: string): string {
  const baseUrl = normalizeProviderBaseUrl(value);
  if (!baseUrl) return '';
  try {
    const url = new URL(baseUrl);
    const path = url.pathname.replace(/\/+$/, '');
    if (!path) {
      url.pathname = '/v1';
      url.search = '';
      url.hash = '';
      return url.toString().replace(/\/+$/, '');
    }
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return baseUrl.replace(/\/+$/, '');
  }
}

function providerAuditComparableBaseUrl(value: string): string {
  const normalized = normalizeProviderAuditBaseUrl(value);
  if (!normalized) return '';
  try {
    const url = new URL(normalized);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return normalized.toLowerCase();
  }
}

function isLocalProviderHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '0.0.0.0' || host === '::1' || host.startsWith('127.');
}

function buildProviderConfigAudit(input: {
  form: CloneFormValues;
  presets: ProviderPreset[];
  providerTestResult?: CodexProviderConnectionTestResult | null;
  providerModelsResult?: CodexProviderModelsFetchResult | null;
  modelCatalogModels: string[];
}): ProviderConfigAudit {
  const checks: ProviderConfigAuditCheck[] = [];
  const addCheck = (check: ProviderConfigAuditCheck) => checks.push(check);
  const rawBaseUrl = input.form.baseUrl.trim();
  const normalizedBaseUrl = normalizeProviderAuditBaseUrl(rawBaseUrl);
  const comparableBaseUrl = providerAuditComparableBaseUrl(rawBaseUrl);
  const model = input.form.model.trim();
  const providerId = input.form.providerId.trim().toLowerCase();
  const hasApiKey = Boolean(input.form.apiKey.trim());
  let baseUrlValid = Boolean(rawBaseUrl);

  if (!rawBaseUrl) {
    baseUrlValid = false;
    addCheck({
      id: 'base-url-missing',
      status: 'blocked',
      label: 'Base URL',
      detail: '请填写 OpenAI 兼容 Base URL。',
    });
  } else {
    try {
      const url = new URL(normalizedBaseUrl);
      const originOnly = url.pathname === '/v1' && new URL(normalizeProviderBaseUrl(rawBaseUrl)).pathname.replace(/\/+$/, '') === '';
      addCheck({
        id: 'base-url-normalized',
        status: 'ok',
        label: 'Base URL',
        detail: originOnly ? `将按 ${normalizedBaseUrl} 测试/写入。` : `已规范化为 ${normalizedBaseUrl}。`,
      });
      if (url.protocol === 'http:' && !isLocalProviderHost(url.hostname)) {
        addCheck({
          id: 'base-url-http',
          status: 'warning',
          label: '非 HTTPS',
          detail: '远程 provider 建议使用 HTTPS；localhost/127.0.0.1 本地网关除外。',
        });
      }
    } catch {
      baseUrlValid = false;
      addCheck({
        id: 'base-url-invalid',
        status: 'blocked',
        label: 'Base URL 格式',
        detail: '无法解析为 URL；请包含 http:// 或 https://。',
      });
    }
  }

  addCheck({
    id: 'api-key',
    status: hasApiKey ? 'ok' : 'blocked',
    label: 'API Key',
    detail: hasApiKey ? '已填写；审计和诊断不会显示或保存密钥内容。' : '第三方 API 分身需要填写 API Key。',
  });

  addCheck({
    id: 'model',
    status: model ? 'ok' : 'blocked',
    label: '模型',
    detail: model ? `当前模型 ${model}。` : '请填写模型，或先从 Provider 模型列表中选择。',
  });

  if (input.providerTestResult) {
    addCheck({
      id: 'provider-test',
      status: input.providerTestResult.codexReady
        ? input.providerTestResult.status === 'degraded'
          ? 'warning'
          : 'ok'
        : 'warning',
      label: providerTestStatusLabel(input.providerTestResult),
      detail: input.providerTestResult.message,
    });
  } else {
    addCheck({
      id: 'provider-test-missing',
      status: baseUrlValid && hasApiKey && model ? 'warning' : 'muted',
      label: 'Provider 测试',
      detail: baseUrlValid && hasApiKey && model ? '尚未运行测试连接。' : '补齐必填项后可运行测试连接。',
    });
  }

  if (input.providerModelsResult) {
    addCheck({
      id: 'provider-models',
      status: input.providerModelsResult.ok ? 'ok' : 'warning',
      label: input.providerModelsResult.ok ? text.providerModelsFetched : text.providerModelsEmpty,
      detail: input.providerModelsResult.ok
        ? `已识别 ${input.providerModelsResult.modelCount} 个模型。`
        : input.providerModelsResult.message,
    });
  } else {
    addCheck({
      id: 'provider-models-missing',
      status: input.form.modelCatalogEnabled && model ? 'warning' : 'muted',
      label: 'Provider 模型',
      detail: input.form.modelCatalogEnabled ? '模型目录会先只包含当前模型；可先拉取 provider 模型补全。' : '可选：拉取 /models 后再写入分身模型目录。',
    });
  }

  const exactPresets = input.presets.filter((preset) => {
    const presetBase = providerAuditComparableBaseUrl(preset.baseUrl);
    return Boolean(comparableBaseUrl && presetBase === comparableBaseUrl && preset.model.trim() === model);
  });
  const similarPresets = input.presets.filter((preset) => {
    const presetBase = providerAuditComparableBaseUrl(preset.baseUrl);
    const sameBase = Boolean(comparableBaseUrl && presetBase === comparableBaseUrl);
    const sameProvider = Boolean(providerId && preset.providerId.trim().toLowerCase() === providerId);
    return (sameBase || sameProvider) && !exactPresets.includes(preset);
  });

  if (exactPresets.length) {
    addCheck({
      id: 'preset-exact',
      status: 'muted',
      label: '已有预设',
      detail: `与 ${exactPresets.length} 个 Provider 预设完全匹配，可直接复用或作为分身专属配置。`,
    });
  } else if (similarPresets.length) {
    addCheck({
      id: 'preset-similar',
      status: 'muted',
      label: '相近预设',
      detail: `找到 ${similarPresets.length} 个同 provider 或同 Base URL 预设，保存自定义预设前建议确认命名。`,
    });
  } else if (rawBaseUrl && model) {
    addCheck({
      id: 'preset-new',
      status: 'ok',
      label: '预设关系',
      detail: '当前 provider/model 组合未与 Provider 预设重复。',
    });
  }

  const blockingCount = checks.filter((check) => check.status === 'blocked').length;
  const warningCount = checks.filter((check) => check.status === 'warning').length;
  const tone: ProviderConfigAuditTone = blockingCount ? 'blocked' : warningCount ? 'warning' : 'ok';
  return {
    tone,
    label: blockingCount ? text.providerAuditBlocked : warningCount ? text.providerAuditWarn : text.providerAuditReady,
    detail: blockingCount
      ? `${blockingCount} 项必填待补，创建前请先处理。`
      : warningCount
        ? `${warningCount} 项建议确认；不影响保存分身配置。`
        : 'Provider、模型、测试和预设关系看起来可用。',
    normalizedBaseUrl,
    duplicatePresetCount: exactPresets.length,
    similarPresetCount: similarPresets.length,
    blockingCount,
    warningCount,
    checks,
  };
}

function clipProviderHealthMessage(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 180);
}

function providerHealthRuntimeKey(baseUrl: string, model: string): string {
  return `${providerAuditComparableBaseUrl(baseUrl)}|${model.trim().toLowerCase()}`;
}

function providerHealthRecordFromTest(input: {
  form: CloneFormValues;
  result: CodexProviderConnectionTestResult;
}): ProviderHealthRecord {
  const baseUrl = input.form.baseUrl.trim();
  const model = input.form.model.trim() || DEFAULT_MODEL;
  const normalizedBaseUrl = normalizeProviderAuditBaseUrl(baseUrl);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    providerId: input.form.providerId.trim() || DEFAULT_PROVIDER_ID,
    providerName: input.form.providerName.trim() || DEFAULT_PROVIDER_NAME,
    baseUrl,
    normalizedBaseUrl,
    model,
    ok: input.result.ok,
    codexReady: input.result.codexReady,
    status: input.result.status || 'unknown',
    protocol: input.result.protocol || 'unknown',
    httpStatus: input.result.httpStatus ?? null,
    latencyMs: input.result.latencyMs,
    ttfbMs: input.result.ttfbMs ?? null,
    message: clipProviderHealthMessage(input.result.message),
    testedAt: Date.now(),
  };
}

function normalizeProviderHealthRecord(value: unknown): ProviderHealthRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<ProviderHealthRecord>;
  const baseUrl = String(record.baseUrl ?? '').trim();
  const normalizedBaseUrl = normalizeProviderAuditBaseUrl(String(record.normalizedBaseUrl ?? baseUrl));
  const model = String(record.model ?? '').trim();
  const testedAt = Number(record.testedAt);
  if (!baseUrl || !model || !Number.isFinite(testedAt)) return null;
  return {
    id: String(record.id ?? `${testedAt}-${model}`),
    providerId: String(record.providerId ?? DEFAULT_PROVIDER_ID).trim() || DEFAULT_PROVIDER_ID,
    providerName: String(record.providerName ?? DEFAULT_PROVIDER_NAME).trim() || DEFAULT_PROVIDER_NAME,
    baseUrl,
    normalizedBaseUrl,
    model,
    ok: Boolean(record.ok),
    codexReady: Boolean(record.codexReady),
    status: String(record.status ?? 'unknown'),
    protocol: String(record.protocol ?? 'unknown'),
    httpStatus:
      typeof record.httpStatus === 'number' && Number.isFinite(record.httpStatus) ? record.httpStatus : null,
    latencyMs: Number.isFinite(Number(record.latencyMs)) ? Number(record.latencyMs) : 0,
    ttfbMs: Number.isFinite(Number(record.ttfbMs)) ? Number(record.ttfbMs) : null,
    message: clipProviderHealthMessage(String(record.message ?? '')),
    testedAt,
  };
}

function compactProviderHealthHistory(records: ProviderHealthRecord[]): ProviderHealthRecord[] {
  const seen = new Set<string>();
  const sorted = [...records].sort((a, b) => b.testedAt - a.testedAt);
  const next: ProviderHealthRecord[] = [];
  for (const record of sorted) {
    const key = providerHealthRuntimeKey(record.normalizedBaseUrl || record.baseUrl, record.model);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(record);
    if (next.length >= PROVIDER_HEALTH_HISTORY_LIMIT) break;
  }
  return next;
}

function readProviderHealthHistory(): ProviderHealthRecord[] {
  try {
    const raw = localStorage.getItem(PROVIDER_HEALTH_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return compactProviderHealthHistory(
      parsed
        .map((item) => normalizeProviderHealthRecord(item))
        .filter((item): item is ProviderHealthRecord => Boolean(item)),
    );
  } catch {
    return [];
  }
}

function writeProviderHealthHistory(records: ProviderHealthRecord[]) {
  localStorage.setItem(PROVIDER_HEALTH_HISTORY_KEY, JSON.stringify(compactProviderHealthHistory(records)));
}

function providerHealthLabel(record: ProviderHealthRecord | null): string {
  if (!record) return text.providerHealthEmpty;
  if (record.codexReady) return record.status === 'degraded' ? text.providerTestDegraded : text.providerHealthCodexReady;
  if (record.ok) return text.providerHealthChatOnly;
  return text.providerHealthFailed;
}

function readLocalStorageBoolean(key: string, fallback: boolean): boolean {
  const value = localStorage.getItem(key);
  if (value === null) return fallback;
  return value === 'true';
}

function readThemeMode(): ThemeMode {
  const value = localStorage.getItem(THEME_MODE_KEY);
  return value === 'dark' || value === 'light' || value === 'system' ? value : 'system';
}

function resolveThemeMode(mode: ThemeMode): 'dark' | 'light' {
  if (mode !== 'system') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyThemeMode(mode: ThemeMode) {
  document.documentElement.dataset.theme = resolveThemeMode(mode);
  document.documentElement.dataset.themeMode = mode;
}

function themeModeLabel(mode: ThemeMode): string {
  if (mode === 'dark') return text.themeDark;
  if (mode === 'light') return text.themeLight;
  return text.themeSystem;
}

function slugifyProviderPresetId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `provider-${Date.now()}`;
}

function normalizeCustomProviderPreset(input: Partial<ProviderPreset>): ProviderPreset | null {
  const label = String(input.label ?? '').trim();
  const baseUrl = String(input.baseUrl ?? '').trim();
  const model = String(input.model ?? '').trim() || DEFAULT_MODEL;
  if (!label || (!baseUrl && !model)) return null;
  const providerName = String(input.providerName ?? '').trim() || label;
  const providerId = String(input.providerId ?? '').trim() || slugifyProviderPresetId(providerName);
  const tags = Array.isArray(input.tags)
    ? input.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 6)
    : [text.customPreset, '本地保存'];
  const website = String(input.website ?? '').trim();
  return {
    id: String(input.id ?? '').trim() || `custom-${slugifyProviderPresetId(label)}`,
    label,
    providerId,
    providerName,
    baseUrl,
    model,
    badge: text.customPreset,
    detail: String(input.detail ?? '').trim() || '本地保存的模型入口，只保存 provider/base URL/model。',
    tags,
    website,
    custom: true,
  };
}

function readCustomProviderPresets(): ProviderPreset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PROVIDER_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeCustomProviderPreset(item as Partial<ProviderPreset>))
      .filter((item): item is ProviderPreset => Boolean(item));
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getStringField(value: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const item = value[key];
    if (typeof item === 'string' && item.trim()) return item.trim();
  }
  return '';
}

function getBooleanField(value: Record<string, unknown>, key: string): boolean {
  return value[key] === true;
}

function getStringArrayField(value: Record<string, unknown>, key: string, limit = CLONE_MODEL_CATALOG_MAX_MODELS): string[] {
  const raw = value[key];
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    const textValue = typeof item === 'string' ? item.trim() : '';
    if (!textValue) continue;
    const dedupeKey = textValue.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push(textValue);
    if (result.length >= limit) break;
  }
  return result;
}

function parseCloneCapabilitySnapshot(content: string): CloneCapabilitySnapshot {
  const parsed = JSON.parse(content) as unknown;
  if (!isRecord(parsed)) throw new Error('snapshot root must be an object');
  const version = Number(parsed.version);
  const app = getStringField(parsed, ['app']);
  if (version !== 1 || app !== CLONE_CAPABILITY_SNAPSHOT_APP) {
    throw new Error('不是 Codex 分身能力快照 v1');
  }
  if (!isRecord(parsed.source) || !isRecord(parsed.provider) || !isRecord(parsed.capabilities)) {
    throw new Error('snapshot missing source/provider/capabilities');
  }
  const source = parsed.source;
  const provider = parsed.provider;
  const capabilities = parsed.capabilities;
  const goal = getStringField(capabilities, ['goal']);
  const promptPack = getStringField(capabilities, ['promptPack']);
  const modelCatalogModels = getStringArrayField(capabilities, 'modelCatalogModels');

  return {
    version,
    app,
    exportedAt: Number(parsed.exportedAt) || Date.now(),
    source: {
      instanceId: getStringField(source, ['instanceId']),
      instanceName: getStringField(source, ['instanceName']) || 'Codex 分身',
      codexHome: getStringField(source, ['codexHome']),
      workingDir: getStringField(source, ['workingDir']) || null,
    },
    provider: {
      authType: getStringField(provider, ['authType']) || 'apiKey',
      baseUrl: getStringField(provider, ['baseUrl']) || null,
      providerId: getStringField(provider, ['providerId']) || DEFAULT_PROVIDER_ID,
      providerName: getStringField(provider, ['providerName']) || DEFAULT_PROVIDER_NAME,
      model: getStringField(provider, ['model']) || DEFAULT_MODEL,
    },
    capabilities: {
      modelCatalogEnabled: getBooleanField(capabilities, 'modelCatalogEnabled') && modelCatalogModels.length > 0,
      modelCatalogModels,
      goalEnabled: getBooleanField(capabilities, 'goalEnabled') && Boolean(goal),
      goal: goal || null,
      promptPackEnabled: getBooleanField(capabilities, 'promptPackEnabled') && Boolean(promptPack),
      promptPack: promptPack || null,
      launchScriptPresent: getBooleanField(capabilities, 'launchScriptPresent'),
    },
    boundaries: getStringArrayField(parsed, 'boundaries', 12),
    warnings: getStringArrayField(parsed, 'warnings', 12),
  };
}

function normalizeProviderBaseUrl(value: string): string {
  const first = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)[0] ?? '';
  if (!first) return '';
  try {
    const url = new URL(first);
    return url.toString().replace(/\/+$/, '');
  } catch {
    return first.replace(/\/+$/, '');
  }
}

function diagnoseUpdateError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  const lower = detail.toLowerCase();
  if (lower.includes('404') || lower.includes('not found') || lower.includes('latest.json')) {
    return text.updateLatestJsonMissing;
  }
  if (lower.includes('signature') || lower.includes('pubkey') || lower.includes('public key')) {
    return text.updateSignatureHint;
  }
  if (lower.includes('invoke') || lower.includes('__tauri') || lower.includes('tauri')) {
    return text.updateDesktopOnlyHint;
  }
  if (
    lower.includes('network') ||
    lower.includes('timeout') ||
    lower.includes('dns') ||
    lower.includes('proxy') ||
    lower.includes('failed to fetch')
  ) {
    return text.updateNetworkHint;
  }
  return detail;
}

function historySummary(status?: CodexHistoryStatus | null): string {
  if (!status) return '未检测';
  const model = status.currentModel ? ` / ${status.currentModel}` : '';
  const auth = status.authOk ? 'auth OK' : 'auth warning';
  const syncMode = status.syncMode ?? 'shared';
  return `${status.threadCount} 线程，mismatch ${status.mismatchCount}，${auth}，sync ${syncMode}，${status.currentProvider}${model}`;
}

function creationHistoryMessage(instance: InstanceProfile): string {
  const status = instance.historyStatus;
  if (!status) return instance.name;
  const verify = status.ok ? '校验 OK' : '有警告';
  return `${instance.name}，已同步 ${status.threadCount} 条线程，mismatch ${status.mismatchCount}，${verify}`;
}

function joinLocalPath(base: string, leaf: string): string {
  const trimmed = base.trim().replace(/[\\/]+$/, '');
  if (!trimmed) return leaf;
  const separator = trimmed.includes('\\') ? '\\' : '/';
  return `${trimmed}${separator}${leaf}`;
}

function syncPackageAppliedMarkerPath(
  instance: InstanceProfile,
  status?: CodexHistoryStatus | null,
): string {
  const codexHome = status?.codexHome || instance.userDataDir;
  return codexHome ? joinLocalPath(codexHome, APPLIED_SYNC_PACKAGE_MARKER_FILE) : '';
}

function syncPackageAppliedResourceRatio(marker?: CodexSyncPackageAppliedMarker | null): string {
  if (!marker) return '0/0 类';
  const readyResources = marker.resources?.filter((resource) => resource.status === 'ready').length ?? 0;
  const resourceCount = marker.resources?.length ?? 0;
  return `${readyResources}/${resourceCount} 类`;
}

function syncPackageAppliedSummary(status?: CodexHistoryStatus | null): string {
  const marker = status?.syncPackageApplied;
  if (!marker) return '同步包应用：未记录';
  const stale = marker.staleWhenApplied ? ' / 应用时本体已有更新' : '';
  return `同步包应用：${formatTime(marker.appliedAt)} / ${formatBytes(marker.copiedBytes ?? 0)} / ${syncPackageAppliedResourceRatio(marker)}${stale}`;
}

function syncPackageAppliedFreshness(
  status: CodexHistoryStatus | null | undefined,
  currentPackage: CodexSyncPackageStatus | null,
): { label: string; tone: 'ok' | 'warning' | 'muted'; title: string } {
  if (!currentPackage) {
    return {
      label: text.syncPackageCurrentUnknown,
      tone: 'muted',
      title: text.syncPackageApplyUnknown,
    };
  }
  if (!currentPackage.exists) {
    return {
      label: text.syncPackageCurrentUnknown,
      tone: 'muted',
      title: text.syncPackageApplyMissing,
    };
  }
  const marker = status?.syncPackageApplied;
  if (!marker) {
    return {
      label: text.syncPackageCurrentMissing,
      tone: 'warning',
      title: text.syncPackageAppliedMissing,
    };
  }
  const markerCreatedAt = marker.packageCreatedAt ?? 0;
  const currentCreatedAt = currentPackage.createdAt ?? 0;
  if (markerCreatedAt && currentCreatedAt && markerCreatedAt + 1_000 < currentCreatedAt) {
    return {
      label: text.syncPackageCurrentMissing,
      tone: 'warning',
      title: `分身应用的是 ${formatTime(markerCreatedAt)} 的同步包；当前同步包是 ${formatTime(currentCreatedAt)}。`,
    };
  }
  const stale = marker.staleWhenApplied ? '；应用时本体已有更新' : '';
  return {
    label: text.syncPackageCurrentApplied,
    tone: marker.staleWhenApplied ? 'warning' : 'ok',
    title: `${syncPackageAppliedSummary(status)}${stale}`,
  };
}

type SyncPackageResourceDiffHint = {
  label: string;
  tone: 'ok' | 'warning' | 'muted';
  title: string;
};

function syncPackageResourceFingerprint(resource: CodexSyncPackageResourceSummary): string {
  const inventory = [...(resource.items ?? [])].sort().join(',');
  return [
    resource.status,
    resource.fileCount ?? 0,
    resource.directoryCount ?? 0,
    resource.bytes ?? 0,
    inventory,
  ].join('|');
}

function syncPackageResourceDiffHint(
  status: CodexHistoryStatus | null | undefined,
  currentPackage: CodexSyncPackageStatus | null,
): SyncPackageResourceDiffHint {
  const marker = status?.syncPackageApplied;
  if (!currentPackage?.exists || !currentPackage.resources?.length) {
    return {
      label: '资源差异待刷新',
      tone: 'muted',
      title: '当前同步包资源清单不可用；先刷新/提取本体同步包。',
    };
  }
  if (!marker?.resources?.length) {
    return {
      label: '资源差异待同步',
      tone: 'warning',
      title: '这个分身还没有应用记录；执行同步/修复后会写入 clone-sync-package-applied.json。',
    };
  }

  const appliedById = new Map(marker.resources.map((resource) => [resource.id, resource]));
  const changed: string[] = [];
  const missing: string[] = [];
  const newResources: string[] = [];

  for (const resource of currentPackage.resources) {
    const applied = appliedById.get(resource.id);
    if (!applied) {
      newResources.push(resource.label);
      continue;
    }
    if (syncPackageResourceFingerprint(applied) !== syncPackageResourceFingerprint(resource)) {
      changed.push(resource.label);
    }
  }

  const currentIds = new Set(currentPackage.resources.map((resource) => resource.id));
  for (const resource of marker.resources) {
    if (!currentIds.has(resource.id)) missing.push(resource.label);
  }

  const totalDiffs = changed.length + missing.length + newResources.length;
  if (!totalDiffs) {
    return {
      label: '资源清单一致',
      tone: 'ok',
      title: '当前同步包资源清单与这个分身上次应用记录一致。',
    };
  }

  const detail = [
    changed.length ? `变化：${changed.join('、')}` : '',
    newResources.length ? `新增：${newResources.join('、')}` : '',
    missing.length ? `旧项：${missing.join('、')}` : '',
  ]
    .filter(Boolean)
    .join('；');

  return {
    label: `资源差异 ${totalDiffs} 类`,
    tone: 'warning',
    title: `${detail}。如需要把这些差异应用到分身，请手动执行同步/修复。`,
  };
}

function syncPackageStateLabel(status: CodexSyncPackageStatus | null): string {
  if (!status?.exists) return text.syncPackageMissing;
  return status.stale ? text.syncPackageStale : text.syncPackageReady;
}

function legacySyncPackageResourceItems(status: CodexSyncPackageStatus | null) {
  const copied = status?.exists ? `${(status.fileCount ?? 0).toLocaleString()} 文件 / ${(status.directoryCount ?? 0).toLocaleString()} 目录` : '尚未提取';
  const skippedCount = status?.skipped?.length ?? 0;
  return [
    { label: '聊天历史', value: copied, detail: 'sessions、archived_sessions、session_index、history.jsonl' },
    { label: '技能规则', value: status?.exists ? '已纳入' : '待提取', detail: 'skills、rules、AGENTS.md' },
    { label: 'MCP 与记忆', value: status?.exists ? '已纳入' : '待提取', detail: 'mcp-servers、memories、sqlite、vendor_imports' },
    { label: '排除项', value: skippedCount ? `${skippedCount} 项` : '固定排除', detail: 'auth、credentials、plugins、cache、log、.tmp、额度配置' },
  ];
}

type SyncPackageResourceItem = {
  id?: string;
  label: string;
  value: string;
  detail: string;
  status?: string;
  applyMode?: string;
  inventory?: string[];
};

const resourceLensResourceIds = new Set(['skills', 'mcp', 'memory', 'config', 'goals']);
const resourceLensKeywords = [
  'skill',
  'skills',
  'mcp',
  'memory',
  'memories',
  'rules',
  'agents',
  'agents.md',
  'config',
  'goals',
  'prompts',
  '技能',
  '记忆',
  '规则',
  '配置',
  '目标',
];

function syncPackageResourceStatusLabel(status?: string): string {
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

function syncPackageResourceClass(status?: string): string {
  return status ? `sync-resource ${status}` : 'sync-resource';
}

function syncPackageResourceItems(status: CodexSyncPackageStatus | null): SyncPackageResourceItem[] {
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

type ResourceStatusFilter = 'all' | 'ready' | 'partial' | 'issues' | 'missing';

const resourceStatusFilters: ResourceStatusFilter[] = ['all', 'ready', 'partial', 'issues', 'missing'];

function resourceStatusFilterLabel(filter: ResourceStatusFilter): string {
  switch (filter) {
    case 'ready':
      return 'Ready';
    case 'partial':
      return 'Partial';
    case 'issues':
      return 'Issues';
    case 'missing':
      return 'Missing';
    default:
      return 'All';
  }
}

function resourceMatchesStatusFilter(item: SyncPackageResourceItem, filter: ResourceStatusFilter): boolean {
  switch (filter) {
    case 'ready':
      return item.status === 'ready';
    case 'partial':
      return item.status === 'partial';
    case 'issues':
      return item.status === 'partial' || item.status === 'error';
    case 'missing':
      return item.status === 'missing';
    default:
      return true;
  }
}

function resourceMatchesQuery(item: SyncPackageResourceItem, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    item.label,
    item.value,
    item.detail,
    item.status ?? '',
    item.applyMode ?? '',
    ...(item.inventory ?? []),
  ]
    .join(' ')
    .toLowerCase()
    .includes(normalized);
}

function filteredSyncPackageResources(
  resources: SyncPackageResourceItem[],
  query: string,
  statusFilter: ResourceStatusFilter,
): SyncPackageResourceItem[] {
  return resources.filter(
    (item) => resourceMatchesStatusFilter(item, statusFilter) && resourceMatchesQuery(item, query),
  );
}

type ResourceLensStats = {
  total: number;
  ready: number;
  issues: number;
  inventory: number;
};

function resourceLensSearchText(item: SyncPackageResourceItem): string {
  return [
    item.id ?? '',
    item.label,
    item.value,
    item.detail,
    item.status ?? '',
    item.applyMode ?? '',
    ...(item.inventory ?? []),
  ]
    .join(' ')
    .toLowerCase();
}

function isResourceLensItem(item: SyncPackageResourceItem): boolean {
  const id = item.id?.toLowerCase();
  if (id && resourceLensResourceIds.has(id)) return true;
  const searchable = resourceLensSearchText(item);
  return resourceLensKeywords.some((keyword) => searchable.includes(keyword));
}

function resourceLensItems(resources: SyncPackageResourceItem[]): SyncPackageResourceItem[] {
  return resources.filter(isResourceLensItem);
}

function resourceLensStats(items: SyncPackageResourceItem[]): ResourceLensStats {
  return items.reduce<ResourceLensStats>(
    (stats, item) => {
      const inventoryCount = item.inventory?.length ?? 0;
      return {
        total: stats.total + 1,
        ready: stats.ready + (item.status === 'ready' ? 1 : 0),
        issues: stats.issues + (item.status === 'ready' ? 0 : 1),
        inventory: stats.inventory + inventoryCount,
      };
    },
    { total: 0, ready: 0, issues: 0, inventory: 0 },
  );
}

function ResourceInventoryChips(props: { items?: string[]; label?: string }) {
  const items = props.items ?? [];
  if (!items.length) return null;
  const visible = items.slice(0, 6);
  const hidden = items.slice(visible.length);
  async function copyInventory() {
    try {
      await navigator.clipboard.writeText([props.label, ...items].filter(Boolean).join('\n'));
    } catch (error) {
      reportError(error, { area: 'sync-package', action: 'copy-resource-inventory', detail: props.label });
    }
  }
  return (
    <div className="resource-inventory">
      <button className="resource-inventory-copy" onClick={() => void copyInventory()} title="Copy resource inventory" type="button">
        <Copy size={12} />
      </button>
      {visible.map((item) => (
        <code key={item}>{item}</code>
      ))}
      {hidden.length ? (
        <details className="resource-inventory-more">
          <summary>
            <code>+{hidden.length}</code>
          </summary>
          <div>
            {hidden.map((item) => (
              <code key={item}>{item}</code>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function SyncPackageResourceList(props: {
  resources: SyncPackageResourceItem[];
  className: 'resource-list' | 'sync-package-resources';
}) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ResourceStatusFilter>('all');
  const visibleResources = filteredSyncPackageResources(props.resources, query, statusFilter);

  return (
    <div className="sync-resource-explorer">
      <div className="resource-filter-toolbar">
        <label className="resource-filter-search">
          <Search size={14} />
          <input
            aria-label="Search sync package resources"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search resources"
            type="search"
            value={query}
          />
        </label>
        <div className="resource-filter-row">
          {resourceStatusFilters.map((filter) => (
            <button
              className={filter === statusFilter ? 'active' : undefined}
              key={filter}
              onClick={() => setStatusFilter(filter)}
              type="button"
            >
              {resourceStatusFilterLabel(filter)}
            </button>
          ))}
        </div>
        <span className="resource-filter-count">
          {visibleResources.length}/{props.resources.length}
        </span>
      </div>
      <div className={props.className}>
        {visibleResources.map((item) => (
          <div className={syncPackageResourceClass(item.status)} key={item.label}>
            <strong>{item.label}</strong>
            <span>{item.value}</span>
            <small>{item.detail}</small>
            <ResourceInventoryChips items={item.inventory} label={item.label} />
            {item.applyMode ? <small className="resource-apply-mode">{item.applyMode}</small> : null}
          </div>
        ))}
        {!visibleResources.length ? (
          <div className="sync-resource resource-empty">
            <strong>No matching resources</strong>
            <span>0/{props.resources.length}</span>
            <small>Clear the search or switch resource status filter.</small>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ResourceLensPanel(props: {
  resources: SyncPackageResourceItem[];
  busy?: string;
  compact?: boolean;
  onCopy?: () => unknown;
}) {
  const items = resourceLensItems(props.resources);
  const stats = resourceLensStats(items);

  return (
    <div className={props.compact ? 'resource-lens-panel compact' : 'resource-lens-panel'}>
      <div className="resource-lens-header">
        <div>
          <strong>
            <BookOpen size={15} />
            {text.resourceLensTitle}
          </strong>
          <span>{text.resourceLensLead}</span>
        </div>
        {props.onCopy ? (
          <button disabled={Boolean(props.busy)} onClick={() => void props.onCopy?.()} type="button">
            <Copy size={14} />
            {text.resourceLensCopy}
          </button>
        ) : null}
      </div>
      <div className="resource-lens-stats">
        <span>
          <strong>{`${stats.ready}/${stats.total}`}</strong>
          <small>{text.resourceLensReady}</small>
        </span>
        <span>
          <strong>{stats.issues}</strong>
          <small>{text.resourceLensIssues}</small>
        </span>
        <span>
          <strong>{stats.inventory}</strong>
          <small>{text.resourceLensInventory}</small>
        </span>
      </div>
      {items.length ? (
        <div className="resource-lens-grid">
          {items.map((item) => (
            <div className={`resource-lens-item ${item.status ?? 'unknown'}`} key={item.id ?? item.label}>
              <div>
                <strong>{item.label}</strong>
                <span>{item.value}</span>
              </div>
              <small>{item.detail}</small>
              <ResourceInventoryChips items={item.inventory} label={item.label} />
            </div>
          ))}
        </div>
      ) : (
        <div className="resource-lens-empty">{text.resourceLensEmpty}</div>
      )}
    </div>
  );
}

function syncPackageIncludedSummary(status: CodexSyncPackageStatus | null): string {
  if (!status?.exists) return '待提取';
  const entryCount = status.entries?.length ?? 0;
  return `${entryCount.toLocaleString()} 条 manifest / ${formatBytes(status.copiedBytes ?? 0)}`;
}

function syncPackageExcludedSummary(status: CodexSyncPackageStatus | null): string {
  const skippedCount = status?.skipped?.length ?? 0;
  return skippedCount ? `${skippedCount.toLocaleString()} 条 skipped` : 'auth、credentials、plugins、cache、log 固定排除';
}

function syncPackageEntryLabel(entry: CodexSyncPackageStatus['entries'][number]): string {
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

function syncPackageEntryPreview(status: CodexSyncPackageStatus | null) {
  if (!status?.entries?.length) return [];
  const preferred = ['sessions', 'archived_sessions', 'session_index.jsonl', 'history.jsonl', 'skills', 'mcp-servers', 'memories', 'AGENTS.md'];
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

function buildSyncPackageResourceReport(status: CodexSyncPackageStatus | null): string {
  const resources = syncPackageResourceItems(status);
  return [
    '# Codex Sync Package Resources',
    `generatedAt: ${new Date().toISOString()}`,
    `exists: ${status?.exists ? 'yes' : 'no'}`,
    `state: ${syncPackageStateLabel(status)}`,
    `stale: ${status?.stale ? 'yes' : 'no'}`,
    `packagePath: ${status?.packagePath ?? 'unknown'}`,
    `manifestPath: ${status?.manifestPath ?? 'unknown'}`,
    `source: ${status?.source ?? 'unknown'}`,
    `createdAt: ${formatTime(status?.createdAt)}`,
    `sourceModifiedAt: ${formatTime(status?.sourceModifiedAt)}`,
    `files: ${status?.fileCount ?? 0}`,
    `directories: ${status?.directoryCount ?? 0}`,
    `bytes: ${status?.copiedBytes ?? 0} (${formatBytes(status?.copiedBytes ?? 0)})`,
    '',
    '## Resources',
    ...resources.flatMap((resource) => [
      `- ${resource.label}: ${resource.status ?? 'unknown'} | ${resource.value}`,
      `  applyMode: ${resource.applyMode || 'unknown'}`,
      `  detail: ${resource.detail || 'none'}`,
      `  inventory: ${resource.inventory?.length ? resource.inventory.join(', ') : 'none'}`,
    ]),
    '',
    '## Warnings',
    ...((status?.warnings ?? []).length ? (status?.warnings ?? []).map((item) => `- ${item}`) : ['- none']),
    '',
    '## Skipped',
    ...((status?.skipped ?? []).length ? (status?.skipped ?? []).map((item) => `- ${item}`) : ['- none']),
  ].join('\n');
}

function buildResourceLensReport(status: CodexSyncPackageStatus | null): string {
  const resources = resourceLensItems(syncPackageResourceItems(status));
  const stats = resourceLensStats(resources);
  return [
    '# Codex MCP Skills Resource Lens',
    `generatedAt: ${new Date().toISOString()}`,
    `exists: ${status?.exists ? 'yes' : 'no'}`,
    `state: ${syncPackageStateLabel(status)}`,
    `packagePath: ${status?.packagePath ?? 'unknown'}`,
    `manifestPath: ${status?.manifestPath ?? 'unknown'}`,
    `summary: ready=${stats.ready}/${stats.total} | issues=${stats.issues} | inventory=${stats.inventory}`,
    '',
    '## Focus Resources',
    ...(resources.length
      ? resources.flatMap((resource) => [
          `- ${resource.label}: ${resource.status ?? 'unknown'} | ${resource.value}`,
          `  id: ${resource.id || 'legacy'}`,
          `  applyMode: ${resource.applyMode || 'unknown'}`,
          `  detail: ${resource.detail || 'none'}`,
          `  inventory: ${resource.inventory?.length ? resource.inventory.join(', ') : 'none'}`,
        ])
      : ['- none']),
    '',
    '## Boundary',
    '- readOnly: yes',
    '- writesSourceProfile: no',
    '- writesCloneProfile: no',
    '- excluded: auth.json, .credentials.json, account tokens, quota state, plugins, cache, logs, tmp',
  ].join('\n');
}

function buildSyncPackageBackupReport(backups: CodexSyncPackageBackupSummary[]): string {
  return [
    '# Codex Sync Package Backup Timeline',
    `generatedAt: ${new Date().toISOString()}`,
    `count: ${backups.length}`,
    '',
    ...(
      backups.length
        ? backups.flatMap((backup, index) => [
            `## ${index + 1}. ${backup.id}`,
            `status: ${backup.status}`,
            `backupCreatedAt: ${formatTime(backup.backupCreatedAt)}`,
            `packageCreatedAt: ${formatTime(backup.packageCreatedAt)}`,
            `backupPath: ${backup.backupPath}`,
            `packagePath: ${backup.packagePath}`,
            `manifestPath: ${backup.manifestPath}`,
            `source: ${backup.source ?? 'unknown'}`,
            `files: ${backup.fileCount}`,
            `directories: ${backup.directoryCount}`,
            `bytes: ${backup.copiedBytes} (${formatBytes(backup.copiedBytes)})`,
            `resources: ${backup.readyResourceCount}/${backup.resourceCount}`,
            `warnings: ${backup.warnings.length ? backup.warnings.join(' / ') : 'none'}`,
            `error: ${backup.error || 'none'}`,
            '',
          ])
        : ['- no sync package backups']
    ),
  ].join('\n');
}

function buildSyncPackagePreflightReport(preflight: CodexSyncPackagePreflightReport | null): string {
  return [
    '# Codex Sync Package Preflight',
    `generatedAt: ${new Date().toISOString()}`,
    `status: ${preflight?.status ?? 'not checked'}`,
    `readyToApply: ${preflight?.readyToApply ? 'yes' : 'no'}`,
    `checkedAt: ${formatTime(preflight?.checkedAt)}`,
    `packageCreatedAt: ${formatTime(preflight?.packageCreatedAt)}`,
    `stale: ${preflight?.stale ? 'yes' : 'no'}`,
    `packagePath: ${preflight?.packagePath ?? 'unknown'}`,
    `manifestPath: ${preflight?.manifestPath ?? 'unknown'}`,
    `source: ${preflight?.source ?? 'unknown'}`,
    `entriesChecked: ${preflight?.entriesChecked ?? 0}`,
    `resourcesChecked: ${preflight?.resourcesChecked ?? 0}`,
    `errors: ${preflight?.errorCount ?? 0}`,
    `warnings: ${preflight?.warningCount ?? 0}`,
    '',
    '## Boundary',
    '- Source module: extracts or refreshes the sync package only.',
    '- Clone module: applies an existing package only after manual Sync/Repair.',
    '- Preflight is read-only; it does not restore backups or copy live source profile data.',
    '',
    '## Checks',
    ...((preflight?.checks ?? []).length
      ? (preflight?.checks ?? []).map((check) =>
          `- [${check.status}] ${check.label}: ${check.detail}${check.action ? ` | action: ${check.action}` : ''}`,
        )
      : ['- no preflight checks have been run']),
    '',
    '## Unsafe Paths',
    ...((preflight?.unsafePaths ?? []).length ? (preflight?.unsafePaths ?? []).map((item) => `- ${item}`) : ['- none']),
  ].join('\n');
}

function syncPackageResourceSummaryLine(resource: CodexSyncPackageResourceSummary): string {
  return [
    `${resource.label} [${resource.id}]`,
    `status=${resource.status || 'unknown'}`,
    `files=${resource.fileCount ?? 0}`,
    `dirs=${resource.directoryCount ?? 0}`,
    `bytes=${resource.bytes ?? 0}`,
    `applyMode=${resource.applyMode || 'unknown'}`,
    `paths=${resource.paths?.join(', ') || 'none'}`,
    `missing=${resource.missing?.join(', ') || 'none'}`,
    `errors=${resource.errors?.join(', ') || 'none'}`,
    `items=${resource.items?.join(', ') || 'none'}`,
  ].join(' | ');
}

function buildSyncPackageResourceDiffReport(input: {
  instance: InstanceProfile;
  history?: CodexHistoryStatus | null;
  currentPackage: CodexSyncPackageStatus | null;
}): string {
  const marker = input.history?.syncPackageApplied ?? null;
  const currentResources = input.currentPackage?.resources ?? [];
  const appliedResources = marker?.resources ?? [];
  const appliedById = new Map(appliedResources.map((resource) => [resource.id, resource]));
  const currentById = new Map(currentResources.map((resource) => [resource.id, resource]));
  const changed: Array<{
    current: CodexSyncPackageResourceSummary;
    applied: CodexSyncPackageResourceSummary;
  }> = [];
  const newResources: CodexSyncPackageResourceSummary[] = [];
  const removedResources: CodexSyncPackageResourceSummary[] = [];

  for (const current of currentResources) {
    const applied = appliedById.get(current.id);
    if (!applied) {
      newResources.push(current);
      continue;
    }
    if (syncPackageResourceFingerprint(current) !== syncPackageResourceFingerprint(applied)) {
      changed.push({ current, applied });
    }
  }

  for (const applied of appliedResources) {
    if (!currentById.has(applied.id)) removedResources.push(applied);
  }

  const unchangedCount = currentResources.filter((resource) => {
    const applied = appliedById.get(resource.id);
    return applied && syncPackageResourceFingerprint(resource) === syncPackageResourceFingerprint(applied);
  }).length;

  const changedLines = changed.length
    ? changed.flatMap((item) => [
        `- ${item.current.label}`,
        `  current: ${syncPackageResourceSummaryLine(item.current)}`,
        `  applied: ${syncPackageResourceSummaryLine(item.applied)}`,
      ])
    : ['- none'];
  const newLines = newResources.length
    ? newResources.map((resource) => `- ${syncPackageResourceSummaryLine(resource)}`)
    : ['- none'];
  const removedLines = removedResources.length
    ? removedResources.map((resource) => `- ${syncPackageResourceSummaryLine(resource)}`)
    : ['- none'];

  return [
    '# Codex Clone Sync Package Resource Diff',
    `generatedAt: ${new Date().toISOString()}`,
    `instanceId: ${input.instance.id}`,
    `instanceName: ${input.instance.name || input.instance.id}`,
    `codexHome: ${input.history?.codexHome || input.instance.userDataDir}`,
    '',
    '## Boundary',
    '- Source module state: current extracted sync package only.',
    '- Clone module state: clone-owned clone-sync-package-applied.json marker only.',
    '- This report does not copy from the running source profile and does not apply data to the clone.',
    '',
    '## Package',
    `currentPackageExists: ${input.currentPackage?.exists ? 'yes' : 'no'}`,
    `currentPackagePath: ${input.currentPackage?.packagePath ?? 'unknown'}`,
    `currentPackageCreatedAt: ${formatTime(input.currentPackage?.createdAt)}`,
    `markerApplied: ${marker ? 'yes' : 'no'}`,
    `markerAppliedAt: ${formatTime(marker?.appliedAt)}`,
    `markerPackageCreatedAt: ${formatTime(marker?.packageCreatedAt)}`,
    `markerStaleWhenApplied: ${marker?.staleWhenApplied ? 'yes' : 'no'}`,
    '',
    '## Summary',
    `changed: ${changed.length}`,
    `new: ${newResources.length}`,
    `removed: ${removedResources.length}`,
    `unchanged: ${unchangedCount}`,
    `currentResources: ${currentResources.length}`,
    `appliedResources: ${appliedResources.length}`,
    '',
    '## Changed',
    ...changedLines,
    '',
    '## New In Current Package',
    ...newLines,
    '',
    '## Removed From Current Package',
    ...removedLines,
  ].join('\n');
}

function cloneHealthStats(instances: InstanceProfile[], historyByInstance: Record<string, CodexHistoryStatus>) {
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

function cloneReadinessSummary(
  instance: InstanceProfile,
  history: CodexHistoryStatus | null | undefined,
  syncPackage: CodexSyncPackageStatus | null,
): CloneReadinessSummary {
  const checks: CloneReadinessCheck[] = [];
  const addCheck = (check: CloneReadinessCheck) => checks.push(check);
  const model = history?.currentModel?.trim() || 'model ?';
  const provider = history?.currentProvider?.trim() || 'provider ?';

  if (!history) {
    addCheck({
      id: 'history-unchecked',
      status: 'warning',
      label: text.cloneReadinessUnchecked,
      detail: '尚未读取分身状态，先刷新或校验一次再判断同步和账号状态。',
    });
  } else {
    addCheck({
      id: 'auth',
      status: history.authOk ? 'ok' : 'blocked',
      label: history.authOk ? 'Auth OK' : 'Auth 需处理',
      detail: history.authOk
        ? `${history.authMode ?? 'auth'} / ${history.providerBaseUrlHost ?? 'host ?'}`
        : '分身账号或 API Key 投影不可用，启动前先修复账号绑定。',
    });
    addCheck({
      id: 'provider-model',
      status: history.currentProvider && history.currentModel ? 'ok' : 'warning',
      label: 'Provider / model',
      detail: `${provider} / ${model}`,
    });
    addCheck({
      id: 'history-index',
      status: history.mismatchCount || history.missingSessionFiles ? 'warning' : 'ok',
      label: '会话索引',
      detail: `mismatch ${history.mismatchCount} / missing ${history.missingSessionFiles} / files ${history.sessionFileCount}`,
    });
    if (history.warnings?.length) {
      addCheck({
        id: 'history-warning',
        status: 'warning',
        label: '历史同步提示',
        detail: history.warnings[0],
      });
    }
  }

  const freshness = syncPackageAppliedFreshness(history, syncPackage);
  if (!syncPackage?.exists) {
    addCheck({
      id: 'sync-package-missing',
      status: 'warning',
      label: '同步包',
      detail: text.syncPackageApplyMissing,
    });
  } else if (!history?.syncPackageApplied) {
    addCheck({
      id: 'sync-package-not-applied',
      status: 'warning',
      label: '同步包',
      detail: '当前分身还没有 clone-sync-package-applied.json 应用记录。',
    });
  } else {
    addCheck({
      id: 'sync-package-applied',
      status: freshness.tone === 'warning' ? 'warning' : 'ok',
      label: '同步包',
      detail: freshness.title,
    });
  }

  const resourceDiff = syncPackageResourceDiffHint(history, syncPackage);
  if (resourceDiff.tone === 'warning') {
    addCheck({
      id: 'resource-diff',
      status: 'warning',
      label: resourceDiff.label,
      detail: resourceDiff.title,
    });
  }

  addCheck({
    id: 'model-catalog',
    status: instance.modelCatalogEnabled ? 'ok' : 'muted',
    label: text.modelCatalog,
    detail: instance.modelCatalogEnabled
      ? `${instance.modelCatalogCount ?? 0} models / ${formatShortPath(instance.modelCatalogPath)}`
      : '未写入分身模型目录；可以用能力快照或创建表单补齐。',
  });
  addCheck({
    id: 'goal',
    status: instance.goalEnabled ? 'ok' : 'muted',
    label: text.goalPursuit,
    detail: instance.goalEnabled
      ? formatShortPath(instance.goalPath)
      : '未配置分身专属目标；长期任务分身建议开启。',
  });
  addCheck({
    id: 'prompt-pack',
    status: instance.promptPackEnabled ? 'ok' : 'muted',
    label: text.promptPack,
    detail: instance.promptPackEnabled
      ? formatShortPath(instance.promptPackPath)
      : '未配置提示词包；常用工作模式可以沉淀到分身。',
  });
  addCheck({
    id: 'working-dir',
    status: instance.workingDir?.trim() ? 'ok' : 'muted',
    label: text.workdir,
    detail: instance.workingDir?.trim() || '未绑定工作目录，启动后需在 Codex 内手动选择上下文。',
  });
  addCheck({
    id: 'launch-script',
    status: instance.launchScript?.trim() ? 'ok' : 'muted',
    label: text.launchScript,
    detail: instance.launchScript?.trim() ? text.launchScriptConfigured : '未配置启动脚本；这是可选能力。',
  });

  const blockingCount = checks.filter((check) => check.status === 'blocked').length;
  const warningCount = checks.filter((check) => check.status === 'warning').length;
  const tone: CloneReadinessTone = blockingCount ? 'blocked' : warningCount ? 'warning' : 'ok';
  const label =
    tone === 'blocked'
      ? text.cloneReadinessBlocked
      : tone === 'warning'
        ? text.cloneReadinessWarn
        : text.cloneReadinessReady;
  const detail =
    tone === 'blocked'
      ? `${blockingCount} 个阻断项，启动前先处理。`
      : tone === 'warning'
        ? `${warningCount} 个提示项，仍可按需启动。`
        : '核心检查通过，可直接启动。';

  return { tone, label, detail, checks, blockingCount, warningCount };
}

function syncPackageApplyBlocker(status: CodexSyncPackageStatus | null): string | null {
  if (!status) return text.syncPackageApplyUnknown;
  if (!status.exists) return text.syncPackageApplyMissing;
  return null;
}

function syncPackagePreflightBlocker(preflight: CodexSyncPackagePreflightReport | null): string | null {
  if (!preflight) return null;
  if (preflight.readyToApply && preflight.status !== 'error' && preflight.status !== 'missing') return null;
  return `Preflight blocked Sync/Repair: ${preflight.errorCount} errors, ${preflight.warningCount} warnings. Copy the preflight report or refresh the source package.`;
}

function syncPackageRepairBlocker(
  status: CodexSyncPackageStatus | null,
  preflight: CodexSyncPackagePreflightReport | null,
): string | null {
  return syncPackageApplyBlocker(status) ?? syncPackagePreflightBlocker(preflight);
}

function diagnosticsSummary(snapshot: DiagnosticsSnapshot | null): string {
  if (!snapshot) return '未加载';
  const logCount = snapshot.logFiles?.length ?? 0;
  const pathState = snapshot.codexAppPathExists ? '路径 OK' : '路径待修复';
  return `${pathState}，${logCount} 个日志文件，PID ${snapshot.launcherPid}`;
}

function gitWorktreeDiagnosticsLines(input: {
  form?: GitWorktreeFormValues | null;
  defaults?: GitWorktreeDefaults | null;
  result?: GitWorktreeCreateResult | null;
}): string[] {
  const form = input.form ?? null;
  const defaults = input.defaults ?? null;
  const result = input.result ?? null;
  const warnings = [...(defaults?.warnings ?? []), ...(result?.warnings ?? [])];
  return [
    '## Upstream Worktree',
    `formRepoDir: ${form?.repoDir || 'empty'}`,
    `formBase: ${(form?.baseRemote || 'upstream')}/${form?.baseBranch || 'main'}`,
    `formNewBranch: ${form?.newBranch || 'empty'}`,
    `formWorktreeDir: ${form?.worktreeDir || 'empty'}`,
    `fetchBeforeCreate: ${form?.fetchBeforeCreate === false ? 'no' : 'yes'}`,
    `detectedRepoDir: ${defaults?.repoDir ?? 'not detected'}`,
    `detectedCurrentBranch: ${defaults?.currentBranch || 'unknown'}`,
    `detectedRemotes: ${(defaults?.remotes ?? []).join(', ') || 'none'}`,
    `detectedBaseRef: ${defaults?.baseRef ?? 'not detected'}`,
    `detectedDirty: ${defaults ? (defaults.dirty ? 'yes' : 'no') : 'unknown'}`,
    `createdWorktree: ${result?.worktreeDir ?? 'none'}`,
    `createdBranch: ${result?.newBranch ?? 'none'}`,
    `createdBaseRef: ${result?.baseRef ?? 'none'}`,
    `createdFetched: ${result ? (result.fetched ? 'yes' : 'no') : 'unknown'}`,
    `warnings: ${warnings.length ? warnings.join(' / ') : 'none'}`,
  ];
}

function buildGitWorktreeDiagnosticsReport(input: {
  form: GitWorktreeFormValues;
  defaults: GitWorktreeDefaults | null;
  result: GitWorktreeCreateResult | null;
  appVersion: string;
}): string {
  return [
    '# Codex Clone Launcher Upstream Worktree Diagnostics',
    `generatedAt: ${new Date().toISOString()}`,
    `appVersion: ${input.appVersion || 'unknown'}`,
    '',
    ...gitWorktreeDiagnosticsLines(input),
  ].join('\n');
}

function buildDiagnosticsReport(input: {
  diagnostics: DiagnosticsSnapshot | null;
  syncPackage: CodexSyncPackageStatus | null;
  syncPackageBackups?: CodexSyncPackageBackupSummary[];
  syncPackagePreflight?: CodexSyncPackagePreflightReport | null;
  gitWorktreeForm?: GitWorktreeFormValues | null;
  gitWorktreeDefaults?: GitWorktreeDefaults | null;
  gitWorktreeResult?: GitWorktreeCreateResult | null;
  providerTestResult?: CodexProviderConnectionTestResult | null;
  providerModelsResult?: CodexProviderModelsFetchResult | null;
  providerConfigAudit?: ProviderConfigAudit | null;
  modelCatalogEnabled?: boolean;
  modelCatalogModels?: string[];
  promptPackEnabled?: boolean;
  promptPackChars?: number;
  instances: InstanceProfile[];
  historyByInstance: Record<string, CodexHistoryStatus>;
  usageByInstance?: Record<string, CodexSessionUsageSummary>;
  providerPresetCatalog?: ProviderPreset[];
  providerHealthHistory?: ProviderHealthRecord[];
  codexAppPath: string;
  appVersion: string;
}) {
  const health = cloneHealthStats(input.instances, input.historyByInstance);
  const sync = input.syncPackage;
  const backups = input.syncPackageBackups ?? [];
  const preflight = input.syncPackagePreflight ?? null;
  const diagnostics = input.diagnostics;
  const usageByInstance = input.usageByInstance ?? {};
  const providerPresetCatalog = input.providerPresetCatalog ?? [];
  const customProviderPresets = providerPresetCatalog.filter((preset) => preset.custom);
  const builtinProviderPresets = providerPresetCatalog.length - customProviderPresets.length;
  const providerPresetTags = new Set(providerPresetCatalog.flatMap((preset) => preset.tags ?? []));
  const providerConfigAudit = input.providerConfigAudit ?? null;
  const providerHealthHistory = input.providerHealthHistory ?? [];
  const resourceLens = resourceLensItems(syncPackageResourceItems(sync));
  const resourceLensSummary = resourceLensStats(resourceLens);
  const packageIssues = [...(sync?.warnings ?? []), ...(sync?.skipped ?? []).map((item) => `skipped: ${item}`)];
  const instanceLines = input.instances.length
    ? input.instances.map((instance) => {
        const history = input.historyByInstance[instance.id] ?? instance.historyStatus;
        const usage = usageByInstance[instance.id];
        const markerPath = history?.syncPackageApplied ? syncPackageAppliedMarkerPath(instance, history) : 'none';
        const packageFreshness = syncPackageAppliedFreshness(history, sync);
        const readiness = cloneReadinessSummary(instance, history, sync);
        const usageCost = usage ? sessionUsageCostSummary(usage) : null;
        return [
          `- ${instance.name || instance.id}`,
          `readiness=${readiness.label} (${readiness.detail})`,
          `running=${instance.running ? 'yes' : 'no'}`,
          `sync=${history?.syncMode ?? 'unknown'}`,
          `threads=${history?.threadCount ?? 0}`,
          `mismatch=${history?.mismatchCount ?? 0}`,
          `auth=${history?.authOk ? 'ok' : 'warning'}`,
          `provider=${history?.currentProvider ?? 'unknown'}`,
          `modelCatalog=${instance.modelCatalogEnabled ? `${instance.modelCatalogCount ?? 0} models` : 'none'}`,
          `launchScript=${instance.launchScript?.trim() ? 'configured' : 'none'}`,
          `goalPursuit=${instance.goalEnabled ? 'configured' : 'none'}`,
          `promptPack=${instance.promptPackEnabled ? 'configured' : 'none'}`,
          `backup=${formatShortPath(history?.lastBackupPath)}`,
          `package=${formatTime(history?.syncPackageApplied?.appliedAt)}`,
          `packageMarker=${markerPath}`,
          `packageResources=${syncPackageAppliedResourceRatio(history?.syncPackageApplied)}`,
          `packageFreshness=${packageFreshness.label}`,
          `usage=${usage ? `${usage.eventCount} events / ${usage.totalTokens} tokens / ${usage.scannedFiles} files` : 'not scanned'}`,
          `usageCost=${usageCost ? `${formatUsd(usageCost.totalCostUsd)} estimated / priced=${usageCost.pricedModels} / unpriced=${usageCost.unpricedModels}` : 'not estimated'}`,
        ].join(' | ');
      })
    : ['- no managed Codex clones'];
  const latestLog = diagnostics?.latestLogTail
    ? diagnostics.latestLogTail.split(/\r?\n/).filter(Boolean).slice(-20).join('\n')
    : text.diagnosticsNoLogs;

  return [
    '# Codex Clone Launcher Diagnostics',
    `generatedAt: ${new Date().toISOString()}`,
    `appVersion: ${input.appVersion || 'unknown'}`,
    `launcherPid: ${diagnostics?.launcherPid ?? 'unknown'}`,
    `codexAppPath: ${input.codexAppPath || diagnostics?.codexAppPath || 'unknown'}`,
    `codexAppPathExists: ${diagnostics?.codexAppPathExists ? 'yes' : 'no/unknown'}`,
    `logDir: ${diagnostics?.logDir ?? 'unknown'}`,
    `latestLogFile: ${diagnostics?.latestLogFile ?? 'none'}`,
    '',
    '## Sync Package',
    `exists: ${sync?.exists ? 'yes' : 'no'}`,
    `state: ${syncPackageStateLabel(sync)}`,
    `stale: ${sync?.stale ? 'yes' : 'no'}`,
    `packagePath: ${sync?.packagePath ?? 'unknown'}`,
    `manifestPath: ${sync?.manifestPath ?? 'unknown'}`,
    `source: ${sync?.source ?? 'unknown'}`,
    `createdAt: ${formatTime(sync?.createdAt)}`,
    `sourceModifiedAt: ${formatTime(sync?.sourceModifiedAt)}`,
    `files: ${sync?.fileCount ?? 0}`,
    `directories: ${sync?.directoryCount ?? 0}`,
    `bytes: ${sync?.copiedBytes ?? 0} (${formatBytes(sync?.copiedBytes ?? 0)})`,
    `entries: ${sync?.entries?.length ?? 0}`,
    `preflight: ${preflight?.status ?? 'not checked'} | ready=${preflight?.readyToApply ? 'yes' : 'no'} | errors=${preflight?.errorCount ?? 0} | warnings=${preflight?.warningCount ?? 0}`,
    ...(sync?.resources?.length
      ? [
          'resources:',
          ...sync.resources.map(
            (resource) =>
              `- ${resource.label}: ${resource.status} | files=${resource.fileCount} | dirs=${resource.directoryCount} | bytes=${resource.bytes} | missing=${resource.missing.length} | errors=${resource.errors.length} | items=${(resource.items ?? []).join(', ') || 'none'}`,
          ),
        ]
      : []),
    `issues: ${packageIssues.length ? packageIssues.join(' / ') : 'none'}`,
    '',
    '## Sync Package Backups',
    `count: ${backups.length}`,
    ...(backups.length
      ? backups.slice(0, 8).map(
          (backup) =>
            `- ${backup.id} | status=${backup.status} | backup=${formatTime(backup.backupCreatedAt)} | package=${formatTime(backup.packageCreatedAt)} | resources=${backup.readyResourceCount}/${backup.resourceCount} | bytes=${backup.copiedBytes} | path=${backup.backupPath}`,
        )
      : ['- no sync package backups']),
    '',
    '## Sync Package Preflight',
    `status: ${preflight?.status ?? 'not checked'}`,
    `readyToApply: ${preflight?.readyToApply ? 'yes' : 'no'}`,
    `checkedAt: ${formatTime(preflight?.checkedAt)}`,
    `unsafePaths: ${(preflight?.unsafePaths ?? []).join(', ') || 'none'}`,
    ...((preflight?.checks ?? []).length
      ? (preflight?.checks ?? []).map((check) => `- ${check.status}: ${check.label} | ${check.detail}`)
      : ['- no preflight checks have been run']),
    '',
    '## MCP Skills Resource Lens',
    `resources: ${resourceLensSummary.total}`,
    `ready: ${resourceLensSummary.ready}`,
    `issues: ${resourceLensSummary.issues}`,
    `inventoryItems: ${resourceLensSummary.inventory}`,
    ...(resourceLens.length
      ? resourceLens.map(
          (resource) =>
            `- ${resource.label} | id=${resource.id || 'legacy'} | status=${resource.status ?? 'unknown'} | apply=${resource.applyMode || 'unknown'} | inventory=${resource.inventory?.length ? resource.inventory.join(', ') : 'none'}`,
        )
      : ['- no MCP/Skills focused resources']),
    '',
    '## Clone Health',
    `total: ${input.instances.length}`,
    `running: ${health.running}`,
    `checked: ${health.checked}`,
    `mismatch: ${health.mismatch}`,
    `warnings: ${health.warnings}`,
    ...instanceLines,
    '',
    '## Session Usage Cost Lens',
    ...(Object.entries(usageByInstance).length
      ? Object.entries(usageByInstance).flatMap(([instanceId, usage]) => {
          const cost = sessionUsageCostSummary(usage);
          return [
            `- ${instanceId} | estimated=${formatUsd(cost.totalCostUsd)} | pricedModels=${cost.pricedModels} | unpricedModels=${cost.unpricedModels} | billableInput=${cost.billableInputTokens} | cachedInput=${cost.cachedInputTokens} | output=${cost.outputTokens} | cacheHitRate=${Math.round(cost.cacheHitRate * 100)}%`,
            ...cost.byModel.slice(0, 8).map(
              (model) =>
                `  model=${model.model} | cost=${model.priced ? formatUsd(model.totalCostUsd) : 'unpriced'} | pricing=${model.pricingLabel} | input=${model.billableInputTokens} | cache=${model.cachedInputTokens} | output=${model.outputTokens}`,
            ),
          ];
        })
      : ['- no scanned session usage']),
    '',
    ...gitWorktreeDiagnosticsLines({
      form: input.gitWorktreeForm,
      defaults: input.gitWorktreeDefaults,
      result: input.gitWorktreeResult,
    }),
    '',
    '## Provider Presets',
    `presets: ${providerPresetCatalog.length}`,
    `builtin: ${builtinProviderPresets}`,
    `custom: ${customProviderPresets.length}`,
    `tags: ${providerPresetTags.size}`,
    ...(customProviderPresets.length
      ? customProviderPresets.map(
          (preset) =>
            `- ${preset.label} | provider=${preset.providerId} | baseUrl=${preset.baseUrl || 'empty'} | model=${preset.model} | tags=${(preset.tags ?? []).join(', ') || 'none'}`,
        )
      : ['- no custom provider presets']),
    '',
    '## Provider Health History',
    `records: ${providerHealthHistory.length}`,
    ...(providerHealthHistory.length
      ? providerHealthHistory.slice(0, 12).map(
          (record) =>
            `- ${record.providerName} | ${record.model} | ${record.normalizedBaseUrl || record.baseUrl} | ${providerHealthLabel(record)} | protocol=${record.protocol} | http=${record.httpStatus ?? 'unknown'} | latencyMs=${record.latencyMs} | testedAt=${new Date(record.testedAt).toISOString()} | message=${record.message || 'none'}`,
        )
      : ['- no provider health records']),
    '',
    '## Provider Test',
    `status: ${input.providerTestResult?.status ?? 'not tested'}`,
    `codexReady: ${input.providerTestResult?.codexReady ? 'yes' : 'no/unknown'}`,
    `protocol: ${input.providerTestResult?.protocol ?? 'unknown'}`,
    `endpoint: ${input.providerTestResult?.endpoint ?? 'unknown'}`,
    `httpStatus: ${input.providerTestResult?.httpStatus ?? 'unknown'}`,
    `ttfbMs: ${input.providerTestResult?.ttfbMs ?? 'unknown'}`,
    `latencyMs: ${input.providerTestResult?.latencyMs ?? 'unknown'}`,
    `message: ${input.providerTestResult?.message ?? 'none'}`,
    '',
    '## Provider Config Audit',
    `status: ${providerConfigAudit?.label ?? 'not evaluated'}`,
    `detail: ${providerConfigAudit?.detail ?? 'none'}`,
    `normalizedBaseUrl: ${providerConfigAudit?.normalizedBaseUrl || 'empty'}`,
    `blocking: ${providerConfigAudit?.blockingCount ?? 0}`,
    `warnings: ${providerConfigAudit?.warningCount ?? 0}`,
    `duplicatePresetCount: ${providerConfigAudit?.duplicatePresetCount ?? 0}`,
    `similarPresetCount: ${providerConfigAudit?.similarPresetCount ?? 0}`,
    ...(providerConfigAudit?.checks?.length
      ? providerConfigAudit.checks.map((check) => `- [${check.status}] ${check.label}: ${check.detail}`)
      : ['- no audit checks']),
    '',
    '## Provider Models',
    `status: ${input.providerModelsResult?.status ?? 'not fetched'}`,
    `endpoint: ${input.providerModelsResult?.endpoint ?? 'unknown'}`,
    `httpStatus: ${input.providerModelsResult?.httpStatus ?? 'unknown'}`,
    `latencyMs: ${input.providerModelsResult?.latencyMs ?? 'unknown'}`,
    `modelCount: ${input.providerModelsResult?.modelCount ?? 0}`,
    `cloneModelCatalog: ${input.modelCatalogEnabled ? 'enabled' : 'disabled'}`,
    `cloneModelCatalogCount: ${input.modelCatalogModels?.length ?? 0}`,
    `clonePromptPack: ${input.promptPackEnabled ? 'enabled' : 'disabled'}`,
    `clonePromptPackChars: ${input.promptPackChars ?? 0}`,
    `message: ${input.providerModelsResult?.message ?? 'none'}`,
    ...(input.providerModelsResult?.models?.length
      ? input.providerModelsResult.models.slice(0, 40).map((model) => `- ${model}`)
      : ['- no fetched models']),
    '',
    '## Latest Log Tail',
    latestLog,
  ].join('\n');
}

function busyMessage(label: string): string {
  if (label === 'codex-sync-package-extract') return text.busyExtracting;
  if (label === 'codex-sync-package-preflight') return 'Checking sync package preflight...';
  if (label.startsWith('codex-sync-package-restore-')) return '正在从备份恢复当前同步包...';
  if (label === 'diagnostics-refresh') return text.diagnosticsRefresh;
  if (label.startsWith('codex-history-repair-')) return text.busyRepairing;
  if (label.startsWith('codex-history-export-')) return text.historyExportMarkdown;
  if (label.startsWith('codex-clone-snapshot-export-')) return '正在导出分身能力快照...';
  if (label.startsWith('codex-clone-snapshot-use-')) return '正在套用分身能力快照...';
  if (label.startsWith('codex-clone-capabilities-')) return '正在保存分身目标...';
  if (label.startsWith('codex-session-usage-')) return '正在统计分身会话 token 用量...';
  if (label.startsWith('codex-history-bulk-')) return text.busyBulkHealth;
  if (label.startsWith('codex-start-')) return text.busyStarting;
  if (label.startsWith('codex-open-zed-')) return text.busyOpeningZed;
  if (label === 'provider-model-fetch') return text.providerModelsFetching;
  if (label === 'provider-connection-test') return text.providerTesting;
  if (label.startsWith('git-worktree-')) return text.busyWorktree;
  if (label === 'app-update-check') return text.updateChecking;
  if (label === 'app-update-auto-check') return text.updateChecking;
  if (label === 'app-update-install') return text.updateInstalling;
  return text.busyWorking;
}

function visibleInstances(instances: InstanceProfile[]): InstanceProfile[] {
  return instances.filter((instance) => !instance.isDefault);
}

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [showOfficialPanel, setShowOfficialPanel] = useState(false);
  const [codexForm, setCodexForm] = useState<CloneFormValues>(() =>
    defaultCloneValues('Codex 工作分身'),
  );
  const [providerTestResult, setProviderTestResult] = useState<CodexProviderConnectionTestResult | null>(null);
  const [providerModelsResult, setProviderModelsResult] = useState<CodexProviderModelsFetchResult | null>(null);
  const [gitWorktreeForm, setGitWorktreeForm] = useState<GitWorktreeFormValues>(() =>
    defaultGitWorktreeValues(),
  );
  const [gitWorktreeDefaults, setGitWorktreeDefaults] = useState<GitWorktreeDefaults | null>(null);
  const [gitWorktreeResult, setGitWorktreeResult] = useState<GitWorktreeCreateResult | null>(null);
  const [officialAccounts, setOfficialAccounts] = useState<CodexAccount[]>([]);
  const [officialAccountId, setOfficialAccountId] = useState('');
  const [pendingLoginId, setPendingLoginId] = useState('');
  const [codexInstances, setCodexInstances] = useState<InstanceProfile[]>([]);
  const [cloneCapabilityDrafts, setCloneCapabilityDrafts] = useState<Record<string, CloneCapabilityEditDraft>>({});
  const [historyByInstance, setHistoryByInstance] = useState<Record<string, CodexHistoryStatus>>({});
  const [syncPackage, setSyncPackage] = useState<CodexSyncPackageStatus | null>(null);
  const [syncPackageBackups, setSyncPackageBackups] = useState<CodexSyncPackageBackupSummary[]>([]);
  const [syncPackagePreflight, setSyncPackagePreflight] = useState<CodexSyncPackagePreflightReport | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot | null>(null);
  const [codexAppPath, setCodexAppPath] = useState('');
  const [appVersion, setAppVersion] = useState('');
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ message: text.updateIdle });
  const [autoCheckUpdates, setAutoCheckUpdates] = useState(() =>
    readLocalStorageBoolean(UPDATE_AUTO_CHECK_KEY, false),
  );
  const [skippedUpdateVersion, setSkippedUpdateVersion] = useState(
    () => localStorage.getItem(UPDATE_SKIPPED_VERSION_KEY) ?? '',
  );
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readThemeMode());
  const [customProviderPresets] = useState<ProviderPreset[]>(() =>
    readCustomProviderPresets(),
  );
  const [providerHealthHistory, setProviderHealthHistory] = useState<ProviderHealthRecord[]>(() =>
    readProviderHealthHistory(),
  );
  const [diagnosticsReport, setDiagnosticsReport] = useState('');
  const [exportDirByInstance, setExportDirByInstance] = useState<Record<string, string>>({});
  const [sessionsByInstance, setSessionsByInstance] = useState<Record<string, CodexSessionSummary[]>>({});
  const [usageByInstance, setUsageByInstance] = useState<Record<string, CodexSessionUsageSummary>>({});
  const [sessionSearchQuery, setSessionSearchQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<Message | null>(null);
  const autoCheckStarted = useRef(false);
  const cloneSnapshotImportRef = useRef<HTMLInputElement | null>(null);

  const codexCloneList = useMemo(() => visibleInstances(codexInstances), [codexInstances]);
  const providerPresetCatalog = useMemo(
    () => [...providerPresets, ...customProviderPresets],
    [customProviderPresets],
  );
  const officialAccountOptions = useMemo(
    () => officialAccounts.filter((account) => !isApiKeyAccount(account)),
    [officialAccounts],
  );
  const modelCatalogModels = useMemo(
    () => cloneModelCatalogModels(codexForm.model, providerModelsResult),
    [codexForm.model, providerModelsResult],
  );
  const providerConfigAudit = useMemo(
    () =>
      buildProviderConfigAudit({
        form: codexForm,
        presets: providerPresetCatalog,
        providerTestResult,
        providerModelsResult,
        modelCatalogModels,
      }),
    [codexForm, providerPresetCatalog, providerTestResult, providerModelsResult, modelCatalogModels],
  );

  function showMessage(tone: Message['tone'], value: string) {
    setMessage({ tone, text: value });
  }

  function updateCodexForm(patch: Partial<CloneFormValues>) {
    if (
      Object.prototype.hasOwnProperty.call(patch, 'baseUrl') ||
      Object.prototype.hasOwnProperty.call(patch, 'apiKey') ||
      Object.prototype.hasOwnProperty.call(patch, 'model')
    ) {
      setProviderTestResult(null);
    }
    if (
      Object.prototype.hasOwnProperty.call(patch, 'baseUrl') ||
      Object.prototype.hasOwnProperty.call(patch, 'apiKey')
    ) {
      setProviderModelsResult(null);
    }
    setCodexForm((current) => ({ ...current, ...patch }));
  }

  function updateGitWorktreeForm(patch: Partial<GitWorktreeFormValues>) {
    setGitWorktreeForm((current) => ({ ...current, ...patch }));
  }

  function rememberProviderHealth(record: ProviderHealthRecord) {
    setProviderHealthHistory((current) => {
      const next = compactProviderHealthHistory([record, ...current]);
      writeProviderHealthHistory(next);
      return next;
    });
  }

  function updateThemeMode(mode: ThemeMode) {
    setThemeMode(mode);
    localStorage.setItem(THEME_MODE_KEY, mode);
    applyThemeMode(mode);
    showMessage('success', `${text.themeUpdated}: ${themeModeLabel(mode)}`);
  }

  function applyCloneCapabilitySnapshot(snapshot: CloneCapabilitySnapshot, sourceLabel: string) {
    const model = snapshot.provider.model?.trim() || DEFAULT_MODEL;
    const catalogModels = snapshot.capabilities.modelCatalogModels;
    setProviderTestResult(null);
    setProviderModelsResult(
      catalogModels.length
        ? {
            ok: true,
            status: 'snapshot',
            endpoint: 'clone capability snapshot',
            httpStatus: null,
            latencyMs: 0,
            modelCount: catalogModels.length,
            models: catalogModels,
            message: '来自分身能力快照；不包含 API Key。',
            responsePreview: null,
          }
        : null,
    );
    setCodexForm((current) => ({
      ...current,
      name: `${snapshot.source.instanceName || current.name || 'Codex 分身'} 复制`,
      baseUrl: snapshot.provider.baseUrl?.trim() || '',
      apiKey: '',
      model,
      modelCatalogEnabled: snapshot.capabilities.modelCatalogEnabled && catalogModels.length > 0,
      providerId: snapshot.provider.providerId?.trim() || DEFAULT_PROVIDER_ID,
      providerName: snapshot.provider.providerName?.trim() || DEFAULT_PROVIDER_NAME,
      workingDir: snapshot.source.workingDir?.trim() || '',
      launchScript: '',
      goalEnabled: snapshot.capabilities.goalEnabled && Boolean(snapshot.capabilities.goal?.trim()),
      goalText: snapshot.capabilities.goal?.trim() || '',
      promptPackEnabled:
        snapshot.capabilities.promptPackEnabled && Boolean(snapshot.capabilities.promptPack?.trim()),
      promptPackText: snapshot.capabilities.promptPack?.trim() || text.promptPackDefault,
    }));
    setShowOfficialPanel(snapshot.provider.authType === 'officialAccount');
    setPage('codexCreate');
    const warnings = snapshot.warnings.length ? `；${snapshot.warnings.length} 条提示` : '';
    showMessage('success', `${text.cloneSnapshotImported}: ${sourceLabel}；API Key 需手动填写${warnings}`);
  }

  async function exportCloneCapabilitySnapshot(instanceId: string) {
    await withBusy(`codex-clone-snapshot-export-${instanceId}`, async () => {
      const exported = await invoke<CloneCapabilitySnapshotExportResult>(
        'codex_export_clone_capability_snapshot',
        { instanceId },
      );
      showMessage(
        'success',
        `${text.cloneSnapshotExported}: ${exported.snapshot.source.instanceName} -> ${exported.exportedPath}`,
      );
    });
  }

  async function useCloneCapabilitySnapshot(instanceId: string) {
    await withBusy(`codex-clone-snapshot-use-${instanceId}`, async () => {
      const exported = await invoke<CloneCapabilitySnapshotExportResult>(
        'codex_export_clone_capability_snapshot',
        { instanceId },
      );
      applyCloneCapabilitySnapshot(exported.snapshot, exported.snapshot.source.instanceName);
    });
  }

  function startCloneCapabilityEdit(instance: InstanceProfile) {
    setCloneCapabilityDrafts((current) => ({
      ...current,
      [instance.id]: current[instance.id] ?? {
        goalEnabled: Boolean(instance.goalEnabled),
        goalText: instance.goal?.trim() || '',
        promptPackEnabled: Boolean(instance.promptPackEnabled),
        promptPackText: instance.promptPack?.trim() || text.promptPackDefault,
      },
    }));
  }

  function updateCloneCapabilityDraft(instanceId: string, patch: Partial<CloneCapabilityEditDraft>) {
    setCloneCapabilityDrafts((current) => {
      const existing = current[instanceId];
      if (!existing) return current;
      return {
        ...current,
        [instanceId]: { ...existing, ...patch },
      };
    });
  }

  function cancelCloneCapabilityEdit(instanceId: string) {
    setCloneCapabilityDrafts((current) => {
      const next = { ...current };
      delete next[instanceId];
      return next;
    });
  }

  async function saveCloneCapabilities(instanceId: string) {
    const draft = cloneCapabilityDrafts[instanceId];
    if (!draft) return;
    await withBusy(`codex-clone-capabilities-${instanceId}`, async () => {
      if (draft.goalEnabled && !draft.goalText.trim()) {
        throw new Error(text.goalPursuitRequired);
      }
      const updated = await invoke<InstanceProfile>('codex_update_clone_capabilities', {
        input: {
          instanceId,
          goalEnabled: draft.goalEnabled,
          goal: draft.goalEnabled ? draft.goalText.trim() : null,
        },
      });
      setCodexInstances((current) => current.map((instance) => (instance.id === instanceId ? updated : instance)));
      cancelCloneCapabilityEdit(instanceId);
      await refreshCodexInstances();
      showMessage('success', `${text.cloneCapabilitySaved}: ${updated.name || updated.id}`);
    });
  }

  function openCloneSnapshotImport() {
    cloneSnapshotImportRef.current?.click();
  }

  async function importCloneCapabilitySnapshotFromFile(file: File) {
    try {
      const snapshot = parseCloneCapabilitySnapshot(await file.text());
      applyCloneCapabilitySnapshot(snapshot, file.name);
    } catch (error) {
      reportError(error, { area: 'clone-capability-snapshot', action: 'import' });
      showMessage('error', `${text.cloneSnapshotImportFailed}: ${String(error)}`);
    }
  }

  function handleCloneSnapshotImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) void importCloneCapabilitySnapshotFromFile(file);
  }

  async function fetchProviderModels() {
    await withBusy('provider-model-fetch', async () => {
      const baseUrl = codexForm.baseUrl.trim();
      const apiKey = codexForm.apiKey.trim();
      if (!baseUrl) throw new Error('请先填写 Base URL');
      const result = await invoke<CodexProviderModelsFetchResult>('codex_fetch_provider_models', {
        input: { baseUrl, apiKey },
      });
      setProviderModelsResult(result);
      if (result.ok) {
        setCodexForm((current) => ({ ...current, modelCatalogEnabled: true }));
      }
      showMessage(
        result.ok ? 'success' : 'error',
        `${result.ok ? text.providerModelsFetched : text.providerModelsEmpty}: ${result.message}`,
      );
    });
  }

  async function testProviderConnection() {
    await withBusy('provider-connection-test', async () => {
      const baseUrl = codexForm.baseUrl.trim();
      const apiKey = codexForm.apiKey.trim();
      const model = codexForm.model.trim();
      if (!baseUrl || !apiKey) throw new Error(text.requiredApi);
      if (!model) throw new Error(text.requiredModel);
      const result = await invoke<CodexProviderConnectionTestResult>('codex_test_provider_connection', {
        input: { baseUrl, apiKey, model },
      });
      setProviderTestResult(result);
      rememberProviderHealth(providerHealthRecordFromTest({ form: codexForm, result }));
      showMessage(result.codexReady ? 'success' : 'error', `${providerTestStatusLabel(result)}: ${result.message}`);
    });
  }

  async function refreshCodexAccounts() {
    const accounts = await invoke<CodexAccount[]>('list_codex_accounts');
    setOfficialAccounts(accounts);
    const firstOfficial = accounts.find((account) => !isApiKeyAccount(account));
    if (firstOfficial && !officialAccountId) {
      setOfficialAccountId(firstOfficial.id);
    }
  }

  async function refreshCodexInstances() {
    const instances = await invoke<InstanceProfile[]>('codex_list_instances');
    setCodexInstances(instances);
    setHistoryByInstance((current) => {
      const next = { ...current };
      for (const instance of instances) {
        if (instance.historyStatus) next[instance.id] = instance.historyStatus;
      }
      return next;
    });
  }

  async function refreshSyncPackage() {
    const status = await invoke<CodexSyncPackageStatus>('codex_sync_package_status');
    setSyncPackage(status);
  }

  async function refreshSyncPackageBackups() {
    const backups = await invoke<CodexSyncPackageBackupSummary[]>('codex_sync_package_backups');
    setSyncPackageBackups(backups);
  }

  async function refreshSyncPackagePreflight() {
    const preflight = await invoke<CodexSyncPackagePreflightReport>('codex_sync_package_preflight');
    setSyncPackagePreflight(preflight);
    return preflight;
  }

  async function refreshDiagnostics() {
    const snapshot = await invoke<DiagnosticsSnapshot>('get_diagnostics_snapshot', { lineLimit: 80 });
    setDiagnostics(snapshot);
  }

  async function requireSyncPackageForApply() {
    const status = await invoke<CodexSyncPackageStatus>('codex_sync_package_status');
    setSyncPackage(status);
    const blocker = syncPackageApplyBlocker(status);
    if (blocker) throw new Error(blocker);
    const preflight = await refreshSyncPackagePreflight();
    const preflightBlocker = syncPackagePreflightBlocker(preflight);
    if (preflightBlocker) throw new Error(preflightBlocker);
    return status;
  }

  async function refreshConfig() {
    const config = await invoke<GeneralConfig>('get_general_config');
    setCodexAppPath(config.codex_app_path || '');
  }

  async function refreshAppVersion() {
    setAppVersion(await getVersion());
  }

  async function refreshAll() {
    await Promise.allSettled([
      refreshCodexAccounts(),
      refreshCodexInstances(),
      refreshSyncPackage(),
      refreshSyncPackageBackups(),
      refreshSyncPackagePreflight(),
      refreshDiagnostics(),
      refreshConfig(),
      refreshAppVersion(),
    ]);
  }

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    applyThemeMode(themeMode);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => {
      if (readThemeMode() === 'system') applyThemeMode('system');
    };
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [themeMode]);

  useEffect(() => {
    localStorage.setItem(UPDATE_AUTO_CHECK_KEY, String(autoCheckUpdates));
    if (!autoCheckUpdates || autoCheckStarted.current) return;
    autoCheckStarted.current = true;
    const timer = window.setTimeout(() => {
      void withBusy('app-update-auto-check', async () => {
        await resolveAppUpdate({ silentNoUpdate: true });
      });
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [autoCheckUpdates]);

  async function withBusy(label: string, task: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setMessage(null);
    try {
      await task();
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function createCodexClone(authType: AuthType = 'apiKey') {
    await withBusy('create-codex', async () => {
      const name = codexForm.name.trim();
      if (!name) throw new Error(text.requiredName);
      if (authType === 'apiKey' && (!codexForm.baseUrl.trim() || !codexForm.apiKey.trim())) {
        throw new Error(text.requiredApi);
      }
      if (authType === 'officialAccount' && !officialAccountId) {
        throw new Error(text.requiredOfficial);
      }
      if (codexForm.inheritLocalData) {
        await requireSyncPackageForApply();
      }
      if (codexForm.goalEnabled && !codexForm.goalText.trim()) {
        throw new Error(text.goalPursuitRequired);
      }
      if (codexForm.promptPackEnabled && !codexForm.promptPackText.trim()) {
        throw new Error(text.promptPackRequired);
      }

      const input: Record<string, unknown> = {
        name,
        authType,
        launchAfterCreate: codexForm.launchAfterCreate,
        inheritLocalData: codexForm.inheritLocalData,
        model: codexForm.model.trim() || DEFAULT_MODEL,
        modelCatalogEnabled: codexForm.modelCatalogEnabled,
        modelCatalogModels: codexForm.modelCatalogEnabled ? modelCatalogModels : [],
        workingDir: codexForm.workingDir.trim() || null,
        launchScript: codexForm.launchScript.trim() || null,
        goalEnabled: codexForm.goalEnabled,
        goal: codexForm.goalEnabled ? codexForm.goalText.trim() : null,
        promptPackEnabled: codexForm.promptPackEnabled,
        promptPack: codexForm.promptPackEnabled ? codexForm.promptPackText.trim() : null,
      };

      if (authType === 'apiKey') {
        input.apiKeyConfig = {
          apiKey: codexForm.apiKey.trim(),
          baseUrl: codexForm.baseUrl.trim(),
          providerId: codexForm.providerId.trim() || DEFAULT_PROVIDER_ID,
          providerName: codexForm.providerName.trim() || DEFAULT_PROVIDER_NAME,
        };
      } else {
        input.officialAccountId = officialAccountId;
      }

      const instance = await invoke<InstanceProfile>('codex_create_clone_and_launch', { input });
      await refreshCodexInstances();
      showMessage(
        'success',
        `${codexForm.launchAfterCreate ? text.createdLaunched : text.created}: ${creationHistoryMessage(instance)}`,
      );
      setPage('codexList');
    });
  }

  async function startOfficialLogin() {
    await withBusy('oauth-start', async () => {
      const response = await invoke<OAuthStartResponse>('codex_oauth_login_start');
      const loginId = response.loginId ?? response.login_id ?? '';
      const authUrl = response.authUrl ?? response.auth_url ?? '';
      if (!loginId || !authUrl) {
        throw new Error('OAuth start response missing loginId/authUrl');
      }
      setPendingLoginId(loginId);
      await openUrl(authUrl);
      showMessage('success', text.oauthOpened);
    });
  }

  async function completeOfficialLogin() {
    if (!pendingLoginId) {
      showMessage('error', text.noPendingLogin);
      return;
    }
    await withBusy('oauth-complete', async () => {
      const account = await invoke<CodexAccount>('codex_oauth_login_completed', {
        loginId: pendingLoginId,
      });
      setPendingLoginId('');
      await refreshCodexAccounts();
      setOfficialAccountId(account.id);
      showMessage('success', `${text.officialConnected}: ${accountLabel(account)}`);
    });
  }

  async function startCodexInstance(instanceId: string) {
    await withBusy(`codex-start-${instanceId}`, async () => {
      await invoke('codex_start_instance', { instanceId });
      await refreshCodexInstances();
      showMessage('success', text.codexStarted);
    });
  }

  async function stopCodexInstance(instanceId: string) {
    await withBusy(`codex-stop-${instanceId}`, async () => {
      await invoke('codex_stop_instance', { instanceId });
      await refreshCodexInstances();
      showMessage('success', text.codexStopped);
    });
  }

  async function deleteCodexInstance(instanceId: string) {
    await withBusy(`codex-delete-${instanceId}`, async () => {
      await invoke('codex_delete_instance', { instanceId });
      await refreshCodexInstances();
      showMessage('success', text.codexDeleted);
    });
  }

  async function refreshCodexHistory(instanceId: string) {
    await withBusy(`codex-history-refresh-${instanceId}`, async () => {
      const status = await invoke<CodexHistoryStatus>('codex_history_status', { instanceId });
      setHistoryByInstance((current) => ({ ...current, [instanceId]: status }));
      showMessage('success', `记忆状态：${historySummary(status)}`);
    });
  }

  async function verifyCodexHistory(instanceId: string) {
    await withBusy(`codex-history-verify-${instanceId}`, async () => {
      const status = await invoke<CodexHistoryStatus>('codex_history_verify', { instanceId });
      setHistoryByInstance((current) => ({ ...current, [instanceId]: status }));
      showMessage(status.ok ? 'success' : 'error', `记忆校验：${historySummary(status)}`);
    });
  }

  async function extractCodexSyncPackage() {
    await withBusy('codex-sync-package-extract', async () => {
      const status = await invoke<CodexSyncPackageStatus>('codex_extract_sync_package');
      setSyncPackage(status);
      await refreshSyncPackageBackups();
      await refreshSyncPackagePreflight();
      showMessage(
        'success',
        `${text.syncPackageExtracted}: ${status.fileCount} 文件 / ${status.directoryCount} 目录 / ${formatBytes(status.copiedBytes)}`,
      );
    });
  }

  async function restoreSyncPackageBackup(backupId: string) {
    await withBusy(`codex-sync-package-restore-${backupId}`, async () => {
      const status = await invoke<CodexSyncPackageStatus>('codex_restore_sync_package_backup', { backupId });
      setSyncPackage(status);
      await refreshSyncPackageBackups();
      await refreshSyncPackagePreflight();
      showMessage(
        'success',
        `${text.syncPackageRestoredBackup}: ${backupId} / ${status.fileCount} 文件 / ${status.directoryCount} 目录`,
      );
    });
  }

  async function refreshCodexSyncPackageStatus() {
    await withBusy('codex-sync-package-status', async () => {
      await refreshSyncPackage();
      await refreshSyncPackageBackups();
      await refreshSyncPackagePreflight();
      showMessage('success', text.syncPackageStatusRefreshed);
    });
  }

  async function refreshCodexSyncPackagePreflight() {
    await withBusy('codex-sync-package-preflight', async () => {
      const preflight = await refreshSyncPackagePreflight();
      showMessage('success', `Preflight: ${preflight.status} / errors ${preflight.errorCount} / warnings ${preflight.warningCount}`);
    });
  }

  async function refreshDiagnosticsStatus() {
    await withBusy('diagnostics-refresh', async () => {
      await refreshDiagnostics();
      showMessage('success', text.diagnosticsRefresh);
    });
  }

  async function copyDiagnosticsReport() {
    const report = buildDiagnosticsReport({
      diagnostics,
      syncPackage,
      syncPackageBackups,
      syncPackagePreflight,
      gitWorktreeForm,
      gitWorktreeDefaults,
      gitWorktreeResult,
      providerTestResult,
      providerModelsResult,
      providerConfigAudit,
      modelCatalogEnabled: codexForm.modelCatalogEnabled,
      modelCatalogModels,
      promptPackEnabled: codexForm.promptPackEnabled,
      promptPackChars: codexForm.promptPackText.trim().length,
      instances: codexCloneList,
      historyByInstance,
      usageByInstance,
      providerPresetCatalog,
      providerHealthHistory,
      codexAppPath,
      appVersion,
    });
    setDiagnosticsReport(report);
    try {
      await navigator.clipboard.writeText(report);
      showMessage('success', text.diagnosticsReportCopied);
    } catch (error) {
      reportError(error, { area: 'diagnostics', action: 'copy-report' });
      showMessage('error', `${text.diagnosticsReportCopyFailed}: ${String(error)}`);
    }
  }

  async function copyGitWorktreeDiagnosticsReport() {
    const report = buildGitWorktreeDiagnosticsReport({
      form: gitWorktreeForm,
      defaults: gitWorktreeDefaults,
      result: gitWorktreeResult,
      appVersion,
    });
    try {
      await navigator.clipboard.writeText(report);
      showMessage('success', text.worktreeDiagnosticsCopied);
    } catch (error) {
      reportError(error, { area: 'git-worktree', action: 'copy-diagnostics' });
      showMessage('error', `${text.diagnosticsReportCopyFailed}: ${String(error)}`);
    }
  }

  async function copySyncPackageResourceReport() {
    const report = buildSyncPackageResourceReport(syncPackage);
    try {
      await navigator.clipboard.writeText(report);
      showMessage('success', `${text.syncManifestTitle}: copied`);
    } catch (error) {
      reportError(error, { area: 'sync-package', action: 'copy-resource-report' });
      showMessage('error', `${text.diagnosticsReportCopyFailed}: ${String(error)}`);
    }
  }

  async function copyResourceLensReport() {
    const report = buildResourceLensReport(syncPackage);
    try {
      await navigator.clipboard.writeText(report);
      showMessage('success', text.resourceLensCopied);
    } catch (error) {
      reportError(error, { area: 'sync-package', action: 'copy-resource-lens-report' });
      showMessage('error', `${text.resourceLensCopyFailed}: ${String(error)}`);
    }
  }

  async function copySyncPackageBackupReport() {
    const report = buildSyncPackageBackupReport(syncPackageBackups);
    try {
      await navigator.clipboard.writeText(report);
      showMessage('success', `${text.syncPackageTitle}: backups copied`);
    } catch (error) {
      reportError(error, { area: 'sync-package', action: 'copy-backup-report' });
      showMessage('error', `${text.diagnosticsReportCopyFailed}: ${String(error)}`);
    }
  }

  async function copySyncPackagePreflightReport() {
    const report = buildSyncPackagePreflightReport(syncPackagePreflight);
    try {
      await navigator.clipboard.writeText(report);
      showMessage('success', `${text.syncPackageTitle}: preflight copied`);
    } catch (error) {
      reportError(error, { area: 'sync-package', action: 'copy-preflight-report' });
      showMessage('error', `${text.diagnosticsReportCopyFailed}: ${String(error)}`);
    }
  }

  async function repairCodexHistory(instanceId: string) {
    await withBusy(`codex-history-repair-${instanceId}`, async () => {
      await requireSyncPackageForApply();
      const result = await invoke<CodexHistorySyncResult>('codex_history_repair', { instanceId });
      const status = await invoke<CodexHistoryStatus>('codex_history_status', { instanceId });
      await refreshSyncPackage();
      setHistoryByInstance((current) => ({ ...current, [instanceId]: status }));
      const warningText = result.warnings?.length ? `；提示：${result.warnings[0]}` : '';
      const markerText = status.syncPackageApplied
        ? `；应用记录 ${syncPackageAppliedResourceRatio(status.syncPackageApplied)} / ${formatBytes(status.syncPackageApplied.copiedBytes ?? 0)}`
        : '';
      showMessage(
        result.ok ? 'success' : 'error',
        `已应用本体同步包，聊天 ${result.syncedThreads} 条源线程，对齐 ${result.updatedThreads} 行、${result.updatedSessionFiles} 个 session，mismatch ${result.mismatchCountAfter}${markerText}${warningText}`,
      );
    });
  }

  async function exportCodexHistoryMarkdown(instanceId: string) {
    await withBusy(`codex-history-export-${instanceId}`, async () => {
      const exported = await invoke<CodexSessionExportResult[]>(
        'codex_export_recent_sessions_markdown',
        { instanceId, limit: 5 },
      );
      const first = exported[0]?.exportedPath ?? '';
      const exportDir = first ? first.replace(/[\\/][^\\/]*$/, '') : '';
      if (exportDir) {
        setExportDirByInstance((current) => ({ ...current, [instanceId]: exportDir }));
      }
      showMessage(
        'success',
        `${text.historyExportedMarkdown}: ${exported.length} 个会话${first ? ` -> ${first}` : ''}`,
      );
    });
  }

  async function refreshCodexSessionList(instanceId: string) {
    await withBusy(`codex-session-list-${instanceId}`, async () => {
      const sessions = await invoke<CodexSessionSummary[]>('codex_list_recent_sessions', {
        instanceId,
        limit: 8,
      });
      setSessionsByInstance((current) => ({ ...current, [instanceId]: sessions }));
      showMessage('success', `${text.sessionReadSuccessPrefix}${sessions.length}${text.sessionReadSuccessSuffix}`);
    });
  }

  async function copyCodexSessionProjectDir(projectDir: string) {
    try {
      await navigator.clipboard.writeText(projectDir);
      showMessage('success', `${text.sessionProjectDirCopied}: ${projectDir}`);
    } catch (error) {
      reportError(error, { area: 'sessions', action: 'copy-project-dir' });
      showMessage('error', `${text.diagnosticsReportCopyFailed}: ${String(error)}`);
    }
  }

  async function refreshCodexSessionUsage(instanceId: string) {
    await withBusy(`codex-session-usage-${instanceId}`, async () => {
      const usage = await invoke<CodexSessionUsageSummary>('codex_scan_session_usage', {
        instanceId,
      });
      setUsageByInstance((current) => ({ ...current, [instanceId]: usage }));
      showMessage(
        'success',
        `${text.sessionUsageTitle}: ${usage.eventCount} ${text.sessionUsageEventsUnit} / ${formatTokenCount(usage.totalTokens)} ${text.sessionUsageTokensUnit} / ${usage.scannedFiles} ${text.sessionUsageFiles}`,
      );
    });
  }

  async function openCodexHistoryExportDir(instanceId: string) {
    const path = exportDirByInstance[instanceId];
    if (!path) return;
    try {
      await openPath(path);
    } catch (error) {
      showMessage('error', `${text.openPathFailed}: ${String(error)}`);
    }
  }

  async function openCodexInstanceInZed(instanceId: string) {
    await withBusy(`codex-open-zed-${instanceId}`, async () => {
      const result = await invoke<ZedOpenResult>('codex_open_instance_in_zed', { instanceId });
      showMessage('success', `${text.openZedDone}: ${result.mode} -> ${result.target}`);
    });
  }

  async function bulkRefreshCodexHistory() {
    await withBusy('codex-history-bulk-refresh', async () => {
      if (!codexCloneList.length) throw new Error(text.healthNoClones);
      const updates: Record<string, CodexHistoryStatus> = {};
      for (const instance of codexCloneList) {
        updates[instance.id] = await invoke<CodexHistoryStatus>('codex_history_status', {
          instanceId: instance.id,
        });
      }
      setHistoryByInstance((current) => ({ ...current, ...updates }));
      showMessage('success', `${text.healthBulkDone}: ${codexCloneList.length}`);
    });
  }

  async function bulkVerifyCodexHistory() {
    await withBusy('codex-history-bulk-verify', async () => {
      if (!codexCloneList.length) throw new Error(text.healthNoClones);
      const updates: Record<string, CodexHistoryStatus> = {};
      let okCount = 0;
      for (const instance of codexCloneList) {
        const status = await invoke<CodexHistoryStatus>('codex_history_verify', {
          instanceId: instance.id,
        });
        updates[instance.id] = status;
        if (status.ok) okCount += 1;
      }
      setHistoryByInstance((current) => ({ ...current, ...updates }));
      showMessage(
        okCount === codexCloneList.length ? 'success' : 'error',
        `${text.healthBulkDone}: ${okCount}/${codexCloneList.length} OK`,
      );
    });
  }

  async function bulkRepairCodexHistory() {
    await withBusy('codex-history-bulk-repair', async () => {
      if (!codexCloneList.length) throw new Error(text.healthNoClones);
      await requireSyncPackageForApply();
      const updates: Record<string, CodexHistoryStatus> = {};
      let okCount = 0;
      for (const instance of codexCloneList) {
        const result = await invoke<CodexHistorySyncResult>('codex_history_repair', {
          instanceId: instance.id,
        });
        const status = await invoke<CodexHistoryStatus>('codex_history_status', {
          instanceId: instance.id,
        });
        updates[instance.id] = status;
        if (result.ok && status.ok) okCount += 1;
      }
      await refreshSyncPackage();
      setHistoryByInstance((current) => ({ ...current, ...updates }));
      const appliedCount = Object.values(updates).filter((status) => status.syncPackageApplied).length;
      showMessage(
        okCount === codexCloneList.length ? 'success' : 'error',
        `${text.healthBulkDone}: ${okCount}/${codexCloneList.length} OK；应用记录 ${appliedCount}/${codexCloneList.length}`,
      );
    });
  }

  async function pickCodexAppPath() {
    const selected = await open({ multiple: false, directory: false });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (path) setCodexAppPath(path);
  }

  async function detectCodexAppPath() {
    await withBusy('detect-codex', async () => {
      const path = await invoke<string | null>('detect_app_path', { app: 'codex', force: true });
      setCodexAppPath(path || '');
      showMessage(path ? 'success' : 'error', path ? `${text.pathDetected}: ${path}` : text.pathMissing);
    });
  }

  async function saveSettings() {
    await withBusy('settings-save', async () => {
      await invoke('set_app_path', { app: 'codex', path: codexAppPath.trim() });
      showMessage('success', text.settingsSaved);
    });
  }

  async function pickGitWorktreeRepoDir() {
    const selected = await open({ multiple: false, directory: true });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (path) updateGitWorktreeForm({ repoDir: path });
  }

  async function pickGitWorktreeTargetDir() {
    const selected = await open({ multiple: false, directory: true });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (path) updateGitWorktreeForm({ worktreeDir: path });
  }

  async function detectGitWorktreeDefaults() {
    await withBusy('git-worktree-detect', async () => {
      const repoDir = gitWorktreeForm.repoDir.trim();
      if (!repoDir) throw new Error(text.worktreeRequiredRepo);
      const defaults = await invoke<GitWorktreeDefaults>('codex_git_worktree_defaults', {
        repoDir,
      });
      setGitWorktreeDefaults(defaults);
      setGitWorktreeResult(null);
      updateGitWorktreeForm({
        repoDir: defaults.repoDir,
        baseRemote: defaults.baseRemote,
        baseBranch: defaults.baseBranch,
        newBranch: defaults.suggestedBranch,
        worktreeDir: defaults.suggestedWorktreeDir,
      });
      showMessage('success', `${text.worktreeDetected}: ${defaults.baseRef}`);
    });
  }

  async function createGitWorktree() {
    await withBusy('git-worktree-create', async () => {
      const repoDir = gitWorktreeForm.repoDir.trim();
      const newBranch = gitWorktreeForm.newBranch.trim();
      const worktreeDir = gitWorktreeForm.worktreeDir.trim();
      if (!repoDir) throw new Error(text.worktreeRequiredRepo);
      if (!newBranch || !worktreeDir) throw new Error(text.worktreeRequiredBranch);
      const result = await invoke<GitWorktreeCreateResult>('codex_create_upstream_worktree', {
        input: {
          repoDir,
          baseRemote: gitWorktreeForm.baseRemote.trim() || 'upstream',
          baseBranch: gitWorktreeForm.baseBranch.trim() || 'main',
          newBranch,
          worktreeDir,
          fetchBeforeCreate: gitWorktreeForm.fetchBeforeCreate,
        },
      });
      setGitWorktreeResult(result);
      updateCodexForm({ workingDir: result.worktreeDir });
      showMessage('success', `${text.worktreeCreated}: ${result.baseRef} -> ${result.worktreeDir}`);
    });
  }

  function useGitWorktreeResultInCreateForm() {
    if (!gitWorktreeResult?.worktreeDir) return;
    updateCodexForm({ workingDir: gitWorktreeResult.worktreeDir });
    setPage('codexCreate');
    showMessage('success', `${text.worktreeUseInCreate}: ${gitWorktreeResult.worktreeDir}`);
  }

  async function resolveAppUpdate(
    options: { ignoreSkipped?: boolean; silentNoUpdate?: boolean } = {},
  ): Promise<AvailableUpdate> {
    try {
      const update = await check();
      setAvailableUpdate(update);
      if (!update) {
        setUpdateStatus({ message: text.updateNoUpdate, checkedAt: Date.now() });
        if (!options.silentNoUpdate) showMessage('success', text.updateNoUpdate);
        return null;
      }
      if (!options.ignoreSkipped && skippedUpdateVersion === update.version) {
        setAvailableUpdate(null);
        setUpdateStatus({
          message: `${text.updateSkipped}: ${update.version}`,
          version: update.version,
          notes: update.body ?? undefined,
          checkedAt: Date.now(),
        });
        return null;
      }
      const message = `${text.updateAvailable}: ${update.version}`;
      setUpdateStatus({
        message,
        version: update.version,
        notes: update.body ?? undefined,
        checkedAt: Date.now(),
      });
      showMessage('success', message);
      return update;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const diagnostic = diagnoseUpdateError(error);
      reportError(error, { area: 'updater', action: 'check', detail });
      setAvailableUpdate(null);
      setUpdateStatus({
        message: `${text.updateCheckFailed}: ${diagnostic}`,
        diagnostic: detail,
        checkedAt: Date.now(),
      });
      showMessage('error', `${text.updateCheckFailed}: ${diagnostic}`);
      return null;
    }
  }

  async function checkForAppUpdate() {
    await withBusy('app-update-check', async () => {
      await resolveAppUpdate();
    });
  }

  async function installAppUpdate() {
    await withBusy('app-update-install', async () => {
      const update = availableUpdate ?? (await resolveAppUpdate({ ignoreSkipped: true }));
      if (!update) {
        return;
      }
      let downloaded = 0;
      let total = 0;
      try {
        await update.downloadAndInstall((event) => {
          if (event.event === 'Started') {
            total = event.data.contentLength ?? 0;
          } else if (event.event === 'Progress') {
            downloaded += event.data.chunkLength;
          } else if (event.event === 'Finished') {
            downloaded = total || downloaded;
          }
          setUpdateStatus({
            message: text.updateInstalling,
            version: update.version,
            notes: update.body ?? undefined,
            downloaded,
            total,
          });
        });
        setUpdateStatus({
          message: text.updateInstalled,
          version: update.version,
          notes: update.body ?? undefined,
          downloaded,
          total,
        });
        showMessage('success', text.updateInstalled);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const diagnostic = diagnoseUpdateError(error);
        reportError(error, { area: 'updater', action: 'install', detail });
        setUpdateStatus({
          message: `${text.updateInstallFailed}: ${diagnostic}`,
          diagnostic: detail,
          version: update.version,
          notes: update.body ?? undefined,
        });
        showMessage('error', `${text.updateInstallFailed}: ${diagnostic}`);
        return;
      }

      try {
        await relaunch();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const diagnostic = diagnoseUpdateError(error);
        reportError(error, { area: 'updater', action: 'relaunch', detail });
        setUpdateStatus({
          message: `${text.updateInstalledRestartFailed}: ${diagnostic}`,
          diagnostic: detail,
          version: update.version,
          notes: update.body ?? undefined,
          downloaded,
          total,
        });
        showMessage('error', `${text.updateInstalledRestartFailed}: ${diagnostic}`);
      }
    });
  }

  function skipAvailableUpdate() {
    if (!availableUpdate) return;
    localStorage.setItem(UPDATE_SKIPPED_VERSION_KEY, availableUpdate.version);
    setSkippedUpdateVersion(availableUpdate.version);
    setAvailableUpdate(null);
    setUpdateStatus({
      message: `${text.updateSkipped}: ${availableUpdate.version}`,
      version: availableUpdate.version,
      notes: availableUpdate.body ?? undefined,
      checkedAt: Date.now(),
    });
  }

  function clearSkippedUpdate() {
    localStorage.removeItem(UPDATE_SKIPPED_VERSION_KEY);
    setSkippedUpdateVersion('');
    setUpdateStatus({ message: text.updateIdle });
  }

  async function openReleasePage() {
    await openUrl(updaterConfig.releasePage);
  }

  async function openDiagnosticsLogDir() {
    const path = diagnostics?.logDir;
    if (!path) {
      showMessage('error', text.diagnosticsNoLogs);
      return;
    }
    try {
      await openPath(path);
    } catch (error) {
      showMessage('error', `${text.openPathFailed}: ${String(error)}`);
    }
  }

  async function openSyncPackageDir() {
    const path = syncPackage?.packagePath || syncPackage?.manifestPath;
    if (!path) {
      showMessage('error', text.syncPackageApplyMissing);
      return;
    }
    try {
      await openPath(path);
    } catch (error) {
      showMessage('error', `${text.openPathFailed}: ${String(error)}`);
    }
  }

  async function openSyncPackageBackupDir(path: string) {
    try {
      await openPath(path);
    } catch (error) {
      showMessage('error', `${text.openPathFailed}: ${String(error)}`);
    }
  }

  function findCodexClone(instanceId: string): InstanceProfile | null {
    return codexCloneList.find((instance) => instance.id === instanceId) ?? null;
  }

  function syncPackageAppliedPayload(instanceId: string) {
    const instance = findCodexClone(instanceId);
    if (!instance) return null;
    const history = historyByInstance[instanceId] ?? instance.historyStatus;
    const marker = history?.syncPackageApplied;
    if (!marker) return null;
    const codexHome = history?.codexHome || instance.userDataDir;
    return {
      instanceId: instance.id,
      instanceName: instance.name,
      codexHome,
      markerPath: syncPackageAppliedMarkerPath(instance, history),
      marker,
    };
  }

  async function openSyncPackageAppliedMarker(instanceId: string) {
    const payload = syncPackageAppliedPayload(instanceId);
    if (!payload?.markerPath) {
      showMessage('error', text.syncPackageAppliedMissing);
      return;
    }
    try {
      await openPath(payload.markerPath);
    } catch (error) {
      showMessage('error', `${text.openPathFailed}: ${String(error)}`);
    }
  }

  async function copySyncPackageAppliedMarker(instanceId: string) {
    const payload = syncPackageAppliedPayload(instanceId);
    if (!payload) {
      showMessage('error', text.syncPackageAppliedMissing);
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      showMessage('success', text.syncPackageAppliedCopied);
    } catch (error) {
      reportError(error, { area: 'sync-package', action: 'copy-applied-marker' });
      showMessage('error', `${text.diagnosticsReportCopyFailed}: ${String(error)}`);
    }
  }

  async function copySyncPackageResourceDiff(instanceId: string) {
    const instance = findCodexClone(instanceId);
    if (!instance) {
      showMessage('error', text.syncPackageAppliedMissing);
      return;
    }
    const history = historyByInstance[instanceId] ?? instance.historyStatus;
    const report = buildSyncPackageResourceDiffReport({ currentPackage: syncPackage, history, instance });
    try {
      await navigator.clipboard.writeText(report);
      showMessage('success', `${text.syncManifestTitle}: diff copied`);
    } catch (error) {
      reportError(error, { area: 'sync-package', action: 'copy-resource-diff' });
      showMessage('error', `${text.diagnosticsReportCopyFailed}: ${String(error)}`);
    }
  }

  const advancedOptionsDefaultOpen = Boolean(
    codexForm.workingDir.trim() ||
      codexForm.launchScript.trim() ||
      codexForm.modelCatalogEnabled ||
      codexForm.goalEnabled ||
      codexForm.goalText.trim() ||
      codexForm.promptPackEnabled ||
      (codexForm.promptPackText.trim() && codexForm.promptPackText.trim() !== text.promptPackDefault.trim()),
  );

  const navItems: Array<{ id: Page; label: string }> = [
    { id: 'dashboard', label: text.dashboard },
    { id: 'codexCreate', label: text.createCodex },
    { id: 'codexList', label: text.codexList },
    { id: 'settings', label: text.settings },
    { id: 'guide', label: text.guide },
  ];

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <div className="brand-kicker">{text.brand}</div>
          <h1>{text.appTitle}</h1>
        </div>
        <div className="topbar-actions">
          <nav className="tabs">
            {navItems.map((item) => (
              <button
                key={item.id}
                className={page === item.id ? 'active' : ''}
                onClick={() => setPage(item.id)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="theme-switch" aria-label={text.themeLabel}>
            <button
              className={themeMode === 'system' ? 'active' : ''}
              onClick={() => updateThemeMode('system')}
              title={text.themeSystem}
              type="button"
            >
              <Monitor size={16} />
            </button>
            <button
              className={themeMode === 'dark' ? 'active' : ''}
              onClick={() => updateThemeMode('dark')}
              title={text.themeDark}
              type="button"
            >
              <Moon size={16} />
            </button>
            <button
              className={themeMode === 'light' ? 'active' : ''}
              onClick={() => updateThemeMode('light')}
              title={text.themeLight}
              type="button"
            >
              <Sun size={16} />
            </button>
          </div>
        </div>
      </header>

      {message ? (
        <div className={`notice ${message.tone}`}>
          {message.tone === 'success' ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
          <span>{message.text}</span>
        </div>
      ) : null}

      {busy ? (
        <div className="notice working">
          <Loader2 className="spin" size={18} />
          <span>{busyMessage(busy)}</span>
        </div>
      ) : null}

      <input
        ref={cloneSnapshotImportRef}
        accept="application/json,.json"
        className="hidden-file-input"
        onChange={handleCloneSnapshotImport}
        type="file"
      />

      {page === 'dashboard' ? (
        <DashboardPage
          syncPackage={syncPackage}
          syncPackagePreflight={syncPackagePreflight}
          instances={codexCloneList}
          historyByInstance={historyByInstance}
          appVersion={appVersion}
          busy={busy}
          onOpenCreate={() => setPage('codexCreate')}
          onOpenList={() => setPage('codexList')}
          onOpenSettings={() => setPage('settings')}
          onBulkRefresh={bulkRefreshCodexHistory}
          onBulkVerify={bulkVerifyCodexHistory}
          onBulkRepair={bulkRepairCodexHistory}
        />
      ) : null}

      {page === 'codexCreate' ? (
        <main className="create-grid">
          <section className="hero-card">
            <div className="hero-badge">
              <Rocket size={16} />
              CODEX CLONE
            </div>
            <h2>{text.codexHeroTitle}</h2>
            <p>{text.codexHeroLead}</p>

            <div className="api-strip">
              <div>
                <KeyRound size={16} />
                {text.thirdPartyApi}
              </div>
              <button
                className={showOfficialPanel ? 'active' : ''}
                onClick={() => setShowOfficialPanel((value) => !value)}
                type="button"
              >
                {showOfficialPanel ? text.collapseOfficial : text.officialEntry}
              </button>
              <button onClick={openCloneSnapshotImport} type="button">
                <Import size={16} />
                {text.cloneSnapshotImport}
              </button>
            </div>

            <div className="form-grid">
              <label>
                <span>{text.cloneName}</span>
                <input
                  name="clone-name"
                  value={codexForm.name}
                  onChange={(event) => updateCodexForm({ name: event.target.value })}
                />
              </label>
              <label>
                <span>{text.model}</span>
                <input
                  name="clone-model"
                  value={codexForm.model}
                  onChange={(event) => updateCodexForm({ model: event.target.value })}
                />
              </label>
              <label className="wide">
                <span>{text.baseUrl}</span>
                <input
                  autoFocus
                  name="clone-base-url"
                  value={codexForm.baseUrl}
                  onChange={(event) => updateCodexForm({ baseUrl: event.target.value })}
                  placeholder="https://api.example.com/v1"
                />
              </label>
              <label className="wide">
                <span>{text.apiKey}</span>
                <input
                  name="clone-api-key"
                  value={codexForm.apiKey}
                  onChange={(event) => updateCodexForm({ apiKey: event.target.value })}
                  placeholder="sk-..."
                  type="password"
                />
              </label>
              <div className="provider-test-actions wide">
                <small>
                  {text.providerModelsHint}
                  <br />
                  {text.providerTestHint}
                </small>
                <div className="provider-action-buttons">
                  <button disabled={Boolean(busy)} onClick={() => void fetchProviderModels()} type="button">
                    {busy === 'provider-model-fetch' ? <Loader2 className="spin" size={16} /> : <Search size={16} />}
                    {text.providerModelsFetch}
                  </button>
                  <button disabled={Boolean(busy)} onClick={() => void testProviderConnection()} type="button">
                    {busy === 'provider-connection-test' ? <Loader2 className="spin" size={16} /> : <Activity size={16} />}
                    {text.providerTest}
                  </button>
                </div>
              </div>
              {providerModelsResult ? (
                <ProviderModelsPanel
                  currentModel={codexForm.model}
                  result={providerModelsResult}
                  onSelect={(model) => updateCodexForm({ model })}
                />
              ) : null}
              <ProviderConfigAuditPanel audit={providerConfigAudit} />
              {providerTestResult ? <ProviderTestPanel result={providerTestResult} /> : null}

              {showOfficialPanel ? (
                <div className="official-panel wide">
                  <div>
                    <strong>{text.officialTitle}</strong>
                    <p>{text.officialLead}</p>
                  </div>
                  <div className="official-actions">
                    <button onClick={startOfficialLogin} type="button" disabled={Boolean(busy)}>
                      {text.openOfficialLogin}
                    </button>
                    <button onClick={completeOfficialLogin} type="button" disabled={Boolean(busy) || !pendingLoginId}>
                      {text.completeLogin}
                    </button>
                  </div>
                  <select
                    name="official-account-id"
                    value={officialAccountId}
                    onChange={(event) => setOfficialAccountId(event.target.value)}
                  >
                    <option value="">{text.chooseOfficial}</option>
                    {officialAccountOptions.map((account) => (
                      <option key={account.id} value={account.id}>
                        {accountLabel(account)}
                      </option>
                    ))}
                  </select>
                  <button
                    className="secondary-action"
                    onClick={() => void createCodexClone('officialAccount')}
                    type="button"
                    disabled={Boolean(busy)}
                  >
                    {text.useOfficial}
                  </button>
                </div>
              ) : null}

              <details className="advanced-options wide" open={advancedOptionsDefaultOpen ? true : undefined}>
                <summary>{text.advancedOptions}</summary>
                <div className="advanced-options-grid">
                  <label>
                    <span>{text.workdir}</span>
                    <input
                      name="clone-working-dir"
                      value={codexForm.workingDir}
                      onChange={(event) => updateCodexForm({ workingDir: event.target.value })}
                      placeholder="C:\\path\\to\\workspace"
                    />
                  </label>
                  <label>
                    <span>{text.launchScript}</span>
                    <textarea
                      name="clone-launch-script"
                      value={codexForm.launchScript}
                      onChange={(event) => updateCodexForm({ launchScript: event.target.value })}
                      placeholder={'// Optional clone-owned startup script\nwindow.__CODEX_CLONE_PROFILE__ = true;'}
                      rows={5}
                    />
                    <small>{text.launchScriptHint}</small>
                  </label>
                  <div className={`model-catalog-option ${codexForm.modelCatalogEnabled ? 'enabled' : ''}`}>
                    <label className="model-catalog-toggle">
                      <input
                        name="clone-model-catalog-enabled"
                        type="checkbox"
                        checked={codexForm.modelCatalogEnabled}
                        onChange={(event) => updateCodexForm({ modelCatalogEnabled: event.target.checked })}
                      />
                      <span>
                        <Database size={16} />
                        {text.modelCatalog}
                      </span>
                    </label>
                    <small>{text.modelCatalogHint}</small>
                    <code>
                      {modelCatalogModels.length
                        ? `${modelCatalogModels.length} ${text.providerModelsCountUnit} -> ${codexForm.modelCatalogEnabled ? 'model-catalog.json' : text.modelCatalogStandby}`
                        : text.modelCatalogEmpty}
                    </code>
                  </div>
                  <div className={`goal-pursuit-panel ${codexForm.goalEnabled ? 'enabled' : ''}`}>
                    <label className="goal-pursuit-toggle">
                      <input
                        name="clone-goal-enabled"
                        type="checkbox"
                        checked={codexForm.goalEnabled}
                        onChange={(event) => updateCodexForm({ goalEnabled: event.target.checked })}
                      />
                      <span>
                        <Target size={16} />
                        {text.goalPursuit}
                      </span>
                    </label>
                    <small>{text.goalPursuitHint}</small>
                    {codexForm.goalEnabled ? (
                      <textarea
                        name="clone-goal-text"
                        value={codexForm.goalText}
                        onChange={(event) => updateCodexForm({ goalText: event.target.value })}
                        placeholder={text.goalPursuitPlaceholder}
                        rows={4}
                      />
                    ) : null}
                  </div>
                  <div className={`prompt-pack-panel ${codexForm.promptPackEnabled ? 'enabled' : ''}`}>
                    <label className="prompt-pack-toggle">
                      <input
                        name="clone-prompt-pack-enabled"
                        type="checkbox"
                        checked={codexForm.promptPackEnabled}
                        onChange={(event) => updateCodexForm({ promptPackEnabled: event.target.checked })}
                      />
                      <span>
                        <BookOpen size={16} />
                        {text.promptPack}
                      </span>
                    </label>
                    <small>{text.promptPackHint}</small>
                    {codexForm.promptPackEnabled ? (
                      <textarea
                        name="clone-prompt-pack-text"
                        value={codexForm.promptPackText}
                        onChange={(event) => updateCodexForm({ promptPackText: event.target.value })}
                        placeholder={text.promptPackPlaceholder}
                        rows={7}
                      />
                    ) : null}
                  </div>
                  <div className="checks advanced-checks">
                    <label>
                      <input
                        name="clone-launch-after-create"
                        type="checkbox"
                        checked={codexForm.launchAfterCreate}
                        onChange={(event) => updateCodexForm({ launchAfterCreate: event.target.checked })}
                      />
                      {text.launchAfterCreate}
                    </label>
                  </div>
                </div>
              </details>
            </div>

            <div className="checks">
              <label>
                <input
                  name="clone-inherit-local-data"
                  type="checkbox"
                  checked={codexForm.inheritLocalData}
                  onChange={(event) => updateCodexForm({ inheritLocalData: event.target.checked })}
                />
                {text.inheritCodex}
              </label>
            </div>

            <button className="primary-action" onClick={() => void createCodexClone('apiKey')} type="button" disabled={Boolean(busy)}>
              {busy === 'create-codex' ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
              {codexForm.launchAfterCreate ? text.createAndLaunchCodex : text.createOnlyCodex}
            </button>
          </section>

          <aside className="info-card">
            <h3>{text.inheritTitle}</h3>
            <ul>
              <li>{text.inheritChat}</li>
              <li>{text.inheritSkills}</li>
              <li>{text.inheritMcp}</li>
              <li>{text.inheritGoals}</li>
              <li>{text.inheritPlugins}</li>
            </ul>
            <p>{text.inheritNote}</p>
          </aside>
        </main>
      ) : null}

      {page === 'codexList' ? (
        <section className="list-page">
          <SyncPackagePanel
            status={syncPackage}
            backups={syncPackageBackups}
            preflight={syncPackagePreflight}
            busy={busy}
            onExtract={extractCodexSyncPackage}
            onRefresh={refreshCodexSyncPackageStatus}
            onPreflight={refreshCodexSyncPackagePreflight}
            onCopyResourceReport={copySyncPackageResourceReport}
            onCopyResourceLensReport={copyResourceLensReport}
            onCopyBackupReport={copySyncPackageBackupReport}
            onCopyPreflightReport={copySyncPackagePreflightReport}
            onOpenBackup={openSyncPackageBackupDir}
            onRestoreBackup={restoreSyncPackageBackup}
          />
          <InstanceList
            title={text.codexList}
            subtitle={text.codexSubtitle}
            emptyText={text.noCodex}
            instances={codexCloneList}
            syncPackage={syncPackage}
            onRefresh={refreshCodexInstances}
            onStart={startCodexInstance}
            onStop={stopCodexInstance}
            onDelete={deleteCodexInstance}
            busy={busy}
            syncBlockedReason={syncPackageRepairBlocker(syncPackage, syncPackagePreflight)}
            syncNotice={syncPackage?.stale ? text.syncPackageApplyStale : null}
            historyByInstance={historyByInstance}
            onHistoryRefresh={refreshCodexHistory}
            onHistoryVerify={verifyCodexHistory}
            onHistoryRepair={repairCodexHistory}
            onHistoryExportMarkdown={exportCodexHistoryMarkdown}
            onCloneSnapshotExport={exportCloneCapabilitySnapshot}
            onCloneSnapshotUse={useCloneCapabilitySnapshot}
            cloneCapabilityDrafts={cloneCapabilityDrafts}
            onCloneCapabilityEdit={startCloneCapabilityEdit}
            onCloneCapabilityDraftChange={updateCloneCapabilityDraft}
            onCloneCapabilitySave={saveCloneCapabilities}
            onCloneCapabilityCancel={cancelCloneCapabilityEdit}
            sessionsByInstance={sessionsByInstance}
            usageByInstance={usageByInstance}
            onSessionListRefresh={refreshCodexSessionList}
            onSessionUsageRefresh={refreshCodexSessionUsage}
            sessionSearchQuery={sessionSearchQuery}
            onSessionSearchQueryChange={setSessionSearchQuery}
            onCopySessionProjectDir={copyCodexSessionProjectDir}
            exportDirByInstance={exportDirByInstance}
            onOpenHistoryExportDir={openCodexHistoryExportDir}
            onOpenZed={openCodexInstanceInZed}
            onOpenSyncPackageAppliedMarker={openSyncPackageAppliedMarker}
            onCopySyncPackageAppliedMarker={copySyncPackageAppliedMarker}
            onCopySyncPackageResourceDiff={copySyncPackageResourceDiff}
          />
        </section>
      ) : null}

      {page === 'settings' ? (
        <section className="settings-page">
          <div className="section-header">
            <div>
              <h2>{text.settings}</h2>
              <p>{text.settingsLead}</p>
            </div>
            <button onClick={saveSettings} type="button" disabled={Boolean(busy)}>
              <Settings size={16} />
              {text.save}
            </button>
          </div>
          <PathRow
            title={text.codexPath}
            value={codexAppPath}
            onChange={setCodexAppPath}
            onPick={() => void pickCodexAppPath()}
            onDetect={() => void detectCodexAppPath()}
          />
          <GitWorktreePanel
            form={gitWorktreeForm}
            defaults={gitWorktreeDefaults}
            result={gitWorktreeResult}
            busy={busy}
            onChange={updateGitWorktreeForm}
            onPickRepo={() => void pickGitWorktreeRepoDir()}
            onPickTarget={() => void pickGitWorktreeTargetDir()}
            onDetect={() => void detectGitWorktreeDefaults()}
            onCreate={() => void createGitWorktree()}
            onUseResult={useGitWorktreeResultInCreateForm}
            onCopyDiagnostics={() => void copyGitWorktreeDiagnosticsReport()}
          />
          <UpdatePanel
            appVersion={appVersion}
            busy={busy}
            status={updateStatus}
            hasUpdate={Boolean(availableUpdate)}
            autoCheck={autoCheckUpdates}
            skippedVersion={skippedUpdateVersion}
            ownerRepo={updaterConfig.ownerRepo}
            endpoint={updaterConfig.endpoint}
            onAutoCheckChange={setAutoCheckUpdates}
            onCheck={() => void checkForAppUpdate()}
            onInstall={() => void installAppUpdate()}
            onSkip={() => skipAvailableUpdate()}
            onClearSkip={() => clearSkippedUpdate()}
            onOpenReleases={() => void openReleasePage()}
          />
          <DiagnosticsPanel
            syncPackage={syncPackage}
            diagnostics={diagnostics}
            codexAppPath={codexAppPath}
            appVersion={appVersion}
            diagnosticsReport={diagnosticsReport}
            busy={busy}
            onRefreshDiagnostics={refreshDiagnosticsStatus}
            onCopyDiagnosticsReport={copyDiagnosticsReport}
            onOpenLogDir={openDiagnosticsLogDir}
            onOpenSyncPackage={openSyncPackageDir}
          />
        </section>
      ) : null}

      {page === 'guide' ? <OperationGuide syncPackage={syncPackage} cloneCount={codexCloneList.length} /> : null}
    </div>
  );
}

type DashboardPageProps = {
  syncPackage: CodexSyncPackageStatus | null;
  syncPackagePreflight: CodexSyncPackagePreflightReport | null;
  instances: InstanceProfile[];
  historyByInstance: { [id: string]: CodexHistoryStatus };
  appVersion: string;
  busy: string;
  onOpenCreate: () => void;
  onOpenList: () => void;
  onOpenSettings: () => void;
  onBulkRefresh: () => unknown;
  onBulkVerify: () => unknown;
  onBulkRepair: () => unknown;
};

type DiagnosticsPanelProps = {
  syncPackage: CodexSyncPackageStatus | null;
  diagnostics: DiagnosticsSnapshot | null;
  codexAppPath: string;
  appVersion: string;
  diagnosticsReport: string;
  busy: string;
  onRefreshDiagnostics: () => unknown;
  onCopyDiagnosticsReport: () => unknown;
  onOpenLogDir: () => unknown;
  onOpenSyncPackage: () => unknown;
};

function DashboardPage(props: DashboardPageProps) {
  const health = cloneHealthStats(props.instances, props.historyByInstance);
  const packageReady = Boolean(props.syncPackage?.exists);
  const packageState = syncPackageStateLabel(props.syncPackage);
  const syncBlocker = syncPackageRepairBlocker(props.syncPackage, props.syncPackagePreflight);

  return (
    <section className="dashboard-page">
      <div className="section-header dashboard-header">
        <div>
          <h2>{text.dashboard}</h2>
          <p>{text.dashboardLead}</p>
        </div>
        <div className="dashboard-actions">
          <button disabled={Boolean(props.busy)} onClick={props.onOpenCreate} type="button">
            <Rocket size={16} />
            {text.openCreate}
          </button>
          <button disabled={Boolean(props.busy)} onClick={props.onOpenList} type="button">
            <Database size={16} />
            {text.openList}
          </button>
          <button disabled={Boolean(props.busy)} onClick={props.onOpenSettings} type="button">
            <Settings size={16} />
            {text.openSettings}
          </button>
        </div>
      </div>

      <div className="dashboard-grid dashboard-overview-grid">
        <section className="dashboard-card summary-card dashboard-metrics-card">
          <div className="summary-grid dashboard-metrics">
            <SummaryTile icon={<Gauge size={18} />} label={text.cloneRunningCount} value={String(health.running)} />
            <SummaryTile icon={<Layers size={18} />} label={text.cloneTotalCount} value={String(props.instances.length)} />
            <SummaryTile icon={<ShieldCheck size={18} />} label={text.packageFreshness} value={packageState} />
            <SummaryTile icon={<Activity size={18} />} label={text.launcherVersion} value={props.appVersion || 'unknown'} />
          </div>
        </section>

        <section className="dashboard-card health-card">
          <div className="card-title-row">
            <span>{text.healthTitle}</span>
            <Activity size={18} />
          </div>
          <p>{text.healthLead}</p>
          <div className="summary-grid health-summary-grid">
            <SummaryTile icon={<ShieldCheck size={16} />} label={text.healthChecked} value={String(health.checked)} />
            <SummaryTile icon={<CircleAlert size={16} />} label={text.healthMismatchWarning} value={`${health.mismatch} / ${health.warnings}`} />
          </div>
          <div className="dashboard-actions compact health-actions">
            <button disabled={Boolean(props.busy) || !props.instances.length} onClick={() => void props.onBulkRefresh()} type="button">
              {props.busy === 'codex-history-bulk-refresh' ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
              {text.healthBulkRefresh}
            </button>
            <button disabled={Boolean(props.busy) || !props.instances.length} onClick={() => void props.onBulkVerify()} type="button">
              {props.busy === 'codex-history-bulk-verify' ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}
              {text.healthBulkVerify}
            </button>
            <button
              disabled={Boolean(props.busy) || !props.instances.length || Boolean(syncBlocker)}
              onClick={() => void props.onBulkRepair()}
              title={syncBlocker ?? undefined}
              type="button"
            >
              {props.busy === 'codex-history-bulk-repair' ? <Loader2 className="spin" size={16} /> : <Wrench size={16} />}
              {text.healthBulkRepair}
            </button>
          </div>
        </section>

        <section className={packageReady ? 'dashboard-card sync-card ready' : 'dashboard-card sync-card'}>
          <div className="card-title-row">
            <span>{text.syncPackageTitle}</span>
            <Database size={18} />
          </div>
          <p>{text.syncManifestLead}</p>
          <div className="package-state-row">
            <strong>{packageState}</strong>
            <span>{formatBytes(props.syncPackage?.copiedBytes ?? 0)}</span>
          </div>
          <div className="dashboard-actions compact">
            <button disabled={Boolean(props.busy)} onClick={props.onOpenList} type="button">
              <Database size={16} />
              {text.syncPackageManage}
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}

function DiagnosticsPanel(props: DiagnosticsPanelProps) {
  const packageState = syncPackageStateLabel(props.syncPackage);
  const diagnosticsLogPreview = props.diagnostics?.latestLogTail
    ? props.diagnostics.latestLogTail.split(/\r?\n/).filter(Boolean).slice(-6).join('\n')
    : text.diagnosticsNoLogs;
  const packageIssues = [
    ...(props.syncPackage?.warnings ?? []),
    ...(props.syncPackage?.skipped ?? []).map((item) => `skipped: ${item}`),
  ].slice(0, 5);

  return (
    <section className="settings-diagnostics diagnostics-card">
      <div className="card-title-row">
        <span>{text.diagnosticsTitle}</span>
        <Wrench size={18} />
      </div>
      <p>{text.diagnosticsLead}</p>
      <div className="diagnostics-list">
        <div>
          <strong>{text.quickActions}</strong>
          <span>{diagnosticsSummary(props.diagnostics)}</span>
        </div>
        <div>
          <strong>{text.packageFreshness}</strong>
          <span>{packageState}</span>
        </div>
        <div>
          <strong>{text.launcherVersion}</strong>
          <span>{props.appVersion ? props.appVersion : 'unknown'}</span>
        </div>
        <div>
          <strong>{text.diagnosticsPid}</strong>
          <span>{props.diagnostics ? String(props.diagnostics.launcherPid) : 'unknown'}</span>
        </div>
        <div>
          <strong>{text.codexPath}</strong>
          <span>{props.codexAppPath ? props.codexAppPath : text.pathPlaceholder}</span>
        </div>
        <div>
          <strong>{text.diagnosticsLogDir}</strong>
          <span>{props.diagnostics?.logDir ?? 'unknown'}</span>
        </div>
        <div className={packageIssues.length ? 'diagnostics-issues has-issues' : 'diagnostics-issues'}>
          <strong>{text.diagnosticsIssueSummary}</strong>
          <span>{packageIssues.length ? packageIssues.join(' / ') : text.diagnosticsNoIssues}</span>
        </div>
      </div>
      <div className="dashboard-actions compact">
        <button disabled={Boolean(props.busy)} onClick={() => void props.onRefreshDiagnostics()} type="button">
          {props.busy === 'diagnostics-refresh' ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
          {props.busy === 'diagnostics-refresh' ? text.refreshing : text.diagnosticsRefresh}
        </button>
        <button disabled={Boolean(props.busy)} onClick={() => void props.onCopyDiagnosticsReport()} type="button">
          <ShieldCheck size={16} />
          {text.diagnosticsCopyReport}
        </button>
        <button disabled={Boolean(props.busy) || !props.diagnostics?.logDir} onClick={() => void props.onOpenLogDir()} type="button">
          <FolderOpen size={16} />
          {text.diagnosticsOpenLogDir}
        </button>
        <button disabled={Boolean(props.busy) || !props.syncPackage?.exists} onClick={() => void props.onOpenSyncPackage()} type="button">
          <Database size={16} />
          {text.diagnosticsOpenSyncPackage}
        </button>
      </div>
      {props.diagnosticsReport ? (
        <div className="diagnostics-report-preview">
          <strong>{text.diagnosticsReportPreview}</strong>
          <pre>{props.diagnosticsReport}</pre>
        </div>
      ) : null}
      <div className="log-preview">
        <strong>{text.diagnosticsLogs}</strong>
        <code>{props.diagnostics?.latestLogFile ?? text.diagnosticsNoLogs}</code>
        <pre>{diagnosticsLogPreview}</pre>
      </div>
    </section>
  );
}
function SummaryTile(props: { icon: ReactNode; label: string; value: string }) {
  return createElement(
    'div',
    { className: 'summary-tile' },
    props.icon,
    createElement('span', null, props.label),
    createElement('strong', null, props.value),
  );
}

function CardMenu(props: { label: string; disabled?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [open]);

  return (
    <div className="card-menu" ref={menuRef}>
      <button
        aria-expanded={open}
        aria-label={props.label}
        className="card-menu-trigger"
        disabled={props.disabled}
        onClick={() => setOpen((value) => !value)}
        title={props.label}
        type="button"
      >
        ⋯
      </button>
      {open ? (
        <div className="card-menu-popover" onClick={() => setOpen(false)} role="menu">
          {props.children}
        </div>
      ) : null}
    </div>
  );
}

function ProviderConfigAuditPanel(props: { audit: ProviderConfigAudit }) {
  const visibleChecks = props.audit.checks
    .filter((check) => check.status !== 'ok' || props.audit.tone === 'ok')
    .slice(0, 7);
  const Icon = props.audit.tone === 'blocked' || props.audit.tone === 'warning' ? CircleAlert : ShieldCheck;
  return (
    <div className={`provider-audit-panel wide ${props.audit.tone}`}>
      <div className="provider-audit-title">
        <Icon size={16} />
        <strong>{text.providerAuditTitle}</strong>
        <span>{props.audit.label}</span>
      </div>
      <p>{text.providerAuditLead}</p>
      <div className="provider-audit-metrics">
        <code>{props.audit.normalizedBaseUrl || 'Base URL empty'}</code>
        <span>{props.audit.detail}</span>
        <span>duplicate presets {props.audit.duplicatePresetCount}</span>
        <span>similar presets {props.audit.similarPresetCount}</span>
      </div>
      <div className="provider-audit-checks">
        {visibleChecks.map((check) => (
          <small className={check.status} key={check.id} title={check.detail}>
            {check.label}: {check.detail}
          </small>
        ))}
      </div>
    </div>
  );
}

function ProviderModelsPanel(props: {
  result: CodexProviderModelsFetchResult;
  currentModel: string;
  onSelect: (model: string) => void;
}) {
  const visibleModels = props.result.models.slice(0, 48);
  const hiddenCount = Math.max(0, props.result.models.length - visibleModels.length);
  const current = props.currentModel.trim();
  return (
    <div className={`provider-models-panel wide ${props.result.ok ? 'ok' : props.result.status}`}>
      <div className="provider-test-title">
        <strong>{props.result.ok ? text.providerModelsFetched : text.providerModelsEmpty}</strong>
        <span>{props.result.httpStatus ? `HTTP ${props.result.httpStatus}` : props.result.status}</span>
      </div>
      <p>{props.result.message}</p>
      <div className="provider-test-metrics">
        <span>{props.result.modelCount} {text.providerModelsCountUnit}</span>
        <span>{text.providerLatencyLabel} {props.result.latencyMs}ms</span>
      </div>
      <code>{props.result.endpoint}</code>
      {visibleModels.length ? (
        <div className="provider-model-list">
          {visibleModels.map((model) => (
            <button
              className={model === current ? 'selected' : ''}
              disabled={model === current}
              key={model}
              onClick={() => props.onSelect(model)}
              title={model}
              type="button"
            >
              {model === current ? <CheckCircle2 size={13} /> : null}
              <span>{model}</span>
            </button>
          ))}
          {hiddenCount ? (
            <small>
              {text.providerModelsHiddenPrefix}
              {hiddenCount}
              {text.providerModelsHiddenSuffix}
            </small>
          ) : null}
        </div>
      ) : null}
      {props.result.responsePreview && !visibleModels.length ? <small>{props.result.responsePreview}</small> : null}
    </div>
  );
}

function ProviderTestPanel(props: { result: CodexProviderConnectionTestResult }) {
  const tone = props.result.codexReady ? (props.result.status === 'degraded' ? 'warning' : 'ok') : props.result.ok ? 'warning' : 'error';
  return (
    <div className={`provider-test-panel wide ${tone}`}>
      <div className="provider-test-title">
        <strong>{providerTestStatusLabel(props.result)}</strong>
        <span>{props.result.httpStatus ? `HTTP ${props.result.httpStatus}` : props.result.protocol}</span>
      </div>
      <p>{props.result.message}</p>
      <div className="provider-test-metrics">
        <span>protocol {props.result.protocol}</span>
        <span>{text.providerTtfbLabel} {props.result.ttfbMs ?? '-'}ms</span>
        <span>{text.providerLatencyLabel} {props.result.latencyMs}ms</span>
        <span>{props.result.codexReady ? text.providerHealthCodexReady : text.providerNeedsRelay}</span>
      </div>
      <code>{props.result.endpoint}</code>
      {props.result.responsePreview ? <small>{props.result.responsePreview}</small> : null}
    </div>
  );
}

function OperationGuide(props: {
  syncPackage: CodexSyncPackageStatus | null;
  cloneCount: number;
}) {
  const packageReady = Boolean(props.syncPackage?.exists);
  const packageState = packageReady
    ? props.syncPackage?.stale
      ? text.syncPackageStale
      : text.syncPackageReady
    : text.guidePackageMissing;

  return (
    <section className="guide-page">
      <div className="section-header">
        <div>
          <h2>{text.guide}</h2>
          <p>{text.guideLead}</p>
        </div>
        <BookOpen size={28} />
      </div>

      <div className="guide-status">
        <div>
          <span>{text.syncPackageTitle}</span>
          <strong>{packageState}</strong>
          <code>{props.syncPackage?.packagePath || text.guidePackageNotGenerated}</code>
        </div>
        <div>
          <span>{text.cloneTotalCount}</span>
          <strong>{props.cloneCount}</strong>
          <small>{text.guideManagedCloneOnly}</small>
        </div>
        <div>
          <span>{text.guidePackageSize}</span>
          <strong>{formatBytes(props.syncPackage?.copiedBytes ?? 0)}</strong>
          <small>
            {(props.syncPackage?.fileCount ?? 0).toLocaleString()} {text.guideFilesUnit} /{' '}
            {(props.syncPackage?.directoryCount ?? 0).toLocaleString()} {text.guideDirsUnit}
          </small>
        </div>
      </div>

      <div className="guide-grid">
        <GuidePanel title={text.guideQuickStart} items={guideQuickStartSteps} ordered />
        <GuidePanel title={text.guideSafety} items={guideSafetyRules} />
        <GuidePanel title={text.guideTroubleshooting} items={guideTroubleshootingItems} />
      </div>
    </section>
  );
}

function GitWorktreePanel(props: {
  form: GitWorktreeFormValues;
  defaults: GitWorktreeDefaults | null;
  result: GitWorktreeCreateResult | null;
  busy: string;
  onChange: (patch: Partial<GitWorktreeFormValues>) => void;
  onPickRepo: () => void;
  onPickTarget: () => void;
  onDetect: () => void;
  onCreate: () => void;
  onUseResult: () => void;
  onCopyDiagnostics: () => void;
}) {
  const detecting = props.busy === 'git-worktree-detect';
  const creating = props.busy === 'git-worktree-create';
  const warnings = [
    ...(props.defaults?.warnings ?? []),
    ...(props.result?.warnings ?? []),
  ];

  return (
    <section className="worktree-panel">
      <div className="worktree-title-row">
        <div>
          <span>{text.worktreeTitle}</span>
          <p>{text.worktreeLead}</p>
        </div>
        <div className="worktree-title-actions">
          <button disabled={Boolean(props.busy)} onClick={props.onCopyDiagnostics} type="button">
            <Copy size={16} />
            {text.worktreeCopyDiagnostics}
          </button>
          <GitBranch size={22} />
        </div>
      </div>

      <div className="worktree-form-grid">
        <label className="wide">
          <span>{text.worktreeRepoDir}</span>
          <input
            value={props.form.repoDir}
            onChange={(event) => props.onChange({ repoDir: event.currentTarget.value })}
            placeholder="C:\\path\\to\\repo"
          />
        </label>
        <button disabled={Boolean(props.busy)} onClick={props.onPickRepo} type="button">
          <FolderOpen size={16} />
          {text.pick}
        </button>
        <button disabled={Boolean(props.busy)} onClick={props.onDetect} type="button">
          {detecting ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
          {detecting ? text.refreshing : text.worktreeDetect}
        </button>

        <label>
          <span>{text.worktreeBaseRemote}</span>
          <input
            value={props.form.baseRemote}
            onChange={(event) => props.onChange({ baseRemote: event.currentTarget.value })}
            placeholder="upstream"
          />
        </label>
        <label>
          <span>{text.worktreeBaseBranch}</span>
          <input
            value={props.form.baseBranch}
            onChange={(event) => props.onChange({ baseBranch: event.currentTarget.value })}
            placeholder="main"
          />
        </label>
        <label className="wide">
          <span>{text.worktreeNewBranch}</span>
          <input
            value={props.form.newBranch}
            onChange={(event) => props.onChange({ newBranch: event.currentTarget.value })}
            placeholder="feature/codex-clone-work"
          />
        </label>

        <label className="wide">
          <span>{text.worktreeDir}</span>
          <input
            value={props.form.worktreeDir}
            onChange={(event) => props.onChange({ worktreeDir: event.currentTarget.value })}
            placeholder="C:\\path\\to\\repo-feature"
          />
        </label>
        <button disabled={Boolean(props.busy)} onClick={props.onPickTarget} type="button">
          <FolderOpen size={16} />
          {text.pick}
        </button>
        <button disabled={Boolean(props.busy)} onClick={props.onCreate} type="button">
          {creating ? <Loader2 className="spin" size={16} /> : <GitBranch size={16} />}
          {text.worktreeCreate}
        </button>
      </div>

      <label className="worktree-toggle">
        <input
          checked={props.form.fetchBeforeCreate}
          onChange={(event) => props.onChange({ fetchBeforeCreate: event.currentTarget.checked })}
          type="checkbox"
        />
        <span>{text.worktreeFetch}</span>
      </label>

      {props.defaults ? (
        <div className="worktree-status">
          <div>
            <span>当前分支</span>
            <strong>{props.defaults.currentBranch || 'DETACHED'}</strong>
          </div>
          <div>
            <span>远端基线</span>
            <strong>{props.defaults.baseRef}</strong>
          </div>
          <div>
            <span>可用远端</span>
            <strong>{(props.defaults.remotes ?? []).length ? (props.defaults.remotes ?? []).join(', ') : 'none'}</strong>
          </div>
          <div>
            <span>本地改动</span>
            <strong>{props.defaults.dirty ? '有未提交改动' : '干净'}</strong>
          </div>
        </div>
      ) : null}

      {props.result ? (
        <div className="worktree-result">
          <div>
            <strong>{props.result.newBranch}</strong>
            <span>{props.result.baseRef}</span>
            <code>{props.result.worktreeDir}</code>
          </div>
          <button disabled={Boolean(props.busy)} onClick={props.onUseResult} type="button">
            <Rocket size={16} />
            {text.worktreeUseInCreate}
          </button>
        </div>
      ) : null}

      {warnings.length ? (
        <div className="worktree-warnings">
          {warnings.slice(0, 3).map((warning) => (
            <small key={warning}>{warning}</small>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function UpdatePanel(props: {
  appVersion: string;
  busy: string;
  status: UpdateStatus;
  hasUpdate: boolean;
  autoCheck: boolean;
  skippedVersion: string;
  ownerRepo: string;
  endpoint: string;
  onAutoCheckChange: (enabled: boolean) => void;
  onCheck: () => void;
  onInstall: () => void;
  onSkip: () => void;
  onClearSkip: () => void;
  onOpenReleases: () => void;
}) {
  const isChecking = props.busy === 'app-update-check';
  const isInstalling = props.busy === 'app-update-install';
  const downloaded = props.status.downloaded ?? 0;
  const total = props.status.total ?? 0;
  const progress = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;

  return (
    <section className="update-panel">
      <div>
        <span>{text.updateTitle}</span>
        <strong>
          {text.currentVersion}: {props.appVersion || text.updateUnknownVersion}
        </strong>
        <p>{text.updateLead}</p>
        <small>
          {text.updateRepository}: {props.ownerRepo}
        </small>
        <small>
          {text.updateEndpoint}: {props.endpoint}
        </small>
      </div>
      <div className="update-status">
        <strong>{props.status.message}</strong>
        {props.status.version ? (
          <small>
            {text.updateLatestVersion}: {props.status.version}
          </small>
        ) : null}
        {props.status.notes ? <small>{props.status.notes}</small> : null}
        {props.status.checkedAt ? (
          <small>
            {text.updateCheckedAt}: {formatTime(props.status.checkedAt)}
          </small>
        ) : null}
        {props.status.diagnostic ? <small title={props.status.diagnostic}>{props.status.diagnostic}</small> : null}
        {isInstalling ? (
          <div className="update-progress">
            <span style={{ width: `${progress}%` }} />
          </div>
        ) : null}
        {isInstalling ? <small>{total > 0 ? `${formatBytes(downloaded)} / ${formatBytes(total)}` : formatBytes(downloaded)}</small> : null}
      </div>
      <div className="update-actions">
        <label className="update-toggle">
          <input
            checked={props.autoCheck}
            disabled={Boolean(props.busy)}
            name="app-update-auto-check"
            onChange={(event) => props.onAutoCheckChange(event.currentTarget.checked)}
            type="checkbox"
          />
          <span>{text.autoCheckUpdates}</span>
        </label>
        <button disabled={Boolean(props.busy)} onClick={props.onCheck} type="button">
          {isChecking ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
          {isChecking ? text.updateChecking : text.checkUpdate}
        </button>
        <button disabled={Boolean(props.busy)} onClick={props.onInstall} type="button">
          {isInstalling ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
          {isInstalling ? text.updateInstalling : props.hasUpdate ? text.installUpdate : text.checkAndInstallUpdate}
        </button>
        {props.hasUpdate ? (
          <button disabled={Boolean(props.busy)} onClick={props.onSkip} type="button">
            {text.skipThisVersion}
          </button>
        ) : null}
        {props.skippedVersion ? (
          <button disabled={Boolean(props.busy)} onClick={props.onClearSkip} type="button">
            {text.resumeSkippedUpdate}: {props.skippedVersion}
          </button>
        ) : null}
        <button disabled={Boolean(props.busy)} onClick={props.onOpenReleases} type="button">
          {text.openReleases}
        </button>
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

function InstanceList(props: {
  title: string;
  subtitle: string;
  emptyText: string;
  instances: InstanceProfile[];
  syncPackage: CodexSyncPackageStatus | null;
  busy: string;
  onRefresh: () => Promise<void>;
  onStart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  historyByInstance: Record<string, CodexHistoryStatus>;
  syncBlockedReason?: string | null;
  syncNotice?: string | null;
  onHistoryRefresh?: (id: string) => Promise<void>;
  onHistoryVerify?: (id: string) => Promise<void>;
  onHistoryRepair?: (id: string) => Promise<void>;
  onHistoryExportMarkdown?: (id: string) => Promise<void>;
  onCloneSnapshotExport?: (id: string) => Promise<void>;
  onCloneSnapshotUse?: (id: string) => Promise<void>;
  cloneCapabilityDrafts?: Record<string, CloneCapabilityEditDraft>;
  onCloneCapabilityEdit?: (instance: InstanceProfile) => void;
  onCloneCapabilityDraftChange?: (id: string, patch: Partial<CloneCapabilityEditDraft>) => void;
  onCloneCapabilitySave?: (id: string) => Promise<void>;
  onCloneCapabilityCancel?: (id: string) => void;
  sessionsByInstance?: Record<string, CodexSessionSummary[]>;
  usageByInstance?: Record<string, CodexSessionUsageSummary>;
  onSessionListRefresh?: (id: string) => Promise<void>;
  onSessionUsageRefresh?: (id: string) => Promise<void>;
  sessionSearchQuery?: string;
  onSessionSearchQueryChange?: (value: string) => void;
  onCopySessionProjectDir?: (projectDir: string) => Promise<void> | void;
  exportDirByInstance?: Record<string, string>;
  onOpenHistoryExportDir?: (id: string) => Promise<void>;
  onOpenZed?: (id: string) => Promise<void>;
  onOpenSyncPackageAppliedMarker?: (id: string) => Promise<void>;
  onCopySyncPackageAppliedMarker?: (id: string) => Promise<void>;
  onCopySyncPackageResourceDiff?: (id: string) => Promise<void>;
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
              placeholder={text.sessionSearchPlaceholder}
              type="search"
              value={props.sessionSearchQuery ?? ''}
            />
          ) : null}
          <button onClick={() => void props.onRefresh()} type="button">
            <RefreshCw size={16} />
            {text.refresh}
          </button>
        </div>
      </div>
      <InstanceTable {...props} />
    </div>
  );
}

function CloneReadinessPanel(props: { readiness: CloneReadinessSummary }) {
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

function syncPackageBackupStatusLabel(status: string): string {
  switch (status) {
    case 'ready':
      return 'Ready';
    case 'missingManifest':
      return 'Missing manifest';
    case 'error':
      return 'Error';
    default:
      return status || 'Unknown';
  }
}

function syncPackagePreflightStatusLabel(report: CodexSyncPackagePreflightReport | null): string {
  if (!report) return 'preflight not checked';
  if (report.status === 'ok') return 'preflight OK';
  if (report.status === 'warning') return 'preflight warnings';
  if (report.status === 'error') return 'preflight blocked';
  if (report.status === 'missing') return 'package missing';
  return `preflight ${report.status}`;
}

function syncPackagePreflightClass(report: CodexSyncPackagePreflightReport | null): string {
  if (!report) return 'not-checked';
  return report.status || 'unknown';
}

function SyncPackagePreflightSummary(props: {
  preflight: CodexSyncPackagePreflightReport | null;
  busy: string;
  compact?: boolean;
  showActions?: boolean;
  onPreflight: () => Promise<void> | unknown;
  onCopyPreflightReport: () => Promise<void> | unknown;
}) {
  const preflight = props.preflight;
  const issueChecks = preflight?.checks.filter((check) => check.status !== 'ok') ?? [];
  const visibleChecks = (issueChecks.length ? issueChecks : preflight?.checks ?? []).slice(0, props.compact ? 3 : 6);
  return (
    <div className={`sync-package-preflight ${syncPackagePreflightClass(preflight)}${props.compact ? ' compact' : ''}`}>
      <div className="sync-package-preflight-title">
        <div>
          <strong>Preflight</strong>
          <span>{syncPackagePreflightStatusLabel(preflight)}</span>
        </div>
        {props.showActions === false ? null : (
          <div>
            <button disabled={Boolean(props.busy)} onClick={() => void props.onPreflight()} type="button">
              {props.busy === 'codex-sync-package-preflight' ? <Loader2 className="spin" size={14} /> : <ShieldCheck size={14} />}
              {text.preflightCheck}
            </button>
            <button disabled={Boolean(props.busy) || !preflight} onClick={() => void props.onCopyPreflightReport()} type="button">
              <Copy size={14} />
              {text.copy}
            </button>
          </div>
        )}
      </div>
      <div className="sync-package-preflight-stats">
        <span>{preflight?.readyToApply ? 'ready to apply' : 'not ready'}</span>
        <span>errors {preflight?.errorCount ?? 0}</span>
        <span>warnings {preflight?.warningCount ?? 0}</span>
        <span>entries {preflight?.entriesChecked ?? 0}</span>
        <span>resources {preflight?.resourcesChecked ?? 0}</span>
        {preflight?.checkedAt ? <span>{formatTime(preflight.checkedAt)}</span> : null}
      </div>
      {visibleChecks.length ? (
        <div className="sync-package-preflight-checks">
          {visibleChecks.map((check) => (
            <div className={`sync-package-preflight-check ${check.status}`} key={check.id}>
              <strong>{check.label}</strong>
              <span>{check.status}</span>
              <small>{check.detail}</small>
              {check.action ? <small className="warning">{check.action}</small> : null}
            </div>
          ))}
        </div>
      ) : (
        <small className="manifest-empty">Run Preflight before Sync/Repair when package update behavior looks wrong.</small>
      )}
    </div>
  );
}

function SyncPackageBackupTimeline(props: {
  backups: CodexSyncPackageBackupSummary[];
  busy: string;
  showCopyAction?: boolean;
  onOpenBackup: (path: string) => Promise<void>;
  onRestoreBackup: (backupId: string) => Promise<void>;
  onCopyBackupReport: () => Promise<void>;
}) {
  const visible = props.backups.slice(0, 6);
  return (
    <div className="sync-package-backups">
      <div className="sync-package-backups-title">
        <div>
          <strong>Backup timeline</strong>
          <span>{props.backups.length ? `${props.backups.length} snapshots` : 'no backups yet'}</span>
        </div>
        {props.showCopyAction === false ? null : (
          <button disabled={Boolean(props.busy) || !props.backups.length} onClick={() => void props.onCopyBackupReport()} type="button">
            <Copy size={14} />
            {text.copy}
          </button>
        )}
      </div>
      {visible.length ? (
        <div className="sync-package-backup-list">
          {visible.map((backup) => (
            <div className={`sync-package-backup ${backup.status}`} key={backup.id}>
              <div>
                <strong>{backup.id}</strong>
                <span>{syncPackageBackupStatusLabel(backup.status)}</span>
              </div>
              <small>backup {formatTime(backup.backupCreatedAt)}</small>
              <small>package {formatTime(backup.packageCreatedAt)}</small>
              <small>
                resources {backup.readyResourceCount}/{backup.resourceCount} · {formatBytes(backup.copiedBytes)}
              </small>
              {backup.error ? <small className="warning">{backup.error}</small> : null}
              {backup.warnings?.length ? <small className="warning">{backup.warnings[0]}</small> : null}
              <div className="sync-package-backup-actions">
                <button disabled={Boolean(props.busy)} onClick={() => void props.onOpenBackup(backup.backupPath)} title={backup.backupPath} type="button">
                  <FolderOpen size={13} />
                  {text.open}
                </button>
                <button
                  disabled={Boolean(props.busy) || backup.status !== 'ready'}
                  onClick={() => void props.onRestoreBackup(backup.id)}
                  title="Restore this snapshot as the current source sync package; clones still update only after Sync/Repair."
                  type="button"
                >
                  {props.busy === `codex-sync-package-restore-${backup.id}` ? <Loader2 className="spin" size={13} /> : <RefreshCw size={13} />}
                  {text.syncPackageRestoreBackup}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <small className="manifest-empty">No previous extracted package has been backed up yet.</small>
      )}
    </div>
  );
}

function SyncPackagePanel(props: {
  status: CodexSyncPackageStatus | null;
  backups: CodexSyncPackageBackupSummary[];
  preflight: CodexSyncPackagePreflightReport | null;
  busy: string;
  onExtract: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onPreflight: () => Promise<void>;
  onCopyResourceReport: () => Promise<void>;
  onCopyResourceLensReport: () => Promise<void>;
  onCopyBackupReport: () => Promise<void>;
  onCopyPreflightReport: () => Promise<void>;
  onOpenBackup: (path: string) => Promise<void>;
  onRestoreBackup: (backupId: string) => Promise<void>;
}) {
  const status = props.status;
  const isReady = Boolean(status?.exists);
  const isStale = Boolean(status?.stale);
  const resources = syncPackageResourceItems(status);
  const entryPreview = syncPackageEntryPreview(status);
  const hiddenEntryCount = Math.max(0, (status?.entries?.length ?? 0) - entryPreview.length);
  return (
    <div className={isReady ? `sync-package-panel ready${isStale ? ' stale' : ''}` : 'sync-package-panel'}>
      <div className="sync-package-main">
        <div>
          <div className="panel-title">
            <strong>{text.syncPackageTitle}</strong>
            <span>{isReady ? (isStale ? text.syncPackageStale : text.syncPackageReady) : text.syncPackageMissing}</span>
          </div>
          <code>{status?.packagePath || 'C:\\Users\\admin\\.codex_clone_launcher\\sync-package\\codex-home'}</code>
          {isReady ? (
            <div className="package-stats">
              <span>{formatTime(status?.createdAt)}</span>
              {status?.sourceModifiedAt ? <span>本体 {formatTime(status.sourceModifiedAt)}</span> : null}
              <span>{status?.fileCount ?? 0} 文件</span>
              <span>{status?.directoryCount ?? 0} 目录</span>
              <span>{formatBytes(status?.copiedBytes ?? 0)}</span>
              {isStale ? <span className="warning">{text.syncPackageStaleHint}</span> : null}
              {status?.warnings?.length ? <span className="warning">{status.warnings[0]}</span> : null}
            </div>
          ) : null}
        </div>
        <div className="package-actions">
          <button disabled={Boolean(props.busy)} onClick={() => void props.onExtract()} type="button">
            {props.busy === 'codex-sync-package-extract' ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
            {props.busy === 'codex-sync-package-extract' ? text.refreshing : text.syncPackageRefresh}
          </button>
          <button disabled={Boolean(props.busy)} onClick={() => void props.onRefresh()} type="button">
            {props.busy === 'codex-sync-package-status' ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
            {props.busy === 'codex-sync-package-status' ? text.refreshing : text.historyRefresh}
          </button>
          <button disabled={Boolean(props.busy)} onClick={() => void props.onPreflight()} type="button">
            {props.busy === 'codex-sync-package-preflight' ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}
            {text.preflight}
          </button>
          <CardMenu disabled={Boolean(props.busy)} label={text.moreActions}>
            <button disabled={Boolean(props.busy)} onClick={() => void props.onCopyResourceReport()} type="button">
              <Copy size={16} />
              {text.copyResources}
            </button>
            <button disabled={Boolean(props.busy) || !props.preflight} onClick={() => void props.onCopyPreflightReport()} type="button">
              <Copy size={16} />
              {text.copyPreflight}
            </button>
            <button disabled={Boolean(props.busy) || !props.backups.length} onClick={() => void props.onCopyBackupReport()} type="button">
              <Copy size={16} />
              {text.copyBackups}
            </button>
            <button disabled={Boolean(props.busy)} onClick={() => void props.onCopyResourceLensReport()} type="button">
              <Copy size={16} />
              {text.resourceLensCopy}
            </button>
          </CardMenu>
        </div>
      </div>

      <div className="sync-package-detail">
        <SyncPackagePreflightSummary
          preflight={props.preflight}
          busy={props.busy}
          showActions={false}
          onPreflight={props.onPreflight}
          onCopyPreflightReport={props.onCopyPreflightReport}
        />

        <details className="sync-package-collapsible">
          <summary>{text.syncPackageDetails}</summary>
          <div className="sync-package-boundary">
            <div>
              <span>{text.syncManifestIncluded}</span>
              <strong>{syncPackageIncludedSummary(status)}</strong>
              <small>sessions、skills、MCP、memories、rules、AGENTS.md</small>
            </div>
            <div>
              <span>{text.syncManifestExcluded}</span>
              <strong>{syncPackageExcludedSummary(status)}</strong>
              <small>账号、额度、plugins/cache/log 和运行临时文件不进入同步包</small>
            </div>
          </div>

          <SyncPackageResourceList className="sync-package-resources" resources={resources} />

          <div className="sync-package-manifest-preview">
            <div className="manifest-preview-title">
              <strong>{text.syncManifestEntryPreview}</strong>
              <span>{status?.manifestPath ?? 'manifest 未加载'}</span>
            </div>
            {entryPreview.length ? (
              <div className="manifest-entry-list">
                {entryPreview.map((entry) => (
                  <div key={`${entry.kind}:${entry.path}`}>
                    <code>{entry.path}</code>
                    <span>{syncPackageEntryLabel(entry)}</span>
                    {entry.error ? <small>{entry.error}</small> : null}
                  </div>
                ))}
                {hiddenEntryCount ? (
                  <div className="manifest-more">
                    <code>{text.syncManifestMoreEntries}</code>
                    <span>+{hiddenEntryCount.toLocaleString()}</span>
                  </div>
                ) : null}
              </div>
            ) : (
              <small className="manifest-empty">{text.syncManifestNoEntries}</small>
            )}
          </div>
        </details>

        <details className="sync-package-collapsible">
          <summary>{text.resourceLensTitle}</summary>
          <ResourceLensPanel resources={resources} busy={props.busy} />
        </details>

        <details className="sync-package-collapsible">
          <summary>{text.syncPackageBackups}</summary>
          <SyncPackageBackupTimeline
            backups={props.backups}
            busy={props.busy}
            showCopyAction={false}
            onCopyBackupReport={props.onCopyBackupReport}
            onOpenBackup={props.onOpenBackup}
            onRestoreBackup={props.onRestoreBackup}
          />
        </details>
      </div>
    </div>
  );
}

function InstanceTable(props: {
  emptyText: string;
  instances: InstanceProfile[];
  syncPackage: CodexSyncPackageStatus | null;
  busy: string;
  onStart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  historyByInstance: Record<string, CodexHistoryStatus>;
  syncBlockedReason?: string | null;
  syncNotice?: string | null;
  onHistoryRefresh?: (id: string) => Promise<void>;
  onHistoryVerify?: (id: string) => Promise<void>;
  onHistoryRepair?: (id: string) => Promise<void>;
  onHistoryExportMarkdown?: (id: string) => Promise<void>;
  onCloneSnapshotExport?: (id: string) => Promise<void>;
  onCloneSnapshotUse?: (id: string) => Promise<void>;
  cloneCapabilityDrafts?: Record<string, CloneCapabilityEditDraft>;
  onCloneCapabilityEdit?: (instance: InstanceProfile) => void;
  onCloneCapabilityDraftChange?: (id: string, patch: Partial<CloneCapabilityEditDraft>) => void;
  onCloneCapabilitySave?: (id: string) => Promise<void>;
  onCloneCapabilityCancel?: (id: string) => void;
  sessionsByInstance?: Record<string, CodexSessionSummary[]>;
  usageByInstance?: Record<string, CodexSessionUsageSummary>;
  onSessionListRefresh?: (id: string) => Promise<void>;
  onSessionUsageRefresh?: (id: string) => Promise<void>;
  sessionSearchQuery?: string;
  onSessionSearchQueryChange?: (value: string) => void;
  onCopySessionProjectDir?: (projectDir: string) => Promise<void> | void;
  exportDirByInstance?: Record<string, string>;
  onOpenHistoryExportDir?: (id: string) => Promise<void>;
  onOpenZed?: (id: string) => Promise<void>;
  onOpenSyncPackageAppliedMarker?: (id: string) => Promise<void>;
  onCopySyncPackageAppliedMarker?: (id: string) => Promise<void>;
  onCopySyncPackageResourceDiff?: (id: string) => Promise<void>;
}) {
  if (props.instances.length === 0) {
    return <div className="empty-state">{props.emptyText}</div>;
  }
  const showHistory = Boolean(props.onHistoryRefresh || props.onHistoryVerify || props.onHistoryRepair);

  return (
    <div className={showHistory ? 'instance-table with-history' : 'instance-table'}>
      <div className="table-head">
        <span>{text.instance}</span>
        <span>{text.profileDir}</span>
        <span>{text.status}</span>
        {showHistory ? <span>{text.history}</span> : null}
        <span>{text.lastLaunch}</span>
        <span>{text.actions}</span>
      </div>
      {props.instances.map((instance) => {
        const history = props.historyByInstance[instance.id] ?? instance.historyStatus;
        const isStarting = props.busy === `codex-start-${instance.id}`;
        const isStopping = props.busy === `codex-stop-${instance.id}`;
        const isRefreshing = props.busy === `codex-history-refresh-${instance.id}`;
        const isVerifying = props.busy === `codex-history-verify-${instance.id}`;
        const isRepairing = props.busy === `codex-history-repair-${instance.id}`;
        const isExporting = props.busy === `codex-history-export-${instance.id}`;
        const isExportingSnapshot = props.busy === `codex-clone-snapshot-export-${instance.id}`;
        const isUsingSnapshot = props.busy === `codex-clone-snapshot-use-${instance.id}`;
        const isSavingCapabilities = props.busy === `codex-clone-capabilities-${instance.id}`;
        const isListingSessions = props.busy === `codex-session-list-${instance.id}`;
        const isScanningUsage = props.busy === `codex-session-usage-${instance.id}`;
        const isOpeningZed = props.busy === `codex-open-zed-${instance.id}`;
        const isDeleting = props.busy === `codex-delete-${instance.id}`;
        const capabilityDraft = props.cloneCapabilityDrafts?.[instance.id] ?? null;
        const syncHint = props.syncBlockedReason ?? props.syncNotice ?? text.syncPackageApplyReady;
        const exportDir = props.exportDirByInstance?.[instance.id] ?? '';
        const sessions = props.sessionsByInstance?.[instance.id] ?? [];
        const usage = props.usageByInstance?.[instance.id] ?? null;
        const appliedMarkerPath = syncPackageAppliedMarkerPath(instance, history);
        const appliedFreshness = syncPackageAppliedFreshness(history, props.syncPackage);
        const resourceDiffHint = syncPackageResourceDiffHint(history, props.syncPackage);
        const readiness = cloneReadinessSummary(instance, history, props.syncPackage);
        return (
          <div className="table-row" key={instance.id}>
            <strong>{instance.name || instance.id}</strong>
            <code>{instance.userDataDir}</code>
            <span className={instance.running ? 'status running' : 'status'}>
              {instance.running ? text.running : text.stopped}
            </span>
            {showHistory ? (
              <div className={history?.ok ? 'history-cell ok' : 'history-cell'}>
                <strong>{historySummary(history)}</strong>
                <CloneReadinessPanel readiness={readiness} />
                <small>
                  {text.sessionIndexLabel} {history?.sessionIndexCount ?? 0} / {text.sessionFilesLabel} {history?.sessionFileCount ?? 0}
                </small>
                <small>
                  {history?.authMode ?? 'auth ?'} / {history?.providerBaseUrlHost ?? 'host ?'}
                </small>
                <small>sync {history?.syncMode ?? 'shared'}</small>
                {instance.launchScript?.trim() ? <small className="launch-script-badge">{text.launchScriptConfigured}</small> : null}
                {instance.modelCatalogEnabled ? (
                  <small className="model-catalog-badge" title={instance.modelCatalogPath ?? undefined}>
                    {text.modelCatalog} · {instance.modelCatalogCount ?? 0}
                  </small>
                ) : null}
                {instance.goalEnabled ? (
                  <small className="goal-pursuit-badge" title={instance.goalPath ?? undefined}>
                    {text.goalPursuitConfigured}
                  </small>
                ) : null}
                {instance.promptPackEnabled ? (
                  <small className="prompt-pack-badge" title={instance.promptPackPath ?? undefined}>
                    {text.promptPackConfigured}
                  </small>
                ) : null}
                <small>backup {formatShortPath(history?.lastBackupPath)}</small>
                <small className={`package-freshness ${appliedFreshness.tone}`} title={appliedFreshness.title}>
                  {appliedFreshness.label}
                </small>
                <small className={`package-freshness resource-diff ${resourceDiffHint.tone}`} title={resourceDiffHint.title}>
                  {resourceDiffHint.label}
                </small>
                <small title={history?.syncPackageApplied ? appliedMarkerPath : undefined}>{syncPackageAppliedSummary(history)}</small>
                {history?.warnings?.length ? <small className="warning">{history.warnings[0]}</small> : null}
              </div>
            ) : null}
            <span>{formatTime(instance.lastLaunchedAt)}</span>
            <div className="row-actions">
              <div className="row-action-buttons">
                {instance.running ? (
                  <button disabled={Boolean(props.busy)} onClick={() => void props.onStop(instance.id)} type="button">
                    {isStopping ? <Loader2 className="spin" size={15} /> : null}
                    {isStopping ? text.stopping : text.stop}
                  </button>
                ) : (
                  <button disabled={Boolean(props.busy)} onClick={() => void props.onStart(instance.id)} type="button">
                    {isStarting ? <Loader2 className="spin" size={15} /> : null}
                    {isStarting ? text.starting : text.start}
                  </button>
                )}
                {props.onHistoryRepair ? (
                  <button
                    disabled={Boolean(props.busy) || Boolean(props.syncBlockedReason)}
                    onClick={() => void props.onHistoryRepair?.(instance.id)}
                    title={props.syncBlockedReason ?? undefined}
                    type="button"
                  >
                    {isRepairing ? <Loader2 className="spin" size={15} /> : null}
                    {isRepairing ? text.repairing : text.historyRepair}
                  </button>
                ) : null}
                <button className="danger" disabled={Boolean(props.busy)} onClick={() => void props.onDelete(instance.id)} type="button">
                  {isDeleting ? <Loader2 className="spin" size={15} /> : null}
                  {isDeleting ? text.deleting : text.delete}
                </button>
                <CardMenu disabled={Boolean(props.busy)} label={text.moreActions}>
                  {props.onHistoryRefresh ? (
                    <button disabled={Boolean(props.busy)} onClick={() => void props.onHistoryRefresh?.(instance.id)} type="button">
                      {isRefreshing ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
                      {isRefreshing ? text.refreshing : text.historyRefresh}
                    </button>
                  ) : null}
                  {props.onHistoryVerify ? (
                    <button disabled={Boolean(props.busy)} onClick={() => void props.onHistoryVerify?.(instance.id)} type="button">
                      {isVerifying ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} />}
                      {isVerifying ? text.verifying : text.historyCheck}
                    </button>
                  ) : null}
                  {props.onHistoryExportMarkdown ? (
                    <button
                      disabled={Boolean(props.busy)}
                      onClick={() => void props.onHistoryExportMarkdown?.(instance.id)}
                      title={text.historyExportMarkdownTitle}
                      type="button"
                    >
                      {isExporting ? <Loader2 className="spin" size={15} /> : <Download size={15} />}
                      {text.historyExportMarkdown}
                    </button>
                  ) : null}
                  {props.onCloneSnapshotExport ? (
                    <button
                      disabled={Boolean(props.busy)}
                      onClick={() => void props.onCloneSnapshotExport?.(instance.id)}
                      title={text.cloneSnapshotExportTitle}
                      type="button"
                    >
                      {isExportingSnapshot ? <Loader2 className="spin" size={15} /> : <FileText size={15} />}
                      {text.cloneSnapshotExport}
                    </button>
                  ) : null}
                  {props.onCloneSnapshotUse ? (
                    <button
                      disabled={Boolean(props.busy)}
                      onClick={() => void props.onCloneSnapshotUse?.(instance.id)}
                      title={text.cloneSnapshotUseTitle}
                      type="button"
                    >
                      {isUsingSnapshot ? <Loader2 className="spin" size={15} /> : <Import size={15} />}
                      {text.cloneSnapshotUse}
                    </button>
                  ) : null}
                  {props.onCloneCapabilityEdit ? (
                    <button
                      disabled={Boolean(props.busy)}
                      onClick={() => props.onCloneCapabilityEdit?.(instance)}
                      title={text.cloneCapabilityLead}
                      type="button"
                    >
                      <Target size={15} />
                      {text.cloneCapabilityEdit}
                    </button>
                  ) : null}
                  {props.onOpenZed ? (
                    <button
                      disabled={Boolean(props.busy)}
                      onClick={() => void props.onOpenZed?.(instance.id)}
                      title={instance.workingDir || instance.userDataDir}
                      type="button"
                    >
                      {isOpeningZed ? <Loader2 className="spin" size={15} /> : <ExternalLink size={15} />}
                      {text.openZed}
                    </button>
                  ) : null}
                  {props.onOpenHistoryExportDir && exportDir ? (
                    <button
                      disabled={Boolean(props.busy)}
                      onClick={() => void props.onOpenHistoryExportDir?.(instance.id)}
                      title={exportDir}
                      type="button"
                    >
                      <FolderOpen size={15} />
                      {formatShortPath(exportDir)}
                    </button>
                  ) : null}
                  {history?.syncPackageApplied && props.onOpenSyncPackageAppliedMarker ? (
                    <button
                      disabled={Boolean(props.busy)}
                      onClick={() => void props.onOpenSyncPackageAppliedMarker?.(instance.id)}
                      title={appliedMarkerPath}
                      type="button"
                    >
                      <FileText size={15} />
                      {text.syncPackageAppliedOpen}
                    </button>
                  ) : null}
                  {history?.syncPackageApplied && props.onCopySyncPackageAppliedMarker ? (
                    <button
                      disabled={Boolean(props.busy)}
                      onClick={() => void props.onCopySyncPackageAppliedMarker?.(instance.id)}
                      title={appliedMarkerPath}
                      type="button"
                    >
                      <Copy size={15} />
                      {text.syncPackageAppliedCopy}
                    </button>
                  ) : null}
                  {history?.syncPackageApplied && props.onCopySyncPackageResourceDiff ? (
                    <button
                      disabled={Boolean(props.busy)}
                      onClick={() => void props.onCopySyncPackageResourceDiff?.(instance.id)}
                      title={resourceDiffHint.title}
                      type="button"
                    >
                      <Copy size={15} />
                      {text.resourceDiff}
                    </button>
                  ) : null}
                  {props.onSessionListRefresh ? (
                    <button disabled={Boolean(props.busy)} onClick={() => void props.onSessionListRefresh?.(instance.id)} type="button">
                      {isListingSessions ? <Loader2 className="spin" size={15} /> : <BookOpen size={15} />}
                      {isListingSessions ? text.refreshing : text.sessionListRefresh}
                    </button>
                  ) : null}
                  {props.onSessionUsageRefresh ? (
                    <button disabled={Boolean(props.busy)} onClick={() => void props.onSessionUsageRefresh?.(instance.id)} type="button">
                      {isScanningUsage ? <Loader2 className="spin" size={15} /> : <Gauge size={15} />}
                      {isScanningUsage ? text.refreshing : text.sessionUsageRefresh}
                    </button>
                  ) : null}
                </CardMenu>
              </div>
              {props.onHistoryRepair ? (
                <small className={props.syncBlockedReason || props.syncNotice ? 'sync-action-hint warning' : 'sync-action-hint'}>
                  {syncHint}
                </small>
              ) : null}
              {capabilityDraft ? (
                <div className={`clone-capability-editor ${capabilityDraft.goalEnabled ? 'enabled' : ''}`}>
                  <div className="clone-capability-title">
                    <strong>{text.cloneCapabilityTitle}</strong>
                    <span>{formatShortPath(instance.goalPath)}</span>
                  </div>
                  <label className="goal-pursuit-toggle">
                    <span>
                      <Target size={15} />
                      {text.goalPursuit}
                    </span>
                    <input
                      checked={capabilityDraft.goalEnabled}
                      name={`clone-goal-enabled-${instance.id}`}
                      onChange={(event) =>
                        props.onCloneCapabilityDraftChange?.(instance.id, {
                          goalEnabled: event.currentTarget.checked,
                        })
                      }
                      type="checkbox"
                    />
                  </label>
                  <small>{text.cloneCapabilityLead}</small>
                  {capabilityDraft.goalEnabled ? (
                    <textarea
                      name={`clone-goal-text-${instance.id}`}
                      onChange={(event) =>
                        props.onCloneCapabilityDraftChange?.(instance.id, {
                          goalText: event.currentTarget.value,
                        })
                      }
                      placeholder={text.goalPursuitPlaceholder}
                      value={capabilityDraft.goalText}
                    />
                  ) : null}
                  <div className="clone-capability-actions">
                    <button
                      disabled={Boolean(props.busy)}
                      onClick={() => void props.onCloneCapabilitySave?.(instance.id)}
                      type="button"
                    >
                      {isSavingCapabilities ? <Loader2 className="spin" size={14} /> : <CheckCircle2 size={14} />}
                      {text.cloneCapabilitySave}
                    </button>
                    <button
                      disabled={Boolean(props.busy)}
                      onClick={() => props.onCloneCapabilityCancel?.(instance.id)}
                      type="button"
                    >
                      {text.cloneCapabilityCancel}
                    </button>
                  </div>
                </div>
              ) : null}
              {sessions.length ? (
                <details className="instance-details">
                  <summary>{text.sessionDetails}</summary>
                  <SessionSummaryList
                    onCopyProjectDir={props.onCopySessionProjectDir}
                    query={props.sessionSearchQuery ?? ''}
                    sessions={sessions}
                  />
                </details>
              ) : null}
              {usage ? (
                <details className="instance-details">
                  <summary>{text.sessionUsageTitle}</summary>
                  <SessionUsageSummaryPanel usage={usage} />
                </details>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SessionSummaryList(props: {
  query: string;
  sessions: CodexSessionSummary[];
  onCopyProjectDir?: (projectDir: string) => Promise<void> | void;
}) {
  const query = props.query.trim().toLowerCase();
  const matched = query
    ? props.sessions.filter((session) =>
        [
          session.title,
          session.sessionId,
          session.summary ?? '',
          session.projectDir ?? '',
          session.searchPreview ?? '',
          session.rolloutPath,
        ]
          .some((value) => value.toLowerCase().includes(query)),
      )
    : props.sessions;
  const visible = matched.slice(0, 5);
  return (
    <div className="session-summary-list">
      <div className="session-summary-title">
        <strong>{text.sessionRecentTitle}</strong>
        <span>{query ? `${matched.length}/${props.sessions.length}` : `${props.sessions.length} ${text.sessionCountUnit}`}</span>
      </div>
      {visible.map((session) => {
        const projectDir = session.projectDir?.trim() ?? '';
        return (
          <div className={session.rolloutExists ? 'session-summary-item' : 'session-summary-item missing'} key={session.sessionId}>
            <div className="session-summary-main">
              <strong title={session.title}>{session.title}</strong>
              <span>{session.messageCount} {text.sessionMessageUnit}</span>
              <small>{session.lastMessageAt ?? text.sessionNoTimestamp}</small>
            </div>
            {session.summary ? <p title={session.summary}>{session.summary}</p> : null}
            <div className="session-summary-meta">
              <code title={session.rolloutPath}>{formatShortPath(session.rolloutPath)}</code>
              {projectDir ? (
                <button onClick={() => void props.onCopyProjectDir?.(projectDir)} title={projectDir} type="button">
                  <Copy size={12} />
                  {formatShortPath(projectDir)}
                </button>
              ) : (
                <small>{text.sessionUnknownProjectDir}</small>
              )}
            </div>
          </div>
        );
      })}
      {!visible.length ? <small className="session-summary-more">{text.sessionNoMatches}</small> : null}
      {matched.length > visible.length ? (
        <small className="session-summary-more">
          {text.sessionMorePrefix}
          {matched.length - visible.length}
          {text.sessionMoreSuffix}
        </small>
      ) : null}
    </div>
  );
}

function SessionUsageSummaryPanel(props: { usage: CodexSessionUsageSummary }) {
  const models = props.usage.byModel.slice(0, 5);
  const cost = sessionUsageCostSummary(props.usage);
  const modelCostByName = new Map(cost.byModel.map((item) => [item.model, item]));
  return (
    <div className="session-usage-panel">
      <div className="session-usage-title">
        <strong>{text.sessionUsageTitle}</strong>
        <span>
          {formatTokenCount(props.usage.totalTokens)} {text.sessionUsageTokensUnit} / {props.usage.eventCount}{' '}
          {text.sessionUsageEventsUnit}
        </span>
      </div>
      <div className="session-usage-stats">
        <span>{text.sessionUsageInput} {formatTokenCount(props.usage.inputTokens)}</span>
        <span>{text.sessionUsageCache} {formatTokenCount(props.usage.cachedInputTokens)}</span>
        <span>{text.sessionUsageOutputLabel} {formatTokenCount(props.usage.outputTokens)}</span>
        <span>
          {text.sessionUsageFiles} {props.usage.parsedFiles}/{props.usage.scannedFiles}
        </span>
      </div>
      <div className="session-cost-lens">
        <div className="session-cost-title">
          <strong>{text.sessionCostTitle}</strong>
          <span>{cost.pricedModels ? formatUsd(cost.totalCostUsd) : text.sessionCostUnpriced}</span>
        </div>
        <div className="session-cost-stats">
          <span>
            {text.sessionCostBillableInput} {formatTokenCount(cost.billableInputTokens)}
          </span>
          <span>
            {text.sessionCostCacheRate} {Math.round(cost.cacheHitRate * 100)}%
          </span>
          <span>
            {text.sessionCostOutput} {formatTokenCount(cost.outputTokens)}
          </span>
          <span>
            {text.sessionCostEstimate} {cost.pricedModels}/{cost.pricedModels + cost.unpricedModels}
          </span>
        </div>
        <small>{text.sessionCostDisclaimer}</small>
      </div>
      {props.usage.firstEventAt || props.usage.lastEventAt ? (
        <small className="session-usage-range">
          {props.usage.firstEventAt ?? text.sessionUsageRangeUnknown} {text.sessionUsageRangeSeparator}{' '}
          {props.usage.lastEventAt ?? text.sessionUsageRangeUnknown}
        </small>
      ) : null}
      {models.length ? (
        <div className="session-usage-models">
          {models.map((model) => (
            <div className="session-usage-model" key={model.model}>
              <strong>{model.model}</strong>
              <span>{formatTokenCount(model.totalTokens)}</span>
              <em>{modelCostByName.get(model.model)?.priced ? formatUsd(modelCostByName.get(model.model)?.totalCostUsd) : text.sessionCostUnpriced}</em>
              <small>
                {text.sessionUsageModelInput} {formatTokenCount(model.inputTokens)} / {text.sessionUsageModelCache}{' '}
                {formatTokenCount(model.cachedInputTokens)} / {text.sessionUsageModelOutput}{' '}
                {formatTokenCount(model.outputTokens)}
              </small>
            </div>
          ))}
        </div>
      ) : (
        <small className="session-summary-more">{text.sessionUsageEmpty}</small>
      )}
      {props.usage.warnings.length ? <small className="session-usage-warning">{props.usage.warnings[0]}</small> : null}
    </div>
  );
}

function PathRow(props: {
  title: string;
  value: string;
  onChange: (value: string) => void;
  onPick: () => void;
  onDetect: () => void;
}) {
  return (
    <div className="path-row">
      <label>
        <span>{props.title}</span>
        <input
          name="codex-launch-path"
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          placeholder={text.pathPlaceholder}
        />
      </label>
      <button onClick={props.onPick} type="button">
        <FolderOpen size={16} />
        {text.pick}
      </button>
      <button onClick={props.onDetect} type="button">
        <RefreshCw size={16} />
        {text.autoDetect}
      </button>
    </div>
  );
}
